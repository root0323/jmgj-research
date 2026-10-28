"""Native per-minute rooftop solves; no interpolation of transport or labels."""
import argparse
from dataclasses import replace
import json
from pathlib import Path
import time

import numpy as np
import pandas as pd
import rasterio

from calibrate_three_hour import sha256
from prepare_joint_basis import write_json, resolve_context, solar_rays
from joint_model import TAU_GRID
from roof_model import conditional_components
from app.services.sky_brightness_model.core.config import EnvironmentConfig
from app.services.sky_brightness_model.core.calculator import prepare_pixel_geometry, run_pipeline
from app.services.sky_brightness_model.core.data_loader import load_pixel_data_from_h5

RESEARCH = Path(__file__).resolve().parent
DATASET = '2026-10-28_2113-2123_KST_jeju_science_rooftop'
WEATHER = 'weather_cache_33.42642_126.53016_2026-10-28.json'


def make_basis(h5, dem_path, output):
    if output.exists():
        raise ValueError('Output already exists; choose a new run')
    output.mkdir(parents=True)
    start = time.perf_counter(); base = RESEARCH/'datasets'/DATASET
    source = base/'inputs/v001_valid_48.csv'
    frame = pd.read_csv(source, float_precision='round_trip')
    assert len(frame) == 48 and frame['observation_id'].is_unique
    weather = json.loads((base/'raw'/WEATHER).read_text(encoding='utf-8'))
    coordinate = (float(frame.iloc[0]['lat']), float(frame.iloc[0]['lon']))
    with rasterio.open(dem_path) as raster:
        dem = (raster.read(1), raster.transform)
        height = float(next(raster.sample([(coordinate[1], coordinate[0])]))[0])
    pixels = load_pixel_data_from_h5(h5, coordinate, max_radius_km=30)
    geometry = prepare_pixel_geometry(pixels, coordinate, max_radius_km=30, dem_data=dem,
                                      keep_radiance_fraction=.99, min_pixels=50, max_pixels=1000)
    rows = []; contexts = {}; rays = {}; checkpoints = output/'checkpoints'; checkpoints.mkdir()
    for timestamp, group in frame.groupby('time', sort=False):
        sample = group.iloc[0].to_dict()
        context = resolve_context(weather, sample, height, dem)
        moon = context['moon']; sun = context['sun']
        key = DATASET+'/'+timestamp; contexts[key] = context
        cfg = EnvironmentConfig(**context['modern_weather'], physics_model='sos3d',
                                moon_phase_angle_deg=moon['phase_angle'],
                                cloud_optical_depth=10., instrument_fwhm_deg=20.)
        block = []
        for row in group.to_dict('records'):
            assert row['local_moon_disk_visibility'] == 0.
            uid = DATASET+':'+str(int(row['observation_id']))
            rays['representative/'+uid] = solar_rays(row, sun)
            common = dict(observer_coordinates=coordinate, observer_angles=(row['zen'], row['az']),
                          moon_angles=(90-moon['altitude'], moon['azimuth']), pixel_data=geometry,
                          dem_data=dem, precalc_moon_shield=context['moon_shield_deg'], max_radius_km=30)
            clear_part = run_pipeline(**common, config=replace(cfg, cloud_fraction=0.), return_components=True)
            assert clear_part['transport']['clear']['converged']
            clear = conditional_components(clear_part, 0.)
            clear_control = conditional_components(clear_part, 1.)
            for tau in TAU_GRID:
                cloudy_part = run_pipeline(**common, config=replace(cfg, cloud_fraction=1., cloud_optical_depth=tau),
                                           return_components=True)
                assert cloudy_part['transport']['cloudy']['converged']
                cloudy = conditional_components(cloudy_part, 0.)
                cloudy_control = conditional_components(cloudy_part, 1.)
                context['clear_transport'] = clear_part['transport']['clear']
                context[f'tau{tau}_cloudy_transport'] = cloudy_part['transport']['cloudy']
                result = {**row, 'dataset': DATASET, 'uid': uid, 'assignment': 'representative',
                          'cloud_tau': tau, 'cloud_fraction': cfg.cloud_fraction,
                          'sun_altitude': sun['altitude'], 'sun_azimuth': sun['azimuth'],
                          'moon_altitude': moon['altitude'], 'moon_azimuth': moon['azimuth'],
                          'clear_art': clear['art'], 'clear_other': clear['other'],
                          'cloudy_art': cloudy['art'], 'cloudy_other': cloudy['other'],
                          'clear_other_unobstructed': clear_control['other'],
                          'cloudy_other_unobstructed': cloudy_control['other'],
                          'basis_origin': 'Native conditional transport at this recorded minute; only local direct lunar disk occulted'}
                for state, parts in (('clear', clear), ('cloudy', cloudy)):
                    result.update({state+'_'+name: value for name, value in parts.items()
                                   if name not in ('art', 'other')})
                block.append(result)
        rows.extend(block)
        pd.DataFrame(block).to_csv(checkpoints/(timestamp[-5:].replace(':', '')+'.csv'), index=False)
        write_json(output/'contexts.json', contexts)
        print(f'{timestamp}: {len(group)} observations, all four fields converged; {time.perf_counter()-start:.1f}s', flush=True)
    result = pd.DataFrame(rows)
    assert len(result) == 48*len(TAU_GRID)
    result.to_csv(output/'transport_basis.csv', index=False)
    write_json(output/'solar_rays.json', rays)
    write_json(output/'provenance.json', {
        'dataset': DATASET, 'n': 48, 'raw_slots': 49, 'missing_observation_ids': [21],
        'source_observations': str(source.relative_to(RESEARCH)), 'source_sha256': sha256(source),
        'weather_path': str((base/'raw'/WEATHER).relative_to(RESEARCH)), 'weather_sha256': sha256(base/'raw'/WEATHER),
        'weather_receipt': json.loads((base/'raw'/Path(WEATHER).with_suffix('.receipt.json')).read_text(encoding='utf-8')),
        'latitude': coordinate[0], 'longitude': coordinate[1],
        'coordinate_provenance': 'Manual screenshot-to-map registration; approximate, not GPS. Assumed horizontal uncertainty at least 10 m.',
        'dsm_height_m_used': height, 'vertical_offset_m_added': 0.,
        'roof_height': 'User: four-storey roof, exact metres unknown. DSM may include structures; no invented 12 m added to a DSM.',
        'vertical_transport_limitation': 'The existing ground-relative RTE grid is retained; elevated sensor/roof geometry is not spatially resolved.',
        'local_moon_disk_visibility': 0., 'atmospheric_moon_light_retained': True,
        'time_policy': 'Each user-specified minute is evaluated separately at its start; actual seconds unknown. No transport-field interpolation.',
        'unique_minute_count': len(contexts), 'optical_depth_grid': TAU_GRID,
        'h5_sha256': sha256(h5), 'dem_sha256': sha256(dem_path), 'retained_source_pixels': len(geometry),
        'elapsed_seconds': time.perf_counter()-start, 'application_modified': False,
    })
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('h5', 'dem', 'output'):
        parser.add_argument('--'+name, type=Path, required=True)
    args = parser.parse_args(); make_basis(args.h5, args.dem, args.output)
