"""Finalize immutable comparison artifacts, provenance, plots and lookup entries."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from compare_transport import DATASETS
from calibrate_three_hour import error_metrics
from app.services.sky_brightness_model.core.config import EnvironmentConfig
from app.services.sky_brightness_model.core.calculator import LightPollutionModel
from app.services.sky_brightness_model.core.modern_sky import run_modern_pipeline


def write_json(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8',newline='\n')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tau1',type=Path,required=True)
    parser.add_argument('--tau30',type=Path,required=True)
    parser.add_argument('--refinement3',type=Path,required=True)
    parser.add_argument('--refinement10',type=Path,required=True)
    parser.add_argument('--wasm-log',type=Path,required=True)
    args=parser.parse_args()
    research=Path(__file__).resolve().parent;repo=research.parents[3]
    revision=research/'revisions/2026-10-28_transport_physics'
    if (revision/'summary.json').exists():
        raise SystemExit('Already finalized; create a new revision instead of overwriting it.')
    targets=[research/'datasets'/dataset/'003_transport_physics' for dataset,_,_ in DATASETS]
    if any(path.exists() for path in targets):
        raise SystemExit('A dataset run already exists.')
    reports={10:json.loads((revision/'nominal_tau10/report.json').read_text(encoding='utf-8'))}
    for tau,source in [(1,args.tau1),(30,args.tau30)]:
        destination=revision/f'scenarios/tau{tau}'
        if destination.exists():
            raise SystemExit('Scenario already archived.')
        shutil.copytree(source,destination)
        reports[tau]=json.loads((destination/'report.json').read_text(encoding='utf-8'))
    provenance={}
    for dataset,csv,cache in DATASETS:
        base=research/'datasets'/dataset
        provenance[dataset]={'observations':f'datasets/{dataset}/inputs/{csv}',
                             'observations_sha256':sha(base/'inputs'/csv),
                             'weather':f'datasets/{dataset}/raw/{cache}',
                             'weather_sha256':sha(base/'raw'/cache)}
    core=repo/'backend/src/app/services/sky_brightness_model/core'
    snapshot=research/'models/sos3d-2026.10.28'
    snapshot.mkdir()
    source_hashes={}
    for name in ['calculator.py','config.py','data_loader.py','modern_sky.py','radiative_transfer.py']:
        shutil.copyfile(core/name,snapshot/name);source_hashes[name]=sha(core/name)
    frames=[pd.read_csv(revision/'nominal_tau10'/dataset/'comparison.csv') for dataset,_,_ in DATASETS]
    joined=pd.concat(frames,ignore_index=True)
    aggregate={label:error_metrics((joined[label]-joined['actual_mag']).to_numpy())
               for label in ['legacy','transport_sky','transport_sqm_l']}
    summary={'revision':'2026-10-28_transport_physics','model_version':'sos3d-2026.10.28',
             'source_parent_commit':'1fe55696161bacaa0ed24fea6288169d047e20da',
             'source_snapshot':'models/sos3d-2026.10.28','source_sha256':source_hashes,
             'data':provenance,'aggregate':aggregate,'nominal':reports[10]['datasets'],
             'cloud_optical_depth_scenarios':{str(tau):report['datasets'] for tau,report in reports.items()},
             'validation':'Retrospective comparison; model structure was inspected using these data. No independent future test.',
             'coefficient_fit_performed':False,'primary_observation_response':'SQM-L, Gaussian FWHM 20 degrees',
             'cloud_optical_depth_status':'Assumed scenarios 1/10/30, not retrieved cloud microphysics; nominal 10 was set before these comparisons.',
             'runtime_adoption':'Directional transport implementation; no old date-specific empirical candidate was adopted.',
             'instrument_warning':'2026-10-27 Moon-proximity measurements disagree with an unoccluded direct Moon expectation. No points rotated, filled or excluded.',
             'limitations':reports[10]['limitations']}
    write_json(snapshot/'manifest.json',{'model_version':summary['model_version'],'files_sha256':source_hashes,
                                       'note':'Immutable core snapshot; runtime data and API keys are not included.'})
    write_json(revision/'refinement_tau3.json',json.loads(args.refinement3.read_text()))
    write_json(revision/'refinement_tau10.json',json.loads(args.refinement10.read_text()))
    log=args.wasm_log.read_text(encoding='utf-8-sig')
    wasm=json.loads(log[log.index('{'):]);assert wasm['passed']
    write_json(revision/'native_wasm_check.json',wasm)
    for target,(dataset,csv,_),frame in zip(targets,DATASETS,frames):
        target.mkdir()
        shutil.copyfile(research/'datasets'/dataset/'inputs'/csv,target/'input.csv')
        frame.to_csv(target/'comparison.csv',index=False)
        shutil.copyfile(revision/'nominal_tau10'/dataset/'transport_sqm_l/rmse_by_direction.png',target/'directional_rmse.png')
        report={'dataset':dataset,'run':'003_transport_physics','n':len(frame),'metrics':summary['nominal'][dataset],
                'response':summary['primary_observation_response'],'conditions':provenance[dataset],
                'source_sha256':source_hashes,'shared_revision':'revisions/2026-10-28_transport_physics',
                'validation':summary['validation'],'coefficient_fit_performed':False}
        write_json(target/'report.json',report)
    # All figures below are generated from this implementation, not paper artwork.
    common=dict(aod=.15,cloud_fraction=.7,cloud_base_h=2,moon_phase_angle_deg=20)
    legacy=LightPollutionModel(EnvironmentConfig(**common,physics_model='legacy'))
    profile=[]
    for rho in np.r_[0.,.05,.1,.2,.27,.3,.5,np.geomspace(.6,80,80)]:
        delta=np.degrees(np.arccos(np.clip(2*np.cos(np.radians(rho))-1,-1,1)))
        angle=(45.,90.+delta)
        old=legacy.calculate_moonlight(*np.radians([45.,90.,*angle]))
        row={'separation_deg':float(rho),'legacy_cd_m2':float(old)}
        for label,fwhm in [('sky',None),('sqm_l',20.)]:
            result=run_modern_pipeline([],angle,(45.,90.),EnvironmentConfig(**common,physics_model='sos3d',instrument_fwhm_deg=fwhm),return_components=True)
            row[label+'_cd_m2']=result['I_ml_final']*683
        profile.append(row)
    profile=pd.DataFrame(profile);profile.to_csv(revision/'moon_profile.csv',index=False)
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10})
    figure,axes=plt.subplots(1,3,figsize=(16,4.6))
    ax=axes[0]
    for column,label in [('legacy_cd_m2','Legacy moon'),('sky_cd_m2','Resolved Moon + scattering'),('sqm_l_cd_m2','SQM-L response')]:
        ax.plot(profile.separation_deg,profile[column],label=label)
    ax.set(xscale='symlog',yscale='log',xlabel='Separation from Moon [deg]',ylabel='Lunar luminance [cd m$^{-2}$]',title='Finite lunar peak (synthetic scene)')
    ax.legend(fontsize=8);ax.grid(alpha=.3)
    ax=axes[1]
    for name,context in reports[10]['contexts'].items():
        data=context['transport_sky_transport']['cloudy']
        ax.semilogy(np.arange(1,len(data['order_fractions'])+1),data['order_fractions'],label=name.split('/')[1])
    ax.axhline(.005,color='gray',linestyle='--',label='Last-order threshold; tail also checked')
    ax.set(xlabel='Interaction order (including ground reflection)',ylabel='Last order / accumulated radiance',title='Observed order convergence')
    ax.legend(fontsize=7);ax.grid(alpha=.3)
    ax=axes[2]
    for dataset,_,_ in DATASETS:
        values=[reports[tau]['datasets'][dataset]['transport_sqm_l']['rmse'] for tau in [1,10,30]]
        ax.plot([1,10,30],values,'o-',label=dataset[:10]+' new SQM-L')
        ax.axhline(reports[10]['datasets'][dataset]['legacy']['rmse'],linestyle=':',alpha=.5)
    ax.set(xlabel='Assumed cloud optical depth',ylabel='RMSE [mag arcsec$^{-2}$]',title='Scenarios, not confidence intervals')
    ax.legend(fontsize=8);ax.grid(alpha=.3)
    figure.tight_layout();figure.savefig(revision/'physics_diagnostics.png',dpi=170);plt.close(figure)
    figure,axes=plt.subplots(1,2,figsize=(11,4))
    for ax,(tau,path) in zip(axes,[(3,revision/'refinement_tau3.json'),(10,revision/'refinement_tau10.json')]):
        data=json.loads(path.read_text())
        ax.plot(data['angular_96']['delta_mag'],'o-',label='96 vs 48 directions')
        ax.plot(data['spatial_x2']['delta_mag'],'s-',label='2x spatial vs base grid')
        ax.axhline(0,color='gray',linewidth=.5)
        ax.set(xticks=range(5),xticklabels=['zenith','60 N','30 E','30 S','30 W'],ylabel='Change in predicted magnitude',title=f'Synthetic cloud tau={tau}')
        ax.legend(fontsize=8);ax.grid(alpha=.3)
    figure.tight_layout();figure.savefig(revision/'grid_refinement.png',dpi=170);plt.close(figure)
    write_json(revision/'summary.json',summary)
    print(json.dumps({'archived':True,'aggregate':aggregate,'revision':str(revision)},indent=2),flush=True)


if __name__=='__main__':
    main()
