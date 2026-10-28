"""Compare bounded existing-physics and empirical cloud/moon-scattering candidates."""
import argparse
from dataclasses import replace
from pathlib import Path
import json

import numpy as np
import pandas as pd
import rasterio
from scipy.optimize import minimize

from calibrate_three_hour import (
    RESEARCH, EnvironmentConfig, error_metrics, load_pixel_data_from_h5,
    lunar_at, physics, save_directional_report, sha256, weather_at,
)

G_GRID = [0.5,0.6,0.7,0.8,0.9]
BOUNDS = {'existing_scattering':[(0.1,1.5),(1.0,3.0)],
          'cloud_moon_scattering':[(0.05,3.0),(0.0,200.0)]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('observations','cache','h5','dem','output'):
        parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--max-pixels',type=int,default=1000)
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit('Output exists; use a new run directory.')
    rows = pd.read_csv(args.observations).to_dict('records')
    observed = np.array([row['actual_mag'] for row in rows])
    cache = json.loads(args.cache.read_text(encoding='utf-8'))
    coordinate = (rows[0]['lat'],rows[0]['lon'])
    with rasterio.open(args.dem) as source:
        dem = (source.read(1),source.transform)
        height = float(next(source.sample([(coordinate[1],coordinate[0])]))[0])
    pixels = load_pixel_data_from_h5(args.h5,coordinate,max_radius_km=30)
    geometry = physics.prepare_pixel_geometry(pixels,coordinate,max_radius_km=30,dem_data=dem,
                                             keep_radiance_fraction=.99,min_pixels=50,max_pixels=args.max_pixels)
    if not geometry:
        raise ValueError('No pixel geometry')
    contexts, environments = [], {}
    for row in rows:
        if row['time'] not in environments:
            weather, details = weather_at(cache,row['time'],*coordinate)
            moon = lunar_at(row['time'],*coordinate,height)
            environments[row['time']] = {'weather':weather,'details':details,'moon':moon}
        env = environments[row['time']]
        moon = env['moon']
        config = EnvironmentConfig(**env['weather'],moon_phase_angle_deg=moon['phase_angle'])
        moon_angles = (90-moon['altitude'],moon['azimuth'])
        shield = physics.calculate_directional_shielding(coordinate,moon_angles[1],*dem,max_dist_km=30)
        contexts.append(dict(observer_coordinates=coordinate,observer_angles=(row['zen'],row['az']),
                             moon_angles=moon_angles,pixel_data=geometry,dem_data=dem,config=config,
                             precalc_moon_shield=shield,max_radius_km=30))
    prepared, component_rows = {}, []
    for g in G_GRID:
        result = [physics.run_pipeline(**{**context,'config':replace(context['config'],g=g)},return_components=True)
                  for context in contexts]
        prepared[g] = {name:np.array([row[name] for row in result])
                       for name in ('I_art_final','I_cloud_final','I_ml_final','I_bg_final')}
        component_rows.extend({'observation_id':row['observation_id'],'g':g,**part}
                              for row,part in zip(rows,result))
        print(f'Prepared physical scattering g={g:.1f}',flush=True)
    cloud_effect = np.array([context['config'].cloud_effect_fraction for context in contexts])
    aod = np.array([context['config'].aod for context in contexts])
    base_multiple = np.array([context['config'].k_multi_scatter for context in contexts])
    fixed_b = EnvironmentConfig().ms_b

    def predict(params, mode):
        data = prepared[params['g']]
        art = (data['I_art_final']+data['I_cloud_final'])*params['art_scale']
        moon = data['I_ml_final']
        if mode == 'cloud_moon_scattering':
            moon = moon*(1+params['moon_cloud_gain']*cloud_effect)
        total = art + moon + data['I_bg_final']
        if mode == 'existing_scattering':
            total = total*(params['ms_a']+fixed_b*aod)/base_multiple
        if not np.isfinite(total).all() or np.any(total <= 0):
            raise ValueError('Invalid predicted radiance')
        return 12.59-2.5*np.log10(total*683)

    baseline = predict({'g':.9,'art_scale':1.,'ms_a':EnvironmentConfig().ms_a},'existing_scattering')
    def fit(mask, mode):
        parameter = 'ms_a' if mode == 'existing_scattering' else 'moon_cloud_gain'
        choices = []
        for g in G_GRID:
            def objective(values):
                params = {'g':g,'art_scale':float(values[0]),parameter:float(values[1])}
                return float(np.mean((predict(params,mode)[mask]-observed[mask])**2))
            starts = [(1.,1.),(0.2,3.)] if mode == 'existing_scattering' else [(1.,0.),(.5,50.),(.2,150.)]
            for initial in starts:
                trial = minimize(objective,initial,bounds=BOUNDS[mode],method='L-BFGS-B')
                if trial.success:
                    choices.append((trial.fun,{'g':g,'art_scale':float(trial.x[0]),parameter:float(trial.x[1])}))
        if not choices:
            raise ValueError('All bounded optimizer starts failed.')
        return min(choices,key=lambda item:item[0])[1]
    groups = np.array([6 if row['zen']==0 else int(row['az']//60) for row in rows])
    reports, predictions = {}, {'baseline':baseline}
    for mode in BOUNDS:
        params = fit(np.ones(len(rows),dtype=bool),mode)
        fitted = predict(params,mode)
        holdout = np.empty(len(rows))
        folds = []
        for group in sorted(set(groups)):
            test = groups == group
            fold_params = fit(~test,mode)
            holdout[test] = predict(fold_params,mode)[test]
            folds.append({'held_out_group':int(group),'params':fold_params,
                          'train_ids':[rows[i]['observation_id'] for i in np.where(~test)[0]],
                          'test_ids':[rows[i]['observation_id'] for i in np.where(test)[0]],
                          'baseline':error_metrics(baseline[test]-observed[test]),
                          'test':error_metrics(holdout[test]-observed[test])})
        cross_altitude = []
        for train_alt,test_alt in [(30,60),(60,30)]:
            train = np.array([row['altitude']==train_alt for row in rows])
            test = np.array([row['altitude']==test_alt for row in rows])
            alt_params = fit(train,mode)
            cross_altitude.append({'train_altitude':train_alt,'test_altitude':test_alt,'params':alt_params,
                                   'test':error_metrics(predict(alt_params,mode)[test]-observed[test])})
        reports[mode] = {'params':params,'fit':error_metrics(fitted-observed),
                         'angular_holdout':error_metrics(holdout-observed),'folds':folds,
                         'cross_altitude_time_diagnostics':cross_altitude}
        predictions[mode],predictions[mode+'_holdout'] = fitted,holdout
        print(json.dumps({'mode':mode,**{key:reports[mode][key] for key in ('params','fit','angular_holdout')}}),flush=True)
    winner = min(reports,key=lambda mode:reports[mode]['angular_holdout']['rmse'])
    selected = reports[winner]
    direct = []
    for context in contexts:
        parameters = {key:value for key,value in selected['params'].items() if key != 'moon_cloud_gain'}
        config = replace(context['config'],**parameters)
        parts = physics.run_pipeline(**{**context,'config':config},return_components=True)
        total = parts['total']
        if winner == 'cloud_moon_scattering':
            total += parts['I_ml_final']*selected['params']['moon_cloud_gain']*config.cloud_effect_fraction
        direct.append(12.59-2.5*np.log10(total*683))
    assert np.allclose(direct,predictions[winner],rtol=0,atol=1e-10)
    args.output.mkdir(parents=True)
    for label,values in [('baseline',baseline),('candidate',predictions[winner]),('angular_holdout',predictions[winner+'_holdout'])]:
        save_directional_report([{**row,'pred_mag':float(value),'diff':float(value-row['actual_mag'])}
                                 for row,value in zip(rows,values)],str(args.output/label))
    pd.DataFrame([{**row,**{name:float(values[i]) for name,values in predictions.items()}}
                  for i,row in enumerate(rows)]).to_csv(args.output/'comparison.csv',index=False)
    pd.DataFrame(component_rows).to_csv(args.output/'scattering_components.csv',index=False)
    report = {'n':len(rows),'baseline':error_metrics(baseline-observed),'candidates':reports,
              'selected_candidate':winner,'candidate_status':'research_candidate_not_applied',
              'g_grid':G_GRID,'continuous_bounds':BOUNDS,'environments':environments,'observer_height_m':height,
              'candidate_equation':'I_total = I_art*art_scale + I_bg + I_moon*(1 + moon_cloud_gain*cloud_effect_fraction)',
              'existing_equation':'Current model with g, art_scale, ms_a fitted; ms_b fixed to avoid single-night degeneracy.',
              'model_selection':'Candidate-family selection uses diagnostic CV; no independent selection test set.',
              'new_parameter_limitation':'moon_cloud_gain is empirical and confounded with absolute moonlight scale at this narrow cloud range. It is not proof of cloud-scattering physics.',
              'hashes':{name:sha256(getattr(args,name)) for name in ('observations','cache','h5','dem')},
              'geometry':{'max_pixels':args.max_pixels,'radius_km':30},
              'direct_pipeline_prediction_max_delta':float(np.max(np.abs(np.array(direct)-predictions[winner]))),
              'limitations':['Single date/site; no independent-night validation.',
                             'Individual reading times are unknown; sky changes can affect angular and altitude comparisons.',
                             'Three-hour weather cannot resolve cloud changes within the observation intervals.',
                             'No azimuth rotation, obstruction removal or direction-specific fitted correction was used.',
                             'New cloud/moon gain exists only in research; production calculator is unchanged.']}
    (args.output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    (args.output/'candidate_params.json').write_text(json.dumps(selected['params'],indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'selected':winner,'params':selected['params'],'baseline':report['baseline'],
                      'fit':selected['fit'],'holdout':selected['angular_holdout']},indent=2),flush=True)


if __name__ == '__main__':
    main()
