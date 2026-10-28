"""Create location/time-specific transport bases without altering any old run."""
import argparse
from dataclasses import replace
import json
from pathlib import Path
import time

import numpy as np
import pandas as pd
import rasterio

from calibrate_three_hour import lunar_at,weather_at,sha256
from evaluate_frozen import solar_at
from app.services.sky_brightness_model.core.config import EnvironmentConfig
from app.services.sky_brightness_model.core.calculator import prepare_pixel_geometry,calculate_directional_shielding,run_pipeline
from app.services.sky_brightness_model.core.data_loader import load_pixel_data_from_h5,interp_positive_value,pressure_to_cloud_base_height_km
from app.services.sky_brightness_model.core.modern_sky import sensor_rays,look_vector
from joint_model import TAU_GRID

RESEARCH=Path(__file__).resolve().parent
DATASETS=[
 ('2026-10-22_2123-2218_KST_jeju','v001_all_49.csv','weather_cache_33.4268_126.5303_2026-10-22.json',49),
 ('2026-10-26_1829-1835_KST_tamna_playground','v001_all_49.csv','weather_cache_33.42785_126.53208_2026-10-26.json',49),
 ('2026-10-27_2108-2113_KST_jeju_science_high','v001_valid_33.csv','weather_cache_33.426633_126.530639_2026-10-27.json',33),
]


