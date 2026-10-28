"""Verify native label-free roof predictions and unobstructed backward identity."""
import argparse
from dataclasses import replace
import json
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio

from roof_model import RoofSkyModel
from joint_model import JointSkyModel
from prepare_joint_basis import RESEARCH, write_json
from prepare_rooftop_basis import DATASET, WEATHER
from app.services.sky_brightness_model.core.calculator import prepare_pixel_geometry
from app.services.sky_brightness_model.core.calculator import run_pipeline
from app.services.sky_brightness_model.core.config import EnvironmentConfig
from app.services.sky_brightness_model.core.data_loader import load_pixel_data_from_h5


def verify(artifact, predictions, h5, dem_path, output):
    if output.exists():
        raise ValueError('Verification file already exists')
    frame = pd.read_csv(predictions, float_precision='round_trip')
    rooftop = frame[frame['dataset'] == DATASET]
    chosen = rooftop.loc[rooftop['clear_moon_direct_unobstructed'].idxmax()]
    coordinate = (float(chosen['lat']), float(chosen['lon']))
    angles = (float(chosen['zen']), float(chosen['az']))
    weather = json.loads((RESEARCH/'datasets'/DATASET/'raw'/WEATHER).read_text(encoding='utf-8'))
    with rasterio.open(dem_path) as raster:
        dem = (raster.read(1), raster.transform)
        height = float(next(raster.sample([(coordinate[1], coordinate[0])]))[0])
    pixels = load_pixel_data_from_h5(h5, coordinate, max_radius_km=30)
    geometry = prepare_pixel_geometry(pixels, coordinate, max_radius_km=30, dem_data=dem,
                                      keep_radiance_fraction=.99, min_pixels=50, max_pixels=1000)
    model = RoofSkyModel.from_artifact(artifact)
    inputs = (coordinate, angles, chosen['time'], weather, geometry, dem, height)
    shaded = model.predict(*inputs, moon_visibility=0.)
    unblocked = model.predict(*inputs, moon_visibility=1.)
    previous_wrapper = JointSkyModel(model.parameters).predict(*inputs)
    native_difference = abs(shaded['sqm']-float(chosen['four_date_fit']))
    backward_difference = abs(unblocked['sqm']-previous_wrapper['sqm'])
    assert native_difference < 2e-8 and backward_difference < 2e-8
    assert shaded['sqm'] >= unblocked['sqm']
    for state in ('clear', 'cloudy'):
        a = shaded['conditional_components_cd_m2'][state]
        b = unblocked['conditional_components_cd_m2'][state]
        assert a['moon_diffuse'] == b['moon_diffuse'] and a['art'] == b['art']
        assert a['moon_direct_visible'] == 0
        assert np.isclose(b['other']-a['other'], b['moon_direct_unobstructed'], rtol=1e-10, atol=1e-15)
    context = shaded['context']; moon = context['moon']
    cfg = EnvironmentConfig(**context['modern_weather'], physics_model='sos3d',
                            moon_phase_angle_deg=moon['phase_angle'],
                            cloud_optical_depth=model.parameters.cloud_optical_depth,
                            instrument_fwhm_deg=20., art_scale=model.parameters.art_scale,
                            include_direct_moon=False)
    native = []
    for fraction in (0., 1.):
        part = run_pipeline(observer_coordinates=coordinate, observer_angles=angles,
                            moon_angles=(90-moon['altitude'], moon['azimuth']), pixel_data=geometry,
                            dem_data=dem, precalc_moon_shield=context['moon_shield_deg'], max_radius_km=30,
                            config=replace(cfg, cloud_fraction=fraction), return_components=True)
        assert part['transport']['clear' if fraction == 0 else 'cloudy']['converged']
        native.append(12.59-2.5*np.log10(part['total']*683+shaded['twilight_cd_m2']))
    cf = context['modern_weather']['cloud_fraction']
    source_gain_difference = abs((1-cf)*native[0]+cf*native[1]-shaded['sqm'])
    assert source_gain_difference < 2e-8
    report = {'uid': chosen['uid'], 'time_kst': chosen['time'], 'angles': angles,
              'actual_sqm_passed_to_predictor': False, 'native_shaded_sqm': shaded['sqm'],
              'native_unobstructed_sqm': unblocked['sqm'],
              'native_vs_cached_absolute_sqm_difference': native_difference,
              'unobstructed_vs_previous_wrapper_absolute_sqm_difference': backward_difference,
              'native_source_gain_and_direct_disk_flag_absolute_sqm_difference': source_gain_difference,
              'mask_changes_only_direct_disk_channel': True,
              'conditional_components_cd_m2': shaded['conditional_components_cd_m2'],
              'local_roof_mask_fitted': False, 'app_adopted': False}
    write_json(output, report)
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('artifact', 'predictions', 'h5', 'dem', 'output'):
        parser.add_argument('--'+name, type=Path, required=True)
    args = parser.parse_args(); verify(args.artifact, args.predictions, args.h5, args.dem, args.output)
