"""Offline, bounded calibration of current physics using app-compatible 3h weather."""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import replace
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import importlib.util
import json
from pathlib import Path
import sys

import astronomy
import numpy as np
import pandas as pd
import rasterio
from scipy.optimize import minimize, minimize_scalar

RESEARCH = Path(__file__).resolve().parent
sys.path.insert(0, str(RESEARCH.parent / 'scripts'))
from evaluator import error_metrics, save_directional_report
from app.services.sky_brightness_model.core import calculator as physics
from app.services.sky_brightness_model.core.config import (
    ART_SCALE_RANGE, MOON_TRANSMISSION_SCALE_RANGE, EnvironmentConfig,
)
from app.services.sky_brightness_model.core.data_loader import (
    load_pixel_data_from_h5, pressure_to_cloud_base_height_km,
)

spec = importlib.util.spec_from_file_location(
    'app.services.sky_brightness_model.core._research_time_adapter',
    RESEARCH / 'models/82a295073f54/data_loader.py')
time_adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(time_adapter)


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def weather_at(cache, time, latitude, longitude):
    """Interpolate native 3h/1h arrays using their declared package timezone."""
    values, details = {}, {}
    for package, field in [('p2', 'aod550'), ('p3', 'totalcloudcover'),
                           ('p4', 'convectivecloudbase_pressure')]:
        payload = cache[package]
        meta = payload['metadata']
        coordinates = np.array([meta['latitude'], meta['longitude']], dtype=float)
        if not np.isfinite(coordinates).all() or np.max(np.abs(coordinates-[latitude, longitude])) > 0.001:
            raise ValueError(f'{package}: cache location mismatch')
        block = 'data_3h' if 'data_3h' in payload else 'data_1h'
        matched = time_adapter.get_package_interp_indices(payload, block, time)
        if matched is None:
            raise ValueError(f'{package}: weather does not bracket {time}')
        left, right, fraction = matched
        array = payload[block][field]
        a, b = float(array[left]), float(array[right])
        if not np.isfinite([a,b]).all():
            raise ValueError(f'{package}/{field}: nonfinite weather input')
        values[field] = a + (b-a)*fraction
        times = payload[block]['time']
        steps = Counter((datetime.fromisoformat(y)-datetime.fromisoformat(x)).total_seconds()/3600
                        for x,y in zip(times,times[1:]))
        if any(step <= 0 for step in steps):
            raise ValueError(f'{package}: non-increasing time axis')
        details[package] = {'block':block, 'native_step_hours':list(steps),
                            'left':times[left], 'right':times[right], 'fraction':fraction,
                            'utc_offset_hours':float(meta['utc_timeoffset'])}
    aod, cloud = values['aod550'], values['totalcloudcover']/100
    if not 0 <= aod <= 5 or not 0 <= cloud <= 1:
        raise ValueError('Weather AOD/cloud outside model range')
    pressure = values['convectivecloudbase_pressure']
    height = pressure_to_cloud_base_height_km(pressure, cloud)
    return {'aod':aod, 'cloud_fraction':cloud, 'cloud_base_h':height}, {
        **values, 'cloud_base_h_km':height,
        'cloud_base_fallback':bool(cloud > 0.1 and pressure <= 0), 'interpolation':details}


def lunar_at(time, latitude, longitude, height_m):
    dt = datetime.fromisoformat(time + '+09:00').astimezone(timezone.utc)
    instant = astronomy.Time.Make(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second)
    observer = astronomy.Observer(latitude, longitude, height_m)
    equatorial = astronomy.Equator(astronomy.Body.Moon, instant, observer, True, True)
    horizontal = astronomy.Horizon(instant, observer, equatorial.ra, equatorial.dec, astronomy.Refraction.Normal)
    phase = astronomy.Illumination(astronomy.Body.Moon, instant)
    return {'altitude':horizontal.altitude, 'azimuth':horizontal.azimuth,
            'phase_angle':phase.phase_angle, 'illumination_fraction':phase.phase_fraction,
            'source':'Astronomy Engine; topocentric apparent horizon, geocentric illumination'}