def write_json(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8',newline='\n')


def resolve_context(weather,row,height,dem):
    coordinate=(float(row['lat']),float(row['lon']))
    for package in ('p2','p3','p4'):
        meta=weather[package]['metadata']
        if max(abs(float(meta['latitude'])-coordinate[0]),abs(float(meta['longitude'])-coordinate[1]))>1e-5:
            raise ValueError('Weather belongs to another observation location')
    env,detail=weather_at(weather,row['time'],*coordinate)
    d=detail['interpolation']['p4'];block=weather['p4'][d['block']]
    indices=(block['time'].index(d['left']),block['time'].index(d['right']),d['fraction'])
    pressure=interp_positive_value(block['convectivecloudbase_pressure'],*indices)
    modern={**env,'cloud_base_h':pressure_to_cloud_base_height_km(pressure,1.) if pressure is not None else 2.,
            'cloud_base_source':'convective_cloud_base_pressure_proxy' if pressure is not None else 'assumed_2km_invalid_pressure_endpoint'}
    moon=lunar_at(row['time'],*coordinate,height)
    sun=solar_at(row['time'],*coordinate,height)
    shield=float(calculate_directional_shielding(coordinate,moon['azimuth'],*dem,max_dist_km=30))
    return {'weather':env,'modern_weather':modern,'weather_interpolation':detail,'moon':moon,'sun':sun,
            'moon_shield_deg':shield,'height_m':height,'latitude':coordinate[0],'longitude':coordinate[1]}


def components(parts):
    return np.array([parts['I_art_final']+parts['I_cloud_final'],parts['I_ml_final']+parts['I_bg_final']])*683


def solar_rays(row,sun):
    result=[];direction=look_vector(90-sun['altitude'],sun['azimuth'])
    for zen,az,weight in sensor_rays(row['zen'],row['az'],20.):
        if zen>=90:
            continue  # Match the transport solver's zero sky radiance below ground.
        # Empirical secant angular extension, finite at the low-weight horizon.
        airmass=1/max(np.cos(np.radians(zen)),np.sin(np.radians(1.)))
        result.append({'weight_airmass':float(weight*airmass),
                       'cosine_minus_zenith':float(look_vector(zen,az)@direction-np.sin(np.radians(sun['altitude'])))})
    return result


def make_basis(h5,dem_path,output,assignments=('representative',),taus=TAU_GRID,reuse_previous=True):
    if output.exists():
        raise ValueError('Output already exists; previous research is immutable')
    output.mkdir(parents=True)
    with rasterio.open(dem_path) as source:
        dem=(source.read(1),source.transform)
    all_rows=[];contexts={};rays={};provenance={};start=time.perf_counter()
    for dataset,csv,cache,n in DATASETS:
        base=RESEARCH/'datasets'/dataset
        observations=pd.read_csv(base/'inputs'/csv,float_precision='round_trip').to_dict('records')
        assert len(observations)==n
        weather=json.loads((base/'raw'/cache).read_text(encoding='utf-8'))
        coordinate=(observations[0]['lat'],observations[0]['lon'])
        with rasterio.open(dem_path) as source:
            height=float(next(source.sample([(coordinate[1],coordinate[0])]))[0])
        raw_pixels=load_pixel_data_from_h5(h5,coordinate,max_radius_km=30)
        geometry=prepare_pixel_geometry(raw_pixels,coordinate,max_radius_km=30,dem_data=dem,
                                        keep_radiance_fraction=.99,min_pixels=50,max_pixels=1000)
        provenance[dataset]={'observations':str((base/'inputs'/csv).relative_to(RESEARCH)),
                             'observations_sha256':sha256(base/'inputs'/csv),
                             'weather':str((base/'raw'/cache).relative_to(RESEARCH)),
                             'weather_sha256':sha256(base/'raw'/cache),
                             'n':n,'coordinates':coordinate,'height_m':height,'pixels':len(geometry)}
        cached={}
        if reuse_previous and dataset!=DATASETS[1][0] and assignments==('representative',):
            previous=RESEARCH/'revisions/2026-10-28_transport_physics'
            for tau in taus:
                folder=previous/('nominal_tau10' if tau==10 else f'scenarios/tau{int(tau)}')/dataset
                cached[tau]=pd.read_csv(folder/'comparison.csv',float_precision='round_trip').set_index('observation_id')
        for assignment in assignments:
            for i,original in enumerate(observations):
                row={**original}
                if assignment!='representative':
                    row['time']=pd.Timestamp(row['time_'+assignment]).strftime('%Y-%m-%d %H:%M')
                uid=f"{dataset}:{int(row['observation_id'])}"
                context_key=f"{dataset}/{row['time']}"
                if context_key not in contexts:
                    contexts[context_key]=resolve_context(weather,row,height,dem)
                context=contexts[context_key];moon=context['moon'];sun=context['sun']
                rays[assignment+'/'+uid]=solar_rays(row,sun)
                common=dict(observer_coordinates=coordinate,observer_angles=(row['zen'],row['az']),
                            moon_angles=(90-moon['altitude'],moon['azimuth']),pixel_data=geometry,
                            dem_data=dem,precalc_moon_shield=context['moon_shield_deg'],max_radius_km=30)
                cfg=EnvironmentConfig(**context['modern_weather'],moon_phase_angle_deg=moon['phase_angle'],
                                      physics_model='sos3d',cloud_optical_depth=10.,instrument_fwhm_deg=20.)
                clear_result=run_pipeline(**common,config=replace(cfg,cloud_fraction=0.),return_components=True)
                assert clear_result['transport']['clear']['converged']
                clear=components(clear_result);cf=cfg.cloud_fraction
                for tau in taus:
                    if tau in cached:
                        frozen=cached[tau].loc[int(row['observation_id'])]
                        assert frozen['time']==original['time'] and frozen['actual_mag']==original['actual_mag']
                        mean=np.array([frozen['transport_sqm_l_I_art_final']+frozen['transport_sqm_l_I_cloud_final'],
                                       frozen['transport_sqm_l_I_ml_final']+frozen['transport_sqm_l_I_bg_final']])*683
                        cloudy=(mean-(1-cf)*clear)/cf
                        if np.min(cloudy)<-1e-13:
                            raise ValueError('Recovered negative conditional radiance')
                        cloudy=np.maximum(cloudy,0)
                        assert np.allclose((1-cf)*clear+cf*cloudy,mean,rtol=1e-10,atol=1e-14)
                        legacy=float(frozen['legacy'])
                        origin='Exact linear decomposition of immutable previous mean and recomputed clear field'
                    else:
                        part=run_pipeline(**common,config=replace(cfg,cloud_fraction=1.,cloud_optical_depth=tau),return_components=True)
                        assert part['transport']['cloudy']['converged']
                        cloudy=components(part)
                        legacy_config=EnvironmentConfig(**context['weather'],moon_phase_angle_deg=moon['phase_angle'],physics_model='legacy')
                        old=run_pipeline(**common,config=legacy_config,return_components=True)
                        legacy=float(12.59-2.5*np.log10(old['total']*683))
                        origin='Direct conditional transport solves'
                        context[f'tau{tau}_cloudy_transport']=part['transport']['cloudy']
                    all_rows.append({**row,'dataset':dataset,'uid':uid,'assignment':assignment,'cloud_tau':tau,
                                     'cloud_fraction':cf,'sun_altitude':sun['altitude'],'sun_azimuth':sun['azimuth'],
                                     'moon_altitude':moon['altitude'],'moon_azimuth':moon['azimuth'],
                                     'clear_art':clear[0],'clear_other':clear[1],
                                     'cloudy_art':cloudy[0],'cloudy_other':cloudy[1],
                                     'legacy':legacy,'basis_origin':origin})
                if (i+1)%12==0 or i==n-1:
                    print(f'{dataset} {assignment}: {i+1}/{n}; {time.perf_counter()-start:.1f}s',flush=True)
    frame=pd.DataFrame(all_rows)
    assert len(frame)==131*len(taus)*len(assignments)
    frame.to_csv(output/'transport_basis.csv',index=False)
    write_json(output/'solar_rays.json',rays)
    write_json(output/'contexts.json',contexts)
    write_json(output/'provenance.json',{'datasets':provenance,'h5_sha256':sha256(h5),'dem_sha256':sha256(dem_path),
                                       'elapsed_seconds':time.perf_counter()-start,'assignments':assignments,
                                       'optical_depth_grid':taus,'no_new_weather_api_calls':True,
                                       'reuse_previous':bool(cached)})
    return frame,rays,contexts


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--h5',type=Path,required=True);parser.add_argument('--dem',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--endpoints',action='store_true');parser.add_argument('--tau',type=float)
    args=parser.parse_args()
    make_basis(args.h5,args.dem,args.output,('start','end') if args.endpoints else ('representative',),
               (args.tau,) if args.tau is not None else TAU_GRID,not args.endpoints)
