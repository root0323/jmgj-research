"""Exploratory angular twilight term; not a calibrated twilight evolution model.

At the supplied time, add positive luminance A*csc(alt)*exp(k*(cos(separation)-1))
to the unmodified production model. A and k are fitted in magnitude space.
The amplitude has no validated dependence on solar depression or weather.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import minimize

from evaluate_frozen import comparison_plot
from calibrate_three_hour import error_metrics, save_directional_report, sha256

BOUNDS = [(-6.,1.),(0.,8.)]  # log10(A / cd m^-2), directional concentration


def solar_basis(altitude, azimuth, sun_altitude, sun_azimuth):
    altitude, azimuth = np.broadcast_arrays(np.asarray(altitude,dtype=float),np.asarray(azimuth,dtype=float))
    if (not np.isfinite(altitude).all() or not np.isfinite(azimuth).all()
            or not np.isfinite([sun_altitude,sun_azimuth]).all()
            or np.any(altitude<=0) or np.any(altitude>90) or not -18<sun_altitude<0):
        raise ValueError('The local twilight probe requires valid above-horizon targets and twilight Sun')
    alt, az = np.radians(altitude), np.radians(azimuth)
    sun_alt, sun_az = np.radians([sun_altitude,sun_azimuth])
    cosine = np.clip(np.sin(alt)*np.sin(sun_alt)+np.cos(alt)*np.cos(sun_alt)*np.cos(az-sun_az),-1,1)
    return cosine, 1/np.sin(alt)


def predict(base_mag, params, basis):
    cosine, airmass = basis
    amplitude = 10**float(params['log10_amplitude'])
    added = amplitude*airmass*np.exp(float(params['concentration'])*(cosine-1))
    luminance = 10**((12.59-np.asarray(base_mag))/2.5)+added
    return 12.59-2.5*np.log10(luminance)


def fit(base, observed, basis, mask):
    def objective(values):
        params = {'log10_amplitude':float(values[0]),'concentration':float(values[1])}
        return float(np.mean((predict(base,params,basis)[mask]-observed[mask])**2))
    trials = [minimize(objective,initial,method='L-BFGS-B',bounds=BOUNDS)
              for initial in [(-2.,0.),(-1.,2.),(0.,5.)]]
    successful = [trial for trial in trials if trial.success and np.isfinite(trial.fun)]
    if not successful:
        raise ValueError('Twilight optimizer failed')
    winner = min(successful,key=lambda trial:trial.fun)
    return {'log10_amplitude':float(winner.x[0]),'concentration':float(winner.x[1])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evaluation',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit('Output exists; choose a new run directory')
    source_report=args.evaluation/'report.json'; source_csv=args.evaluation/'comparison.csv'
    original = json.loads(source_report.read_text(encoding='utf-8'))
    rows = pd.read_csv(source_csv).to_dict('records')
    base = np.array([row['representative_baseline'] for row in rows])
    observed = np.array([row['actual_mag'] for row in rows])
    altitude = np.array([row['altitude'] for row in rows])
    azimuth = np.array([row['az'] for row in rows])
    sun = original['environments']['representative']['sun']
    basis = solar_basis(altitude,azimuth,sun['altitude'],sun['azimuth'])
    params = fit(base,observed,basis,np.ones(len(rows),dtype=bool))
    fitted = predict(base,params,basis)
    groups = np.array([6 if row['zen']==0 else int(row['az']//60) for row in rows])
    holdout = np.full(len(rows),np.nan); folds=[]
    for group in sorted(set(groups)):
        test = groups==group
        fitted_params = fit(base,observed,basis,~test)
        holdout[test] = predict(base,fitted_params,basis)[test]
        train_ids = [row['observation_id'] for i,row in enumerate(rows) if not test[i]]
        test_ids = [row['observation_id'] for i,row in enumerate(rows) if test[i]]
        assert not set(train_ids)&set(test_ids)
        folds.append({'held_out_group':int(group),'params':fitted_params,'train_ids':train_ids,'test_ids':test_ids,
                      'test':error_metrics(holdout[test]-observed[test])})
    assert sorted(i for fold in folds for i in fold['test_ids'])==sorted(row['observation_id'] for row in rows)
    cross_altitude=[]
    for train_alt,test_alt in [(30,60),(60,30)]:
        trained = fit(base,observed,basis,altitude==train_alt)
        test = altitude==test_alt
        cross_altitude.append({'train_altitude':train_alt,'test_altitude':test_alt,'params':trained,
                               'test':error_metrics(predict(base,trained,basis)[test]-observed[test])})
    sensitivity={}
    endpoint_predictions={}
    for assignment in ('interval_start','interval_end'):
        endpoint_sun=original['environments'][assignment]['sun']
        endpoint_base=np.array([row[assignment+'_baseline'] for row in rows])
        endpoint_basis=solar_basis(altitude,azimuth,endpoint_sun['altitude'],endpoint_sun['azimuth'])
        endpoint=predict(endpoint_base,params,endpoint_basis)
        endpoint_predictions[assignment]=endpoint
        sensitivity[assignment]={'metrics':error_metrics(endpoint-observed),
                                'maximum_prediction_change':float(np.max(np.abs(endpoint-fitted)))}
    args.output.mkdir(parents=True)
    for name, values in [('twilight_fit',fitted),('angular_holdout',holdout)]:
        save_directional_report([{**row,'pred_mag':float(value),'diff':float(value-row['actual_mag'])}
                                 for row,value in zip(rows,values)],str(args.output/name))
    pd.DataFrame([{**row,'twilight_fit':float(fitted[i]),'angular_holdout':float(holdout[i]),
                   **{label+'_twilight':float(values[i]) for label,values in endpoint_predictions.items()}}
                  for i,row in enumerate(rows)]).to_csv(args.output/'comparison.csv',index=False)
    comparison_plot(rows,{'baseline':base,'twilight_fit':fitted,'angular_holdout':holdout},
                    args.output/'observed_vs_model.png',
                    title='Exploratory local twilight term: fitted and held-out azimuth sectors; one interval only')
    report={'n':len(rows),'base_model':'Unmodified production defaults, not the October 22 cloud/moon candidate',
            'equation':'L_total = L_production + A*csc(alt)*exp(k*(cos(solar_separation)-1)); SQM=12.59-2.5*log10(L_total)',
            'luminance_unit':'cd/m^2 (same photometric conversion as production, L=683*I)',
            'params':params,'amplitude_cd_m2':10**params['log10_amplitude'],'bounds':BOUNDS,
            'fit':error_metrics(fitted-observed),'angular_holdout':error_metrics(holdout-observed),
            'folds':folds,'cross_altitude':cross_altitude,'fixed_amplitude_endpoint_sensitivity':sensitivity,
            'baseline':original['metrics']['representative']['baseline'],
            'previous_frozen_candidate':original['metrics']['representative']['frozen_candidate'],
            'solar_context':sun,'source_evaluation_sha256':sha256(source_report),
            'source_predictions_sha256':sha256(source_csv),
            'model_defaults_changed':False,'status':'exploratory_local_twilight_candidate_not_adopted',
            'limitations':['Only two angular shape parameters; this is an empirical angular probe, not radiative transfer.',
                           'Designed after inspecting this new observation set; angular CV is exploratory, not an independent new-night test.',
                           'No fitted or validated amplitude law versus solar altitude, cloud, AOD or wavelength.',
                           'Only one 6-minute twilight interval with unknown per-direction times; sky evolution and scan order are confounded.',
                           'Endpoint sensitivity holds amplitude fixed and cannot estimate actual twilight brightness evolution.',
                           'Bright artificial sources or local direct light can mimic directional twilight; no causal attribution established.',
                           'No application to other times, dates, locations or production defaults has been validated.',
                           'Instrument angle response and obstruction status have the limitations recorded in the source evaluation.']}
    (args.output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8',newline='\n')
    (args.output/'candidate_params.json').write_text(json.dumps(params,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({key:report[key] for key in ('params','fit','angular_holdout','cross_altitude')},indent=2))


if __name__=='__main__':
    main()
