"""Archive the joint model, all three observation contexts and honest diagnostics."""
import argparse
from dataclasses import asdict
from datetime import datetime,timezone
import importlib.metadata
import json
from pathlib import Path
import platform
import shutil
import subprocess

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from calibrate_three_hour import sha256,error_metrics
from joint_model import MODEL_VERSION,JointParameters,pack,forward
from prepare_joint_basis import DATASETS,write_json
from evaluate_frozen import comparison_plot

RESEARCH=Path(__file__).resolve().parent


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('fit','basis','endpoints','inference'):
        parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args()
    revision=RESEARCH/'revisions/2026-10-28_joint_three_dates'
    snapshot=RESEARCH/'models'/MODEL_VERSION
    run_names={DATASETS[0][0]:'004_joint_three_dates',DATASETS[1][0]:'003_joint_three_dates',DATASETS[2][0]:'004_joint_three_dates'}
    if revision.exists() or snapshot.exists() or any((RESEARCH/'datasets'/name/run).exists() for name,run in run_names.items()):
        raise ValueError('New archive paths must not already exist')
    report=json.loads((args.fit/'report.json').read_text(encoding='utf-8'))
    inference=json.loads(args.inference.read_text(encoding='utf-8'))
    assert inference['absolute_sqm_difference']<2e-8 and inference['native_art_scale_rerun_absolute_sqm_difference']<2e-8
    params=JointParameters(**report['shared_parameters'])
    values=[np.log(params.art_scale),np.log(params.twilight_gain),params.twilight_concentration]
    fitted=pd.read_csv(args.fit/'comparison.csv',float_precision='round_trip').set_index('uid',drop=False)
    endpoints=pd.read_csv(args.endpoints/'transport_basis.csv',float_precision='round_trip')
    rays=json.loads((args.endpoints/'solar_rays.json').read_text(encoding='utf-8'))
    endpoint_rows=[];sensitivity={};endpoint_by_assignment={}
    for assignment in ('start','end'):
        frame=endpoints[endpoints['assignment']==assignment].reset_index(drop=True)
        assert len(frame)==131 and set(frame['uid'])==set(fitted['uid'])
        beam={k.split('/',1)[1]:v for k,v in rays.items() if k.startswith(assignment+'/')}
        prediction,_=forward(values,pack(frame,beam));frame['joint_prediction']=prediction
        frame['representative_prediction']=[fitted.loc[uid,'joint_fit'] for uid in frame['uid']]
        frame['delta_from_representative']=frame['joint_prediction']-frame['representative_prediction']
        for row in frame.to_dict('records'):
            original=fitted.loc[row['uid']]
            assert row['time']==pd.Timestamp(original['time_'+assignment]).strftime('%Y-%m-%d %H:%M')
            assert row['lat']==original['lat'] and row['lon']==original['lon']
        endpoint_rows.extend(frame.to_dict('records'));endpoint_by_assignment[assignment]=frame.set_index('uid')
        sensitivity[assignment]={name:{'metrics':error_metrics(group['joint_prediction']-group['actual_mag']),
                                       'maximum_absolute_prediction_change':float(np.max(np.abs(group['delta_from_representative'])))}
                                 for name,group in frame.groupby('dataset',sort=False)}
    shutil.copytree(args.fit,revision)
    shutil.copytree(args.basis,revision/'basis/representative')
    shutil.copytree(args.endpoints,revision/'basis/time_endpoints')
    shutil.copyfile(args.inference,revision/'inference_verification.json')
    pd.DataFrame(endpoint_rows).to_csv(revision/'time_interval_predictions.csv',index=False)
    write_json(revision/'time_interval_sensitivity.json',{'parameters_fixed_no_refit':True,'scenarios':sensitivity,
               'interpretation':'All observations assigned to their own supplied interval start/end. These are sensitivity scenarios, not recovered individual scan times or confidence intervals.'})
    core=RESEARCH.parents[3]/'backend/src/app/services/sky_brightness_model/core'
    snapshot.mkdir()
    sources={}
    for folder,names in [(RESEARCH,['joint_model.py','prepare_joint_basis.py','joint_three_dates.py','verify_joint_inference.py','archive_joint.py','calibrate_three_hour.py','evaluate_frozen.py']),
                         (core,['calculator.py','config.py','data_loader.py','modern_sky.py','radiative_transfer.py'])]:
        for name in names:
            shutil.copyfile(folder/name,snapshot/name);sources[name]=sha256(folder/name)
    shutil.copyfile(args.fit/'candidate_params.json',snapshot/'candidate_params.json')
    versions={'python':platform.python_version()}
    for package in ('numpy','pandas','scipy','rasterio','numba','astronomy-engine'):
        try:versions[package]=importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:versions[package]='not reported'
    parent=subprocess.run(['git','rev-parse','HEAD'],capture_output=True,text=True,check=True).stdout.strip()
    report.update({'created_at_utc':datetime.now(timezone.utc).isoformat(),
                   'source_parent_commit':parent,'source_snapshot':'models/'+MODEL_VERSION,
                   'source_sha256':sources,'versions':versions,'inference_verification':inference,
                   'time_interval_sensitivity':sensitivity,'backend_tests_passed':102,
                   'all_three_dates_used_for_joint_calibration':True})
    report['limitations'] += [
        'Saved weather is model output received after observing, not a colocated atmospheric measurement or real-time forecast skill test.',
        'Neighboring directions in one SQM-L scan are correlated; 131 rows are not 131 independent nights.',
        'The October 22 date-held-out fit reaches the lower artificial-source scale bound. Coefficients remain uncertain with only three dates.',
    ]
    write_json(revision/'report.json',report)
    write_json(snapshot/'manifest.json',{'model_version':MODEL_VERSION,'source_sha256':sources,
                                       'source_parent_commit':parent,'parameters':asdict(params),
                                       'application_adopted':False,'note':'Research source snapshot. Full repository and frozen input adapters are needed for reproduction.'})
    fitted.reset_index(drop=True).to_csv(revision/'input_and_predictions.csv',index=False)
    # Publication figures use the same saved values; no data are smoothed or dropped.
    plt.rcParams.update({'font.family':'Malgun Gothic','axes.unicode_minus':False})
    labels={'previous_transport':'이전 물리 모델','joint_fit':'3일 공통 보정','angular_holdout':'방향 제외 진단','date_holdout':'관측일 제외 진단'}
    groups=[*report['datasets'],'ALL'];x=np.arange(4);width=.2
    fig,ax=plt.subplots(figsize=(11,5.2))
    for j,label in enumerate(labels):
        metric=[report['datasets'][name][label]['rmse'] for name in groups[:-1]]+[report['aggregate'][label]['rmse']]
        bars=ax.bar(x+(j-1.5)*width,metric,width,label=labels[label])
        ax.bar_label(bars,fmt='%.3f',fontsize=8,padding=3)
    ax.set_xticks(x,[name[:10] for name in groups[:-1]]+['전체 131개'])
    ax.set(ylabel='RMSE (mag/arcsec²)',title='서로 다른 장소·시각의 3일 실측 통합 분석')
    ax.set_ylim(0,1.9);ax.grid(axis='y',alpha=.2);ax.legend(fontsize=9,ncol=2)
    fig.tight_layout();fig.savefig(revision/'rmse_summary_ko.png',dpi=175);plt.close(fig)
    fig,axes=plt.subplots(3,2,figsize=(12,10),layout='constrained')
    for axes_row,(dataset,group) in zip(axes, fitted.groupby('dataset',sort=False)):
        for ax,angle,grid,title in zip(axes_row,['az','altitude'],[np.arange(0,360,15),np.array([30,60,90])],['방위각별 RMSE · 천정 제외','고도별 RMSE']):
            view=group[group['altitude']!=90] if angle=='az' else group
            for label in ('previous_transport','joint_fit','date_holdout'):
                errors=(view[label]-view['actual_mag'])**2
                result=errors.groupby(view[angle]).mean().pow(.5).reindex(grid)
                ax.plot(grid,result.to_numpy(),'.-',label=labels[label])
            ax.set(title=dataset[:10]+' · '+title,xlabel='방위각 (°)' if angle=='az' else '고도 (°)',ylabel='RMSE (mag/arcsec²)')
            ax.set_xticks(np.arange(0,361,60) if angle=='az' else grid);ax.grid(alpha=.2)
            if ax==axes[0,0]:ax.legend(fontsize=8)
    fig.savefig(revision/'directional_rmse_overview.png',dpi=160);plt.close(fig)
    for dataset,csv,_,_ in DATASETS:
        source=revision/dataset;run=RESEARCH/'datasets'/dataset/run_names[dataset]
        run.mkdir()
        for name in ('report.json','comparison.csv','observed_vs_model.png'):
            shutil.copyfile(source/name,run/name)
        shutil.copyfile(RESEARCH/'datasets'/dataset/'inputs'/csv,run/'input.csv')
        shutil.copyfile(source/'joint_fit/rmse_by_direction.png',run/'directional_rmse.png')
        shutil.copyfile(source/'date_holdout/rmse_by_direction.png',run/'date_holdout_directional_rmse.png')
        group=fitted[fitted['dataset']==dataset]
        comparison_plot(group.reset_index(drop=True).to_dict('records'),
                        {'joint_fit':group['joint_fit'].to_numpy(),
                         **{assignment:np.array([endpoint_by_assignment[assignment].loc[uid,'joint_prediction'] for uid in group['uid']]) for assignment in ('start','end')}},
                        source/'time_range.png',title=dataset[:10]+': fixed coefficients; all-at-start/end sensitivity, actual scan order unknown')
        shutil.copyfile(source/'time_range.png',run/'time_range.png')
        (run/'README.md').write_text(f'# {dataset[:10]} · 3일 공통 연구 모델\n\n유효 {len(group)}개를 각자의 장소·시각·API로 계산했다. 세 날짜의 공통 계수를 보정했으며 앱에는 미적용이다.\n\n[전체 조건·보정·날짜 제외 진단](../../../revisions/2026-10-28_joint_three_dates/README.md) · [수치](report.json) · [방향 RMSE](directional_rmse.png) · [시간 범위 민감도](time_range.png).\n',encoding='utf-8',newline='\n')
    metrics_table='\n'.join(f"| {name[:10]} | {m['joint_fit']['n']} | {m['previous_transport']['rmse']:.5f} | {m['joint_fit']['mse']:.5f} | {m['joint_fit']['rmse']:.5f} | {m['angular_holdout']['rmse']:.5f} | {m['date_holdout']['rmse']:.5f} |" for name,m in report['datasets'].items())
    m=report['aggregate'];metrics_table+=f"\n| 전체 | 131 | {m['previous_transport']['rmse']:.5f} | {m['joint_fit']['mse']:.5f} | {m['joint_fit']['rmse']:.5f} | {m['angular_holdout']['rmse']:.5f} | {m['date_holdout']['rmse']:.5f} |"
    readme=f'''# 2026-10-28 · 세 날짜 공통 연구 모델

**22일 49개 + 26일 49개 + 27일 유효 33개 = 131개를 모두 공통 보정에 사용했다. 앱은 미적용이며 공개 0.9.3·legacy를 유지한다.** 원본 147칸 중 27일 결측 16칸만 기존 기준대로 평가에서 제외했다. 새 이상치·달 접근·차폐 제외는 없다.

| 관측일(KST) | 위치 | 시각 처리 |
| --- | --- | --- |
| 10월 22일 | 33.426769, 126.530349 | 고도 30° 21:23~21:28 → 21:25, 60°·천정 22:12~22:18 → 22:15 |
| 10월 26일 | 탐라교육원 운동장 중앙 근사 33.42785, 126.53208 | 18:29~18:35 → 18:32 |
| 10월 27일 | 제주과학고 북쪽 지도 핀 33.426633, 126.530639 | 21:08~21:13 → 21:10 |

장소·시각·기상·DEM 표고·광원 지형을 날짜별로 따로 계산했다. 22일 두 관측 구간도 나눴다. 개별 측정 시각은 없으며 기존 대표 시각을 유지했다. 원본과 API의 해시·모든 보간 끝점·구름 밑면 가정은 [입력 근거](basis/representative/provenance.json)와 [환경](basis/representative/contexts.json)에 있다. 새 유료 API 조회는 없다.

## 결과

| 날짜 | n | 이전 물리 모델 RMSE | 공통 보정 MSE | 공통 보정 RMSE | 방향 제외 RMSE | 관측일 제외 RMSE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
{metrics_table}

이전 물리 모델은 같은 131개에 대한 `sos3d`·SQM-L·기본 광학 두께 10의 미보정 결과이며 황혼 항이 없다. 앱 legacy 결과와 새 모형의 미보정 prior·같은 계수의 복사휘도 평균 방식도 [report.json](report.json)에 함께 저장했다. RMSE 단위는 mag/arcsec², MSE는 그 제곱이다.

![전체 오차](rmse_summary_ko.png)
![방위각·고도별 오차](directional_rmse_overview.png)

## 실제 모델 변경

기존 방향·공간·차수별 복사전달, 달 원반과 직접광·SQM-L 20° 응답은 유지했다. 다중산란 상수 배수를 추가하거나 달을 끄지 않았다. `art_scale`은 위성광의 유효 광원 세기에만 작용한다. native 전달장을 이 계수로 다시 풀어 선형 결합과 일치함을 [확인](inference_verification.json)했다.

1. 각 위치·시각의 맑음/흐림 조건부 전달장과 API 운량 확률 C를 보존한다. SQM의 제곱 오차를 줄이는 점 예측은 `(1-C)*SQM(clear)+C*SQM(cloudy)`다. 기존 `SQM((1-C)*Lclear+C*Lcloud)`도 분리 출력해 비교했다. 둘은 로그 변환 때문에 다르다. 이는 실제 구름 영상 없이 가정한 두 상태 분포이며 차폐를 관측한 것으로 해석하지 않는다.
2. [Patat·Ugolnikov·Postylyakov(2006), Table 1](https://arxiv.org/html/astro-ph/0604128)의 V-band 천정식 `m=11.84+1.518*(ζ-95)-0.057*(ζ-95)²`를 황혼 밝기의 prior로 사용한다. 연구 배경광 22 mag에 해당하는 휘도를 빼 중복 합산을 줄인다. 검증된 문헌 범위는 태양 고도 −15°~−5°다. 밤(≤−18°)은 황혼 항 0, 나머지 범위는 오류로 명시하며 임의 외삽하지 않는다.
3. 황혼의 방향 확장은 이번 연구의 경험식이다. `csc(고도)*exp(k*(cos(태양각거리)-sin(태양고도)))`를 SQM-L 시야에서 적분한다. 천정 기준으로 정규화하고 1° 아래 secant를 제한하며 지평선 아래 광선은 0으로 둔다. 이 항은 구면 태양 복사전달 계산이 아니다.
4. 3일 공통 계수는 광원 배율 **{params.art_scale:.8f}**, 황혼 prior 배율 **{params.twilight_gain:.8f}**, 방향 집중도 **{params.twilight_concentration:.8f}**다. 광학 두께는 사전 정의한 1/10/30 중 훈련 자료에서 **{params.cloud_optical_depth:g}**을 선택했다. 구름 미세물리를 실측·역산한 값으로 주장하지 않는다. 날짜·장소별 자유 오프셋은 없다.

## 보정과 검증 구분

전체 보정은 날짜마다 같은 가중치로 SQM 제곱 잔차를 최소화했다. 27일의 유효 개수가 적다고 그 날짜를 덜 중요하게 두지 않는다. 표의 전체 MSE/RMSE는 일반적인 131행 합산값이므로 최적화 목적값의 날짜 평균과 구분한다.

- 방향 제외: 60° 방위 구간 6개와 천정 1개를 모든 날짜에서 함께 제외했다. 매 분할에서 계수와 광학 두께를 훈련 데이터만으로 다시 선택했다.
- 관측일 제외: 날짜 하나 전체를 빼고 나머지 날짜로만 보정·광학 두께를 선택했다. 대상 실측값은 최적화 목적함수에 접근하지 않는다.
- **26일 제외 시 나머지는 전부 밤이므로 황혼 계수를 학습할 수 없다.** 이때 gain=1, 집중도=1의 선언된 prior를 사용했다. 26일의 0.64272는 이 prior 예측 진단이며 황혼의 독립 재보정 검증이라고 부르지 않는다.
- 세 날짜를 이미 구조 개발에 참고했으므로 모두 사후 진단이다. 독립적인 미래 날짜 검증은 아니다. 인접 15° 관측은 상관되어 있고 날짜·장소·기상이 함께 달라져 효과를 독립적으로 분리할 수 없다.
- 27일은 여전히 오차가 가장 크고, 달 주변과 남쪽 방향의 차이가 남는다. 어떤 관측도 회전·보간·삭제하지 않았고 달 밝기 감쇠 계수를 맞추지 않았다.

## 시각 불확실성과 재현

전체 자료를 각자 구간의 시작/끝에 둔 시나리오를 동일 계수로 재계산했다. [시간 범위 수치](time_interval_sensitivity.json)·[예측표](time_interval_predictions.csv)와 날짜별 `time_range.png`를 따른다. 실제 스캔 시각이나 신뢰구간이 아니다. 특히 한 번의 황혼 스캔만으로 실제 시간 변화율·스캔 순서 효과를 분리할 수 없다.

[모델·계수 스냅샷](../../models/{MODEL_VERSION}/manifest.json) · [반복 계산 검사](inference_verification.json) · [전체 예측](input_and_predictions.csv). 연구 `joint_model.JointSkyModel.from_artifact(candidate_params.json)`로 관측 SQM을 입력하지 않고 위치·방향·한국시간·동일 장소 API·광원/DEM에서 계산할 수 있다.

저장소 루트에서 `PYTHONPATH=backend/src`를 지정하고 `prepare_joint_basis.py --h5 <H5> --dem <DEM> --output <새폴더>`, `joint_three_dates.py --basis <새폴더> --output <새결과폴더>`로 재현한다. 두 스크립트는 이 연구 폴더에 있다. 대용량 원자료·키는 저장소에 포함하지 않는다. Python/라이브러리 버전·실제 소스 해시는 보고서에 고정했다. 102개 테스트와 라벨 없는 추론·native 광원 선형성 검사를 통과했다.
'''
    (revision/'README.md').write_text(readme,encoding='utf-8',newline='\n')
    index_path=RESEARCH/'index.json';index=json.loads(index_path.read_text(encoding='utf-8'))
    index.setdefault('research_model_history',[]).append(index['research_candidate_model'])
    index['latest_model_revision']='revisions/'+revision.name;index['latest_run']='004_joint_three_dates'
    index['active_training_datasets']=[d[0] for d in DATASETS]
    index['twilight_training_datasets']=[DATASETS[1][0]]
    for dataset in index['datasets']:
        if dataset['id'] in run_names:
            dataset['runs'].append(run_names[dataset['id']]);dataset['active_for_fitting']=True
            dataset['active_for_joint_twilight_night_fitting']=True
            dataset['status']='joint_three_date_candidate_calibrated_not_applied'
    index['research_candidate_model']={'version':MODEL_VERSION,'physics_model':'sos3d_with_empirical_twilight_and_expected_sqm',
                                       'revision':index['latest_model_revision'],'adopted_by_app':False,
                                       'coefficient_fit_performed':True,'fitted_datasets':index['active_training_datasets'],
                                       'n':131,'parameters':'models/'+MODEL_VERSION+'/candidate_params.json',
                                       'validation':'Retrospective angular/date-held-out diagnostics; the held-out twilight date uses a declared prior.'}
    write_json(index_path,index)
    results_path=RESEARCH/'RESULTS.md';text=results_path.read_text(encoding='utf-8')
    summary=f'''## 2026-10-28 · 22·26·27일 공통 보정 · 앱 미적용

세 날짜의 서로 다른 장소·시각·기상을 각각 계산하고 131개를 모두 공통 보정에 사용했다. [상세 모델·원본 근거·그래프](revisions/{revision.name}/README.md) · [정확한 수치](revisions/{revision.name}/report.json).

| 날짜 | n | 이전 물리 모델 RMSE | 새 MSE | 새 RMSE | 방향 제외 | 관측일 제외 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
{metrics_table}

황혼이 있는 26일도 태양 항과 함께 보정했다. 날짜별 자유 오프셋이나 달 감쇠 계수는 없다. 26일을 뺀 분할에서는 황혼을 학습할 자료가 없어 선언된 문헌 prior를 사용했다. 전체 보정과 사후 진단을 구분하며 미래 날짜의 독립 검증은 아니다. 앱 모델·빌드·배포는 변경하지 않았다.

'''
    text=text.replace('## 2026-10-28 · 달 피크·구름 전달·차수별 다중산란 개정',summary+'## 2026-10-28 · 달 피크·구름 전달·차수별 다중산란 개정',1)
    text=text.replace('**10월 26일 49개**는 항해 황혼 진단과 국소 황혼 연구로 구분한다.', '**10월 26일 49개**는 황혼으로 구분하며 최신 공통 보정에서는 태양 항을 포함해 함께 사용했다.')
    results_path.write_text(text,encoding='utf-8',newline='\n')
    path=RESEARCH/'README.md';text=path.read_text(encoding='utf-8');lines=text.splitlines(keepends=True)
    lines.insert(1,f'\n현재 연구 후보는 **{MODEL_VERSION}**이다. 22일 49개·26일 49개·27일 유효 33개를 모두 공통 보정했다. [세 날짜 통합 결과와 그래프](revisions/{revision.name}/README.md)를 먼저 확인한다. 앱은 계속 0.9.3·legacy이며 미적용이다. 아래 날짜별 이전 후보 분석은 이력으로 보존한다.\n')
    path.write_text(''.join(lines),encoding='utf-8',newline='\n')
    path=RESEARCH/'CHANGELOG.md';text=path.read_text(encoding='utf-8');lines=text.splitlines(keepends=True)
    lines.insert(1,f'\n## 2026-10-28 · 세 날짜 공통 모델 보정\n\n- 장소·시각·API·광원 지형을 각각 유지하고 22·26·27일 131개를 함께 보정했다. 황혼 prior·시야 방향 항과 SQM 기대값을 추가했으며 물리 달빛·차수별 산란은 유지했다.\n- 전체 MSE/RMSE {m["joint_fit"]["mse"]:.8f}/{m["joint_fit"]["rmse"]:.8f}, 방향 제외 RMSE {m["angular_holdout"]["rmse"]:.8f}, 관측일 제외 {m["date_holdout"]["rmse"]:.8f}. 26일 제외 분할의 황혼 prior 사용과 27일 잔차를 명시했다.\n- 새 원본 참조·조건·예측·방향 그래프·시간 민감도·모델 소스/계수 스냅샷·102개 테스트·라벨 없는 추론 검사를 저장했다. 앱에는 반영하지 않았다.\n')
    path.write_text(''.join(lines),encoding='utf-8',newline='\n')
    repo=RESEARCH.parents[3]
    path=repo/'AGENTS.md';text=path.read_text(encoding='utf-8')
    text+=f'\n## 최신 공통 연구 후보\n\n- 2026-10-28 사용자 요청으로 22·26·27일 데이터 131개를 모두 공통 보정했다. 현재 후보는 `{MODEL_VERSION}`이며 `research/revisions/{revision.name}/`와 `research/models/{MODEL_VERSION}/`에 보존한다. 장소·시각·기상은 각각 유지하고 26일만 태양 황혼 항이 작동한다.\n- 다음 데이터는 `research/joint_model.py`의 `JointSkyModel`과 저장된 공통 계수로 먼저 고정 평가하고, 새 보정은 별도 실행으로 남긴다. 기존 `evaluator.py --physics-model sos3d`는 기본 물리 모델이며 이 공통 보정 계수를 자동 적용하지 않는다.\n- 세 날짜 통합은 연구 전용이며 앱 기본값·소스·빌드·배포는 유지했다. 26일 제외 진단은 황혼 prior를 사용한 것임을 설명하고 독립 미래 검증으로 표현하지 않는다. 새 연구 문헌은 연구 기록에 남기며 앱 반영은 별도 사용자 요청을 따른다.\n'
    path.write_text(text,encoding='utf-8',newline='\n')
    print(json.dumps({'revision':str(revision.relative_to(repo)),'parameters':asdict(params),
                      'sensitivity':sensitivity,'files':len(list(revision.rglob('*')))},ensure_ascii=False))


if __name__=='__main__':main()
