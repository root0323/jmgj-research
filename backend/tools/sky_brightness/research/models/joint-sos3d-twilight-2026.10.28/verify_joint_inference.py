"""Verify the saved candidate predicts without receiving measured SQM labels."""
import argparse
from dataclasses import replace
import json
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio

from joint_model import JointSkyModel
from prepare_joint_basis import write_json
from app.services.sky_brightness_model.core.config import EnvironmentConfig
from app.services.sky_brightness_model.core.calculator import prepare_pixel_geometry,run_pipeline
from app.services.sky_brightness_model.core.data_loader import load_pixel_data_from_h5


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('artifact','predictions','h5','dem','output'):
        parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args()
    if args.output.exists():raise ValueError('Do not overwrite an earlier verification')
    research=Path(__file__).resolve().parent
    frame=pd.read_csv(args.predictions,float_precision='round_trip')
    selected=frame[(frame['dataset']=='2026-10-26_1829-1835_KST_tamna_playground')&(frame['observation_id']==16)].iloc[0]
    coordinate=(float(selected['lat']),float(selected['lon']))
    weather_path=research/'datasets'/selected['dataset']/'raw/weather_cache_33.42785_126.53208_2026-10-26.json'
    weather=json.loads(weather_path.read_text(encoding='utf-8'))
    with rasterio.open(args.dem) as source:
        dem=(source.read(1),source.transform)
        height=float(next(source.sample([(coordinate[1],coordinate[0])]))[0])
    pixels=load_pixel_data_from_h5(args.h5,coordinate,max_radius_km=30)
    geometry=prepare_pixel_geometry(pixels,coordinate,max_radius_km=30,dem_data=dem,
                                    keep_radiance_fraction=.99,min_pixels=50,max_pixels=1000)
    model=JointSkyModel.from_artifact(args.artifact)
    result=model.predict(coordinate,(float(selected['zen']),float(selected['az'])),selected['time'],
                         weather,geometry,dem,height)
    difference=abs(result['sqm']-float(selected['joint_fit']))
    assert difference<2e-8,difference
    context=result['context'];moon=context['moon'];native=[]
    config=EnvironmentConfig(**context['modern_weather'],physics_model='sos3d',
                             moon_phase_angle_deg=moon['phase_angle'],cloud_optical_depth=model.parameters.cloud_optical_depth,
                             instrument_fwhm_deg=20.,art_scale=model.parameters.art_scale)
    for fraction in (0.,1.):
        part=run_pipeline(observer_coordinates=coordinate,observer_angles=(float(selected['zen']),float(selected['az'])),
                          moon_angles=(90-moon['altitude'],moon['azimuth']),pixel_data=geometry,dem_data=dem,
                          config=replace(config,cloud_fraction=fraction),precalc_moon_shield=context['moon_shield_deg'],
                          max_radius_km=30,return_components=True)
        native.append(12.59-2.5*np.log10(part['total']*683+result['twilight_cd_m2']))
    cf=context['modern_weather']['cloud_fraction']
    direct_prediction=(1-cf)*native[0]+cf*native[1]
    native_difference=abs(direct_prediction-result['sqm'])
    assert native_difference<2e-8,native_difference
    write_json(args.output,{'uid':selected['uid'],'prediction_without_sqm_input':result['sqm'],
                            'cached_fit_prediction':float(selected['joint_fit']),
                            'absolute_sqm_difference':difference,
                            'native_art_scale_rerun_absolute_sqm_difference':native_difference,
                            'location_and_time':{'latitude':coordinate[0],'longitude':coordinate[1],'time_kst':selected['time']},
                            'actual_sqm_passed_to_predictor':False,'source_linearity_checked':True})
    print(json.dumps({'inference_check_passed':True,'difference':difference,'native_linearity_difference':native_difference}))


if __name__=='__main__':main()
