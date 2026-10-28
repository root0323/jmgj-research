"""Fit one shared candidate to all three dates and report leakage-safe splits."""
import argparse
from dataclasses import asdict
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from calibrate_three_hour import error_metrics,save_directional_report,sha256
from prepare_joint_basis import write_json,DATASETS
from evaluate_frozen import comparison_plot
from joint_model import MODEL_VERSION,TAU_GRID,BOUNDS,PRIOR,pack,forward,fit_grid


def evaluate_metrics(frame,columns):
    result={}
    for label in columns:
        values=frame[label].to_numpy(float)
        assert np.isfinite(values).all()
        result[label]=error_metrics(values-frame['actual_mag'].to_numpy(float))
    return result


def fit_joint(basis_path,output):
    if output.exists():
        raise ValueError('Output already exists; choose a new immutable run')
    output.mkdir(parents=True)
    basis=pd.read_csv(basis_path/'transport_basis.csv',float_precision='round_trip')
    all_rays=json.loads((basis_path/'solar_rays.json').read_text(encoding='utf-8'))
    rays={k.split('/',1)[1]:v for k,v in all_rays.items() if k.startswith('representative/')}
    frames={tau:basis[(basis['cloud_tau']==tau)&(basis['assignment']=='representative')].reset_index(drop=True) for tau in TAU_GRID}
    reference=frames[10.].copy()
    assert len(reference)==131 and reference['uid'].is_unique
    for value in frames.values():
        assert value['uid'].tolist()==reference['uid'].tolist()
        assert np.array_equal(value['actual_mag'],reference['actual_mag'])
    packed={tau:pack(value,rays) for tau,value in frames.items()}
    observed=reference['actual_mag'].to_numpy(float)
    dates=reference['dataset'].to_numpy()
    params,values,diagnostic=fit_grid(packed,observed,dates,np.ones(len(reference),bool))
    fitted,details=forward(values,packed[params.cloud_optical_depth])
    prior,_=forward(PRIOR,packed[10.])
    _,old=forward((0.,-1000.,1.),packed[10.])
    reference['previous_transport']=old['radiance_mean_sqm']
    reference['joint_prior']=prior;reference['joint_fit']=fitted
    reference['joint_fit_radiance_mean']=details['radiance_mean_sqm']
    reference['fitted_clear_sqm']=details['clear_sqm'];reference['fitted_cloudy_sqm']=details['cloudy_sqm']
    reference['fitted_twilight_cd_m2']=details['twilight_cd_m2']
    reports={}
    for scheme in ('date_holdout','angular_holdout'):
        groups=dates if scheme=='date_holdout' else np.where(reference['altitude']==90,6,reference['az']//60).astype(int)
        prediction=np.full(len(reference),np.nan);folds=[];coverage=np.zeros(len(reference),int)
        for group in np.unique(groups):
            test=groups==group;train=~test
            fold_params,fold_values,fold_diagnostic=fit_grid(packed,observed,dates,train)
            fold_prediction,_=forward(fold_values,packed[fold_params.cloud_optical_depth])
            prediction[test]=fold_prediction[test];coverage[test]+=1
            train_ids=reference.loc[train,'uid'].tolist();test_ids=reference.loc[test,'uid'].tolist()
            assert not set(train_ids)&set(test_ids)
            if scheme=='date_holdout':
                assert not set(dates[train])&set(dates[test])
            folds.append({'held_out_group':str(group),'train_uids':train_ids,'test_uids':test_ids,
                          'parameters':asdict(fold_params),'diagnostic':fold_diagnostic,
                          'test_metrics':error_metrics(prediction[test]-observed[test])})
            print(f'{scheme}: {group}; test RMSE {folds[-1]["test_metrics"]["rmse"]:.5f}',flush=True)
        assert np.all(coverage==1) and np.isfinite(prediction).all()
        reference[scheme]=prediction;reports[scheme]={'folds':folds,'coverage_once_per_uid':True}
    columns=['legacy','previous_transport','joint_prior','joint_fit','joint_fit_radiance_mean','angular_holdout','date_holdout']
    overall=evaluate_metrics(reference,columns)
    by_date={name:evaluate_metrics(value,columns) for name,value in reference.groupby('dataset',sort=False)}
    for dataset,_,_,_ in DATASETS:
        frame=reference[reference['dataset']==dataset].copy()
        destination=output/dataset;destination.mkdir()
        rows=frame.to_dict('records')
        for label in ('previous_transport','joint_fit','angular_holdout','date_holdout'):
            save_directional_report([{**row,'pred_mag':row[label],'diff':row[label]-row['actual_mag']} for row in rows],str(destination/label))
        comparison_plot(rows,{label:frame[label].to_numpy() for label in ('previous_transport','joint_fit','date_holdout')},
                        destination/'observed_vs_model.png',title=f'{dataset[:10]} | same site/time weather per observation | date-holdout is diagnostic')
        frame.to_csv(destination/'comparison.csv',index=False)
        write_json(destination/'report.json',{'dataset':dataset,'n':len(frame),'metrics':by_date[dataset],
                                             'shared_parameters':asdict(params),'model_version':MODEL_VERSION,
                                             'coefficient_fit_scope':[item[0] for item in DATASETS],
                                             'app_adopted':False})
    reference.to_csv(output/'comparison.csv',index=False)
    report={'model_version':MODEL_VERSION,'n':len(reference),'datasets':by_date,'aggregate':overall,
            'shared_parameters':asdict(params),'fit_diagnostic':diagnostic,'validation':reports,
            'fit_objective':'Equal weight per observation date, squared SQM residuals. No date/site offsets.',
            'point_estimator':'E[SQM|cloud probability]=(1-C)*SQM(clear)+C*SQM(cloudy). Both conditional skies and SQM(E[radiance]) are retained.',
            'fixed_moon':'Physical lunar phase, finite disk, SQM-L 20 deg response and terrain horizon retained. No fitted Moon dimmer or invented cloud mask.',
            'optical_depth_grid':TAU_GRID,'parameter_bounds_log_art_log_twilight_concentration':BOUNDS,
            'twilight_prior':{'source':'Patat, Ugolnikov & Postylyakov 2006, Table 1, V band',
                              'doi':'https://doi.org/10.1051/0004-6361:20064992','coefficients':[11.84,1.518,-.057],
                              'domain_solar_altitude_deg':[-15,-5],'night_zero_below_deg':-18,
                              'natural_background_subtracted_mag':22.,
                              'angular_extension':'Empirical csc(alt)*exp(k*(cos(solar separation)-sin(solar altitude))), integrated over the fixed SQM-L beam; secant limited at 1 deg.',
                              'gain_and_shape':'Shared fitted parameters, informed only by the available October 26 twilight interval.'},
            'basis_provenance':json.loads((basis_path/'provenance.json').read_text(encoding='utf-8')),
            'input_basis_sha256':sha256(basis_path/'transport_basis.csv'),
            'app_adopted':False,'production_defaults_modified':False,
            'limitations':[
                'All three dates contributed to development; these are retrospective diagnostics, not independent future validation.',
                'Only one twilight date exists. When October 26 is held out, twilight gain/shape cannot be estimated from the remaining nights and use declared prior values instead.',
                'Date, site and weather change together; their independent causal effects cannot be identified from these three dates.',
                'Saved weather products were received after the observations. They are model inputs, not colocated measured atmosphere or a real-time forecast test.',
                'Per-direction measurement times and actual cloud/building occlusion are unknown. Midpoints and supplied coordinates are used without fabricating scan times.',
                'The Patat prior is V-band at Paranal. SQM-L bandpass, local atmospheric differences and angular extrapolation are empirical here.',
                'The clear/cloudy two-state distribution is an approximation to instantaneous cloud uncertainty, not measured cloud morphology or a calibrated prediction interval.',
                'Cloud optical depth is selected from assumed scenarios, not a measured cloud microphysical retrieval.',
                'Solar multiple scattering is represented by an empirical observed twilight law, not a spherical radiative-transfer calculation.',
            ]}
    write_json(output/'report.json',report)
    write_json(output/'candidate_params.json',{'model_version':MODEL_VERSION,'parameters':asdict(params),
                                             'coefficient_fit_performed':True,'all_three_dates_used':True,
                                             'application_adopted':False,'point_estimator':report['point_estimator']})
    fig,ax=plt.subplots(figsize=(11,5))
    groups=[*by_date,'ALL (131)'];x=np.arange(len(groups));width=.19
    for i,label in enumerate(('previous_transport','joint_fit','angular_holdout','date_holdout')):
        metrics=[by_date[name][label]['rmse'] for name in by_date]+[overall[label]['rmse']]
        ax.bar(x+(i-1.5)*width,metrics,width,label=label.replace('_',' '))
    ax.set_xticks(x,[name[:10] for name in by_date]+['All dates'])
    ax.set(ylabel='RMSE (mag/arcsec^2)',title='Three dates, distinct sites/times | fitted error and held-out diagnostics')
    ax.grid(axis='y',alpha=.25);ax.legend(fontsize=9);fig.tight_layout();fig.savefig(output/'rmse_summary.png',dpi=170);plt.close(fig)
    print(json.dumps({'parameters':asdict(params),'aggregate':overall,'by_date':by_date},indent=2),flush=True)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--basis',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();fit_joint(args.basis,args.output)