def calibrate(rows, cache, geometry, dem, observer_height, radius):
    components, contexts, environment_records = [], [], {}
    for row in rows:
        key = (row['time'], row['lat'], row['lon'])
        if key not in environment_records:
            weather, details = weather_at(cache, *key)
            lunar = lunar_at(*key, observer_height)
            environment_records[key] = {'weather':weather, 'details':details, 'lunar':lunar}
        env = environment_records[key]
        lunar = env['lunar']
        moon = (90-lunar['altitude'], lunar['azimuth'])
        config = EnvironmentConfig(**env['weather'], moon_phase_angle_deg=lunar['phase_angle'])
        coordinate = (row['lat'],row['lon'])
        shield = physics.calculate_directional_shielding(coordinate, moon[1], *dem, max_dist_km=radius)
        arguments = dict(observer_coordinates=coordinate, observer_angles=(row['zen'],row['az']),
                         moon_angles=moon, pixel_data=geometry, dem_data=dem, config=config,
                         precalc_moon_shield=shield, max_radius_km=radius)
        result = physics.run_pipeline(**arguments, return_components=True)
        components.append(result)
        contexts.append((arguments, shield))
    observed = np.array([row['actual_mag'] for row in rows])
    artificial = np.array([c['I_art_final']+c['I_cloud_final'] for c in components])
    background = np.array([c['I_bg_final'] for c in components])
    moon_cache = {}

    def predict(params):
        transmission = float(params.get('moon_transmission_scale', 1.0))
        if transmission not in moon_cache:
            moon_values = []
            for arguments, shield in contexts:
                config = replace(arguments['config'], moon_transmission_scale=transmission)
                model = physics.LightPollutionModel(config)
                angles = np.radians([*arguments['moon_angles'], *arguments['observer_angles']])
                value = model.calculate_moonlight(*angles, moon_shield_deg=shield)
                moon_values.append(value/683*config.k_multi_scatter)
            moon_cache[transmission] = np.array(moon_values)
        total = artificial * float(params.get('art_scale', 1.0)) + background + moon_cache[transmission]
        if not np.isfinite(total).all() or np.any(total <= 0):
            raise ValueError('Invalid physical radiance')
        return 12.59-2.5*np.log10(total*683)

    baseline = predict({})
    baseline_direct = 12.59-2.5*np.log10(np.array([c['total'] for c in components])*683)
    assert np.allclose(baseline, baseline_direct, rtol=0, atol=1e-12)

    def fit(mask, mode):
        if mode == 'art_only':
            objective = lambda scale: float(np.mean((predict({'art_scale':scale})[mask]-observed[mask])**2))
            optimum = minimize_scalar(objective, bounds=ART_SCALE_RANGE, method='bounded')
            scale = min([*ART_SCALE_RANGE, float(optimum.x)], key=objective)
            return {'art_scale':scale}
        def objective(values):
            params = {'art_scale':float(values[0]), 'moon_transmission_scale':float(values[1])}
            return float(np.mean((predict(params)[mask]-observed[mask])**2))
        bounds = [ART_SCALE_RANGE, MOON_TRANSMISSION_SCALE_RANGE]
        trials = [minimize(objective, initial, bounds=bounds, method='L-BFGS-B')
                  for initial in [(1.,1.),(0.1,0.5),(1.5,2.)]]
        best = min(trials, key=lambda result:result.fun)
        if not best.success and not np.isfinite(best.fun):
            raise ValueError('Bounded fit failed')
        return {'art_scale':float(best.x[0]), 'moon_transmission_scale':float(best.x[1])}

    groups = np.array([6 if row['zen'] == 0 else int(row['az']//60) for row in rows])
    reports, predictions = {}, {'baseline':baseline}
    for mode in ('art_only','art_and_moon'):
        params = fit(np.ones(len(rows),dtype=bool), mode)
        fitted = predict(params)
        holdout = np.empty(len(rows))
        folds = []
        for group in sorted(set(groups)):
            test = groups == group
            train = ~test
            fold_params = fit(train, mode)
            holdout[test] = predict(fold_params)[test]
            folds.append({'group':int(group),'train_ids':[rows[i]['observation_id'] for i in np.where(train)[0]],
                          'test_ids':[rows[i]['observation_id'] for i in np.where(test)[0]],
                          'params':fold_params,'baseline':error_metrics(baseline[test]-observed[test]),
                          'test':error_metrics(holdout[test]-observed[test])})
        altitude_tests = []
        for training_altitude, test_altitude in [(30,60),(60,30)]:
            train = np.array([row['altitude']==training_altitude for row in rows])
            test = np.array([row['altitude']==test_altitude for row in rows])
            cross_params = fit(train,mode)
            altitude_tests.append({'train_altitude':training_altitude,'test_altitude':test_altitude,
                                   'time_confounding':True,'params':cross_params,
                                   'baseline':error_metrics(baseline[test]-observed[test]),
                                   'test':error_metrics(predict(cross_params)[test]-observed[test])})
        reports[mode] = {'params':params, 'fit':error_metrics(fitted-observed),
                         'angular_holdout':error_metrics(holdout-observed), 'folds':folds,
                         'cross_altitude_time_diagnostics':altitude_tests}
        predictions[mode] = fitted
        predictions[mode+'_holdout'] = holdout
    return reports, predictions, contexts, environment_records, components


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('observations','cache','h5','dem','output'):
        parser.add_argument('--'+name, type=Path, required=True)
    parser.add_argument('--max-pixels',type=int,default=1000)
    parser.add_argument('--radius-km',type=float,default=30)
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit('Choose a new output folder; earlier runs must not be overwritten.')
    rows = pd.read_csv(args.observations).to_dict('records')
    for row in rows:
        if not np.isfinite([row[key] for key in ('lat','lon','zen','az','actual_mag')]).all():
            raise ValueError('Nonfinite observation')
        if not (0 <= row['zen'] < 90 and 0 <= row['az'] < 360):
            raise ValueError('Invalid observation angle')
    if len({(row['lat'],row['lon']) for row in rows}) != 1:
        raise ValueError('This runner evaluates one site per data set.')
    cache = json.loads(args.cache.read_text(encoding='utf-8'))
    coordinate = (rows[0]['lat'], rows[0]['lon'])
    with rasterio.open(args.dem) as src:
        dem = (src.read(1),src.transform)
        observer_height = float(next(src.sample([(coordinate[1],coordinate[0])]))[0])
    pixels = load_pixel_data_from_h5(args.h5,coordinate,max_radius_km=args.radius_km)
    if not pixels:
        raise ValueError('No Black Marble pixels')
    geometry = physics.prepare_pixel_geometry(pixels,coordinate,max_radius_km=args.radius_km,dem_data=dem,
                                             keep_radiance_fraction=.99,min_pixels=50,max_pixels=args.max_pixels)
    print(f'Loaded {len(rows)} observations; computing baseline and blocked diagnostics.',flush=True)
    reports, predictions, contexts, environments, components = calibrate(rows,cache,geometry,dem,observer_height,args.radius_km)
    winner = min(reports,key=lambda mode:reports[mode]['angular_holdout']['rmse'])
    candidate = reports[winner]
    direct = []
    for arguments, _ in contexts:
        config = replace(arguments['config'],**candidate['params'])
        total = physics.run_pipeline(**{**arguments,'config':config})
        direct.append(12.59-2.5*np.log10(total*683))
    assert np.allclose(direct,predictions[winner],rtol=0,atol=1e-10)
    args.output.mkdir(parents=True)
    for label, prediction in [('baseline',predictions['baseline']),('candidate',predictions[winner]),
                              ('angular_holdout',predictions[winner+'_holdout'])]:
        output = [{**row,'pred_mag':float(pred),'diff':float(pred-row['actual_mag'])}
                  for row,pred in zip(rows,prediction)]
        save_directional_report(output,str(args.output/label))
    all_results = [{**row,**{name:float(values[i]) for name,values in predictions.items()},**components[i]}
                   for i,row in enumerate(rows)]
    pd.DataFrame(all_results).to_csv(args.output/'comparison.csv',index=False)
    sensitivity = {}
    for bound in ('start','end'):
        boundary_rows = [{**row,'time':str(row['time_'+bound])[:16].replace('T',' ')} for row in rows]
        boundary_components, boundary_environments = [], {}
        for row in boundary_rows:
            weather, details = weather_at(cache,row['time'],row['lat'],row['lon'])
            moon = lunar_at(row['time'],row['lat'],row['lon'],observer_height)
            angles = (90-moon['altitude'],moon['azimuth'])
            shield = physics.calculate_directional_shielding(coordinate,angles[1],*dem,max_dist_km=args.radius_km)
            cfg = EnvironmentConfig(**weather,moon_phase_angle_deg=moon['phase_angle'])
            base_args = dict(observer_coordinates=coordinate,observer_angles=(row['zen'],row['az']),moon_angles=angles,
                             pixel_data=geometry,dem_data=dem,precalc_moon_shield=shield,max_radius_km=args.radius_km)
            pair = [physics.run_pipeline(**base_args,config=replace(cfg,**params))
                    for params in ({},candidate['params'])]
            boundary_components.append([12.59-2.5*np.log10(value*683) for value in pair])
            boundary_environments[row['time']] = {'weather':weather,'details':details,'lunar':moon}
        predicted = np.array(boundary_components)
        actual = np.array([row['actual_mag'] for row in rows])
        sensitivity[bound] = {'baseline':error_metrics(predicted[:,0]-actual),
                              'candidate_fixed_params':error_metrics(predicted[:,1]-actual),
                              'max_baseline_prediction_shift':float(np.max(np.abs(predicted[:,0]-predictions['baseline']))),
                              'max_candidate_prediction_shift':float(np.max(np.abs(predicted[:,1]-predictions[winner]))),
                              'environments':boundary_environments}
    report = {'n':len(rows), 'baseline':error_metrics(predictions['baseline']-np.array([row['actual_mag'] for row in rows])),
              'candidates':reports, 'selected_candidate':winner, 'candidate_status':'diagnostic_only_not_applied',
              'parameter_bounds':{'art_scale':ART_SCALE_RANGE,'moon_transmission_scale':MOON_TRANSMISSION_SCALE_RANGE},
              'model_selection':'Lowest angular holdout RMSE among two predefined candidates; no independent model-selection test set.',
              'environments':{str(key):value for key,value in environments.items()},'observer_height_m':observer_height,
              'time_interval_sensitivity':sensitivity, 'geometry':{'max_pixels':args.max_pixels,'radius_km':args.radius_km},
              'hashes':{name:sha256(getattr(args,name)) for name in ('observations','cache','h5','dem')},
              'runtime':{name:importlib.metadata.version(name) for name in ('numpy','scipy','astronomy-engine','numba','rasterio','h5py')},
              'limitations':['One date and location; angular and cross-altitude holdouts do not validate across nights.',
                             'Altitude and time are confounded; rings were measured about 50 minutes apart.',
                             'Times are interval representatives, not per-direction measurement timestamps.',
                             'Astronomy Engine supplies lunar context for this research; app uses Stellarium.',
                             'No seeing was fetched; current brightness calculator does not use seeing.',
                             'Weather captured after observations; retrospective comparison.']}
    (args.output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    (args.output/'candidate_params.json').write_text(json.dumps(candidate['params'],indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'baseline':report['baseline'],'selected':winner,
                      'candidate':candidate['fit'],'holdout':candidate['angular_holdout'],
                      'params':candidate['params']},indent=2),flush=True)


if __name__ == '__main__':
    main()
