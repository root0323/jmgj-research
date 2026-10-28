"""Offline comparison of legacy physics and the new directional transport path."""
import argparse
from dataclasses import replace
from datetime import datetime,timezone
import json
from pathlib import Path
import sys
import time

import numpy as np
import pandas as pd
import rasterio

from calibrate_three_hour import lunar_at,weather_at,sha256,error_metrics,save_directional_report
from app.services.sky_brightness_model.core.config import EnvironmentConfig
from app.services.sky_brightness_model.core.calculator import (
    prepare_pixel_geometry,calculate_directional_shielding,run_pipeline,
)
from app.services.sky_brightness_model.core.data_loader import load_pixel_data_from_h5,interp_positive_value,pressure_to_cloud_base_height_km
from app.services.sky_brightness_model.core.modern_sky import MODEL_VERSION

DATASETS=[('2026-10-22_2123-2218_KST_jeju','v001_all_49.csv','weather_cache_33.4268_126.5303_2026-10-22.json'),
          ('2026-10-27_2108-2113_KST_jeju_science_high','v001_valid_33.csv','weather_cache_33.426633_126.530639_2026-10-27.json')]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['h5','dem','output']:
        parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--cloud-tau',type=float,default=10.)
    args=parser.parse_args()
    if args.output.exists():
        raise SystemExit('Use a new output directory; existing research is immutable.')
    research=Path(__file__).resolve().parent
    with rasterio.open(args.dem) as source:
        dem=(source.read(1),source.transform)
    started=time.perf_counter();all_rows=[];reports={};contexts={}
    for dataset,csv_name,cache_name in DATASETS:
        base=research/'datasets'/dataset
        rows=pd.read_csv(base/'inputs'/csv_name).to_dict('records')
        weather=json.loads((base/'raw'/cache_name).read_text(encoding='utf-8'))
        coordinate=(rows[0]['lat'],rows[0]['lon'])
        with rasterio.open(args.dem) as source:
            height=float(next(source.sample([(coordinate[1],coordinate[0])]))[0])
        pixels=load_pixel_data_from_h5(args.h5,coordinate,max_radius_km=30)
        geometry=prepare_pixel_geometry(pixels,coordinate,max_radius_km=30,dem_data=dem,
                                        keep_radiance_fraction=.99,min_pixels=50,max_pixels=1000)
        values={name:[] for name in ['legacy','transport_sky','transport_sqm_l']}
        predictions=[]
        for i,row in enumerate(rows):
            key=dataset+'/'+row['time']
            if key not in contexts:
                env,details=weather_at(weather,row['time'],*coordinate)
                moon=lunar_at(row['time'],*coordinate,height)
                angles=(90-moon['altitude'],moon['azimuth'])
                shield=calculate_directional_shielding(coordinate,angles[1],*dem,max_dist_km=30)
                block=details['interpolation']['p4']['block']
                times=weather['p4'][block]['time'];d=details['interpolation']['p4']
                indices=(times.index(d['left']),times.index(d['right']),d['fraction'])
                pressure=interp_positive_value(weather['p4'][block]['convectivecloudbase_pressure'],*indices)
                modern_weather={**env,'cloud_base_h':pressure_to_cloud_base_height_km(pressure,1.) if pressure is not None else 2.,
                                'cloud_base_source':'convective_cloud_base_pressure_proxy' if pressure is not None else 'assumed_2km_invalid_pressure_endpoint'}
                contexts[key]={'weather':env,'modern_weather':modern_weather,'details':details,'moon':moon,'shield':float(shield)}
            context=contexts[key]
            moon=context['moon'];angles=(90-moon['altitude'],moon['azimuth'])
            arguments=dict(observer_coordinates=coordinate,observer_angles=(row['zen'],row['az']),
                           moon_angles=angles,pixel_data=geometry,dem_data=dem,
                           precalc_moon_shield=context['shield'],max_radius_km=30)
            common=dict(**context['weather'],moon_phase_angle_deg=moon['phase_angle'])
            modern=EnvironmentConfig(**context['modern_weather'],moon_phase_angle_deg=moon['phase_angle'],
                                     physics_model='sos3d',cloud_optical_depth=args.cloud_tau)
            parts={
                'legacy':run_pipeline(**arguments,config=EnvironmentConfig(**common,physics_model='legacy'),return_components=True),
                'transport_sky':run_pipeline(**arguments,config=modern,return_components=True),
                'transport_sqm_l':run_pipeline(**arguments,config=replace(modern,instrument_fwhm_deg=20.),return_components=True),
            }
            result={**row,'dataset':dataset}
            for label,part in parts.items():
                if not np.isfinite(part['total']) or part['total']<=0:
                    raise ValueError('Invalid transport prediction')
                magnitude=float(12.59-2.5*np.log10(part['total']*683))
                values[label].append(magnitude);result[label]=magnitude
                for field in ['I_art_final','I_cloud_final','I_ml_final','I_bg_final']:
                    result[label+'_'+field]=float(part[field])
                if label!='legacy':
                    assert not part['transport']['legacy_global_multiple_scattering_factor_applied']
                    for column in ['clear','cloudy']:
                        if part['transport'][column]:
                            assert part['transport'][column]['converged']
                    context[label+'_transport']=part['transport']
            predictions.append(result);all_rows.append(result)
            if (i+1)%10==0 or i==len(rows)-1:
                print(f'{dataset}: {i+1}/{len(rows)} | elapsed {time.perf_counter()-started:.1f}s',flush=True)
        observed=np.array([row['actual_mag'] for row in rows])
        reports[dataset]={label:error_metrics(np.asarray(v)-observed) for label,v in values.items()}
        target=args.output/dataset;target.mkdir(parents=True)
        pd.DataFrame(predictions).to_csv(target/'comparison.csv',index=False)
        for label,v in values.items():
            save_directional_report([{**row,'pred_mag':value,'diff':value-row['actual_mag']}
                                     for row,value in zip(rows,v)],str(target/label))
        print(json.dumps({dataset:reports[dataset]},indent=2),flush=True)
    report={'created_at':datetime.now(timezone.utc).isoformat(),'model_version':MODEL_VERSION,
            'n':len(all_rows),'datasets':reports,'contexts':contexts,'cloud_optical_depth':args.cloud_tau,
            'coefficient_fit_performed':False,'nominal_optics':'SSA=.95, CS phase-shape g=.75; water-cloud SSA=.999, CS g=.85',
            'legacy_global_multiplier_used_by_transport':False,
            'hashes':{'h5':sha256(args.h5),'dem':sha256(args.dem)},
            'elapsed_seconds':time.perf_counter()-started,
            'limitations':['Cloud optical thickness is an explicit assumed scenario, not measured or inferred from cloud fraction.',
                           'Independent-column mixing does not resolve observed 3-D cloud morphology or actual Moon occlusion.',
                           'Finite spatial/angular grid; scattering-order convergence does not bound spatial discretization error.',
                           'Full finite Moon disk and approximate Gaussian SQM-L response are reported separately from sky radiance.',
                           'No October 26 twilight observations are fitted or treated as fully dark sky.']}
    (args.output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({'complete':True,'n':len(all_rows),'elapsed_seconds':report['elapsed_seconds']}),flush=True)


if __name__=='__main__':
    main()
