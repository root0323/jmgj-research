"""Preserve the four-date study and both new-date evaluations without overwrite."""
import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import importlib.metadata
import json
from pathlib import Path
import platform
import re
import shutil
import subprocess

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from calibrate_three_hour import sha256, error_metrics, save_directional_report
from evaluate_frozen import comparison_plot
from prepare_joint_basis import RESEARCH, DATASETS, write_json
from prepare_rooftop_basis import DATASET, WEATHER
from roof_model import MODEL_VERSION

REVISION = '2026-10-28_four_dates_rooftop'
RUNS = {DATASETS[0][0]: '005_four_dates_rooftop', DATASETS[1][0]: '004_four_dates_rooftop',
        DATASETS[2][0]: '005_four_dates_rooftop', DATASET: '002_four_dates_rooftop'}


def main(fit, rooftop_basis, inference_path, test_log):
    revision = RESEARCH/'revisions'/REVISION; snapshot = RESEARCH/'models'/MODEL_VERSION
    frozen_run = RESEARCH/'datasets'/DATASET/'001_frozen_three_day'
    if revision.exists() or snapshot.exists() or frozen_run.exists() or any((RESEARCH/'datasets'/name/run).exists() for name, run in RUNS.items()):
        raise ValueError('Archive destinations must be new')
    inference = json.loads(inference_path.read_text(encoding='utf-8'))
    assert inference['native_vs_cached_absolute_sqm_difference'] < 2e-8
    assert inference['unobstructed_vs_previous_wrapper_absolute_sqm_difference'] < 2e-8
    assert inference['native_source_gain_and_direct_disk_flag_absolute_sqm_difference'] < 2e-8
    log = test_log.read_text(encoding='utf-8-sig')
    match = re.search(r'Ran (\d+) tests', log)
    assert match and int(match[1]) == 106 and re.search(r'\nOK\s*\n', log)
    repo = RESEARCH.parents[3]
    parent = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=repo, capture_output=True, text=True, check=True).stdout.strip()
    changes = subprocess.run(['git', 'diff', '--name-only'], cwd=repo, capture_output=True, text=True, check=True).stdout.splitlines()
    assert all(name == 'AGENTS.md' or name.startswith(('backend/tools/sky_brightness/research/', 'backend/tests/')) for name in changes)
    shutil.copytree(fit, revision)
    native = revision/'basis/rooftop_native'; native.mkdir()
    for name in ('transport_basis.csv', 'contexts.json', 'solar_rays.json', 'provenance.json'):
        shutil.copyfile(rooftop_basis/name, native/name)
    shutil.copyfile(inference_path, revision/'inference_verification.json')
    report = json.loads((revision/'report.json').read_text(encoding='utf-8'))
    report['per_date_regressions_against_frozen_coefficients'] = [name for name, metrics in report['datasets'].items()
                                                               if metrics['four_date_fit']['rmse'] > metrics['frozen_roof_condition']['rmse']]
    contexts = json.loads((native/'contexts.json').read_text(encoding='utf-8'))
    fields = [value[key] for value in contexts.values() for key in value
              if key == 'clear_transport' or key.endswith('_cloudy_transport')]
    assert len(contexts) == 11 and len(fields) == 44 and all(value['converged'] for value in fields)
    report['numerical_convergence'] = {'native_minute_contexts': 11, 'conditional_fields': 44,
                                     'all_last_order_criteria_met': True,
                                     'maximum_scattering_orders': max(value['scattering_orders'] for value in fields),
                                     'interpretation': 'Last-order convergence on a fixed grid; not a rigorous total-error bound or proof of model accuracy.'}
    frame = pd.read_csv(revision/'comparison.csv', float_precision='round_trip')
    frame.to_csv(revision/'input_and_predictions.csv', index=False)
    residuals = {}
    for name, group in frame.groupby('dataset', sort=False):
        errors = group['four_date_fit']-group['actual_mag']
        worst = group.loc[errors.abs().idxmax()]
        residuals[name] = {'maximum_absolute_residual': float(errors.abs().max()),
                           'worst_point': {key: (int(worst[key]) if key in ('observation_id', 'altitude', 'az') else str(worst[key]))
                                           for key in ('uid', 'observation_id', 'time', 'altitude', 'az')},
                           'worst_observed_sqm': float(worst['actual_mag']),
                           'worst_predicted_sqm': float(worst['four_date_fit'])}
        for altitude in (30, 60, 90):
            subset = group[group['altitude'] == altitude]
            residuals[name]['altitude_'+str(altitude)] = error_metrics(subset['four_date_fit']-subset['actual_mag'])
    write_json(revision/'residual_diagnostics.json', {'datasets': residuals,
               'oct28_interpretation': 'Moon direction around ENE differs from the bright southern measurements. Local lighting, cloud anisotropy, unresolved surroundings and beam-wing occultation remain hypotheses; no cause or azimuth correction is inferred from SQM alone.',
               'points_removed_for_large_residual': 0})
    core = repo/'backend/src/app/services/sky_brightness_model/core'
    snapshot.mkdir(); sources = {}
    research_sources = ['roof_model.py', 'joint_model.py', 'prepare_rooftop_basis.py', 'prepare_rooftop_inputs.py',
                        'four_dates_rooftop.py', 'verify_roof_inference.py', 'archive_rooftop.py',
                        'prepare_joint_basis.py', 'calibrate_three_hour.py', 'evaluate_frozen.py']
    for folder, names in [(RESEARCH, research_sources), (core, ['calculator.py', 'config.py', 'data_loader.py', 'modern_sky.py', 'radiative_transfer.py'])]:
        for name in names:
            shutil.copyfile(folder/name, snapshot/name); sources[name] = sha256(folder/name)
    shutil.copyfile(revision/'candidate_params.json', snapshot/'candidate_params.json')
    versions = {'python': platform.python_version()}
    for name in ('numpy', 'pandas', 'scipy', 'rasterio', 'numba', 'astronomy-engine', 'matplotlib'):
        versions[name] = importlib.metadata.version(name)
    validation = {'backend_unittest_count': 106, 'backend_unittest_passed': True,
                  'command': 'python -m unittest discover -s backend/tests -q',
                  'test_log_sha256': sha256(test_log), 'inference_verification': inference,
                  'production_source_changes': [], 'source_parent_commit': parent}
    write_json(revision/'validation.json', validation)
    report.update({'created_at_utc': datetime.now(timezone.utc).isoformat(), 'source_parent_commit': parent,
                   'source_snapshot': 'models/'+MODEL_VERSION, 'source_sha256': sources, 'versions': versions,
                   'verification': validation, 'all_four_dates_used_for_joint_calibration': True})
    write_json(revision/'report.json', report)
    write_json(snapshot/'manifest.json', {'model_version': MODEL_VERSION, 'source_parent_commit': parent,
                                         'source_sha256': sources, 'versions': versions,
                                         'parameters': report['shared_parameters'], 'application_adopted': False,
                                         'note': 'Source snapshot; full repository and earlier frozen weather adapter are required for reproduction.'})
    plt.rcParams.update({'font.family': 'Malgun Gothic', 'axes.unicode_minus': False})
    frozen_run.mkdir()
    frozen = frame[frame['dataset'] == DATASET]
    frozen.to_csv(frozen_run/'comparison.csv', index=False)
    shutil.copyfile(revision/'frozen_oct28_report.json', frozen_run/'report.json')
    for label in ('frozen_unobstructed', 'frozen_roof_condition'):
        save_directional_report([{**row, 'pred_mag': row[label], 'diff': row[label]-row['actual_mag']} for row in frozen.to_dict('records')], str(frozen_run/label))
    comparison_plot(frozen.to_dict('records'), {name: frozen[column].to_numpy() for name, column in
                    [('3일 고정·가림 없음', 'frozen_unobstructed'), ('3일 고정·달 가림', 'frozen_roof_condition')]},
                    frozen_run/'observed_vs_model.png', title='10월 28일 · 새 데이터를 보정하기 전 고정 계수 비교')
    (frozen_run/'README.md').write_text('''# 10월 28일 · 직전 3일 계수 고정 평가

새 48개의 SQM 값을 계수 보정에 사용하기 전에 기존 공통 계수로 계산했다. 사진·분 단위 시각과 사용자가 확인한 달 가림 조건을 입력했다. 달 원반 직접광만 0으로 두고 대기의 산란 달빛은 유지했다. 가림 없는 경우는 반사실적 대조군이다.

API는 측정 뒤 2026-10-28 21:57 KST에 받은 기상 모델 자료이므로 실시간 예보 성능 검증이 아니다. [수치](report.json) · [예측](comparison.csv) · [그래프](observed_vs_model.png).
''', encoding='utf-8', newline='\n')
    for name, run in RUNS.items():
        destination = RESEARCH/'datasets'/name/run; destination.mkdir()
        source = revision/name
        for filename in ('comparison.csv', 'report.json', 'observed_vs_model.png'):
            shutil.copyfile(source/filename, destination/filename)
        shutil.copyfile(source/'four_date_fit/rmse_by_direction.png', destination/'directional_rmse.png')
        shutil.copyfile(source/'date_holdout/rmse_by_direction.png', destination/'date_holdout_directional_rmse.png')
        input_name = 'v001_valid_48.csv' if name == DATASET else next(row[1] for row in DATASETS if row[0] == name)
        shutil.copyfile(RESEARCH/'datasets'/name/'inputs'/input_name, destination/'input.csv')
        write_json(destination/'run_manifest.json', {'model_version': MODEL_VERSION,
                   'model_snapshot': 'models/'+MODEL_VERSION, 'joint_report': 'revisions/'+REVISION+'/report.json',
                   'input': 'datasets/'+name+'/inputs/'+input_name, 'input_sha256': sha256(destination/'input.csv'),
                   'previous_date_conditions_unchanged': name != DATASET, 'app_adopted': False})
        (destination/'README.md').write_text(f'# {name[:10]} · 4일 공통 연구 후보\n\n[공통 조건·검증·모델](../../../revisions/{REVISION}/README.md) · [수치](report.json) · [방위각·고도별 RMSE](directional_rmse.png) · [관측일 제외 진단](date_holdout_directional_rmse.png). 앱에는 미적용이다.\n', encoding='utf-8', newline='\n')
    write_readme(revision, report)
    update_index(report)
    update_documents(repo, report)
    print(json.dumps({'revision': str(revision.relative_to(repo)), 'model_version': MODEL_VERSION,
                      'n': 179, 'backend_tests': 106}, ensure_ascii=False))


def metric_table(report):
    lines = []
    for name, metrics in [*report['datasets'].items(), ('전체', report['aggregate'])]:
        m = metrics['four_date_fit']
        lines.append(f"| {name[:10]} | {m['n']} | {metrics['frozen_roof_condition']['rmse']:.5f} | {m['mse']:.5f} | {m['rmse']:.5f} | {metrics['angular_holdout']['rmse']:.5f} | {metrics['date_holdout']['rmse']:.5f} |")
    return '\n'.join(lines)


def write_readme(revision, report):
    frozen = report['frozen_oct28']['metrics']
    text = f'''# 2026-10-28 · 옥상 관측 추가와 4일 공통 연구 모델

**22일 49개 + 26일 49개 + 27일 33개 + 28일 48개 = 유효 179개.** 원본은 총 196칸이며 기존 27일 결측 16칸과 새 28일 결측 1칸만 제외했다. 다른 이상치 제거·SQM 보간은 없다. 앱 0.9.3·legacy는 유지하며 연구 모델만 갱신했다.

## 장소와 시간

| 날짜(KST) | 장소·좌표 | 시간 입력 |
| --- | --- | --- |
| 10월 22일 | 33.426769, 126.530349 | 30° 21:25, 60°·천정 22:15, 기존 구간 대표값 |
| 10월 26일 | 탐라교육원 운동장 중앙 근사 33.42785, 126.53208 | 18:32, 기존 18:29–18:35 대표값·황혼 |
| 10월 27일 | 과학고 북쪽 지상 핀 33.426633, 126.530639 | 21:10, 기존 21:08–21:13 대표값 |
| 10월 28일 | 과학고 서쪽 건물 옥상 사진 핀 근사 **33.42642, 126.53016** | **21:13~21:23의 11개 분을 각각 계산** |

28일의 빈 시간칸은 바로 위의 명시된 분을 이어받는다는 사용자 확인을 반영했다. 각 분의 00초는 대표시각이며 실제 측정 초를 알고 있는 것은 아니다. 시간 사이 전달장 보간 없이 11개 시각 각각 맑음·흐림(광학 두께 1/10/30)의 총 44개 전달장을 풀었다. 모든 상태의 수렴 진단을 [contexts.json](basis/rooftop_native/contexts.json)에 저장했다.

[원본 표](../../datasets/{DATASET}/raw/sqm_observations.csv) · [원본 지도 사진](../../datasets/{DATASET}/raw/location_reference_user.png) · [지도 대조 화면](../../datasets/{DATASET}/raw/location_registration_map.png) · [확인된 조건](../../datasets/{DATASET}/raw/confirmed_conditions_v001.json). 초기 원본 메타데이터의 좌표 미정 상태는 보존하고, 확정한 근사 좌표를 별도 조건 파일에 추가했다. GPS 측량값이 아니며 위치 오차 최소 10 m를 가정한다.

4층 높이라는 정보는 기록했다. 정확한 미터값·기준면이 없고 Copernicus 자료는 구조물이 섞일 수 있는 DSM이므로 임의의 12 m를 더하지 않았다. 기존 지면 기준 RTE 격자를 유지하며 **센서 높이와 건물의 3차원 형상을 해상하여 푼 것은 아니다.**

## API 입력

28일에는 **새 옥상 근사 좌표로 세 패키지를 새로 조회**해 원본 JSON과 수신 영수증을 저장했다. 수신시각은 **2026-10-28 21:57 KST**다. `airquality-3h`, `clouds-3h`, `air-3h`의 원자료는 3시간 간격이고, 해당 날짜 21:00–다음날 00:00 자료를 각 측정 분에 보간했다. 각 보간 끝점과 비율을 저장했다. [API JSON](../../datasets/{DATASET}/raw/{WEATHER}) · [수신 기록](../../datasets/{DATASET}/raw/{Path(WEATHER).with_suffix('.receipt.json')}). 키는 저장·게시하지 않는다.

22·26·27일의 위치·시간·원래 API·131개 전달장은 그대로 재사용했다. 이전 세 날짜 예측과의 차이는 **{report['frozen_oct28']['previous_131_prediction_max_absolute_change']:.3g} mag**다. 측정 이후 받은 기상 모델 출력이므로 실측 기상이나 실시간 예보 성능으로 해석하지 않는다. 구름 밑면의 유효 기압이 없을 때 2 km를 가정한 상태도 명시했다.

## 먼저 수행한 28일 고정 계수 평가

직전 `joint-sos3d-twilight-2026.10.28`의 계수를 고정하고 새 48개를 계산한 뒤에만 공동 보정을 시작했다.

| 28일 조건 | MSE | RMSE |
| --- | ---: | ---: |
| 달이 가려지지 않은 반사실적 대조 | {frozen['frozen_unobstructed']['mse']:.6f} | {frozen['frozen_unobstructed']['rmse']:.6f} |
| 사용자 확인대로 달 원반 직접광만 차단 | {frozen['frozen_roof_condition']['mse']:.6f} | {frozen['frozen_roof_condition']['rmse']:.6f} |

[고정 평가 보고서](frozen_oct28_report.json) · [고정 평가 전용 실행](../../datasets/{DATASET}/001_frozen_three_day/README.md). 이는 새 데이터로 계수를 맞추기 전의 검사다. 지붕 조건을 입력하는 측정 모형은 이번에 추가했고 API는 관측 뒤 받은 값이므로, 완전히 사전 등록된 실시간 미래 예측 실험으로 부르지 않는다.

## 달 가림을 반영한 방법

사용자가 21:13–21:23 내내 달 원반이 지붕에 가렸다고 확인했다. 그래서 로컬 달 원반 가시율을 28일에만 **0으로 고정**했다. 다른 날은 기존 조건 1을 유지했다. 이 값은 SQM에 맞춰 최적화한 달 감쇠 계수가 아니다.

센서에서 보는 조건부 복사휘도에 `L = L_art + L_bg + L_moon_diffuse + visibility*L_moon_direct`를 적용한 뒤 SQM으로 변환한다. **대기에서 산란한 달빛과 그 다중산란은 남는다.** 지붕 때문에 달 광원이 대기 전체에서 사라졌다고 처리하지 않는다. [Jones et al.(2013)](https://doi.org/10.1051/0004-6361/201322433)은 대기 산란 달빛 모형의 참고 문헌이며, 이 옥상의 국소 원반 가림은 기하학적 추론이다. SQM-L FWHM 20°는 [제조사 자료](https://www.unihedron.com/projects/sqm-l/Instruction_sheet.pdf)를 따른 Gaussian 근사이며 실제 날개 응답·지붕 각도별 차폐·주변 반사광을 측정한 것은 아니다.

## 네 날짜 공동 보정 결과

| 날짜 | n | 직전 고정 계수 RMSE¹ | 새 공동 MSE | 새 공동 RMSE | 방향 제외 RMSE | 관측일 제외 RMSE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
{metric_table(report)}

¹ 28일에는 실제 원반 가림 조건을 적용했다. 22·26·27일의 직전 고정 결과는 그대로다. MSE 단위는 (mag/arcsec²)², RMSE는 mag/arcsec²다. 전체 행은 179점 통합 오차이며 최적화 목적함수는 관측일별 동일 가중치다.

![날짜별 오차](rmse_summary.png)
![방위각·고도별 오차](directional_rmse_overview.png)

공통 계수는 `{json.dumps(report['shared_parameters'], ensure_ascii=False)}`다. 위성광 유효 광원 세기와 황혼 gain·방향 모양만 공유해 보정하고, 구름 광학 두께는 훈련 자료에서만 1/10/30 중 선택한다. 날짜·장소별 자유 오프셋이나 새 다중산란 상수 배수는 없다. 기존 공간·방향·차수별 다중산란, KS91 달 위상, 유한 원반, 실제 각도 첫 산란, 황혼 prior는 그대로다.

전체 179점의 RMSE는 고정 계수 **0.88361 → 0.86860**으로 감소했다. 26일은 **0.48326 → 0.51512**, 27일은 **1.23432 → 1.24688**로 증가했다. 28일 남남서 방향의 큰 잔차도 남아 있다. [고도별 오차·최대 잔차](residual_diagnostics.json)에 수치와 방향을 저장했다. 달은 측정 시작에 동북동쪽 방위각 약 73.25°·고도 23.13°였으므로 남쪽 밝기의 원인을 달 직접광으로 단정하지 않는다. 근거리 조명·구름의 공간 분포·지붕에 가린 빔 날개 등은 추가 관측이 필요한 가설이다.

관측일 제외 검사는 매번 한 날짜 전체를 빼고 나머지 날짜로 계수·광학 두께를 다시 선택한 뒤 빠진 날짜를 예측한다. 방향 제외 검사는 60° 방위각 구역을 네 날짜에서 함께 제외하고 천정을 별도 분할로 둔다. 모든 점이 한 번씩 평가됐고 훈련·검사 식별자를 저장했다. 28일 제외 결과는 직전 세 날짜 고정 계수 예측과 일치한다. 26일을 빼면 황혼을 학습할 날이 없어 gain=1·concentration=1의 선언된 prior를 사용한다.

공동 보정 오차는 학습 오차이고 분할 결과는 사후 진단이다. 네 날짜만으로 계수의 일반화나 날씨별 인과 효과가 입증된 것은 아니다. 운량 확률의 맑음/흐림 혼합, 가정한 광학 두께, 미확인 국소 광원과 지붕 시야는 남은 제약이다. 높은 잔차도 숨기지 않고 모든 방향을 보존했다.

## 검증과 재현

기존 검사와 새 달 가림·결측·시간·검사값 누수 검사를 합쳐 **106개 통과**했다. SQM 정답을 받지 않는 `RoofSkyModel.predict`를 native 전달장으로 다시 실행해 저장 예측과 일치하고, 가시율 1은 이전 `JointSkyModel`과 일치함을 확인했다. [검증 기록](validation.json) · [추론 검사](inference_verification.json) · [전체 수치·제약](report.json) · [179개 입력과 예측](input_and_predictions.csv).

새 인공광 계수를 실제 광원 입력에 적용하고 직접 달 원반 플래그를 끈 전달장을 다시 풀어 선형 결합 예측과 일치하는 것도 확인했다. 산란 차수의 마지막 항 수렴은 현재 격자에서의 수치 기준이며 전체 오차 상한이나 실제 하늘 정확도의 보증은 아니다.

모델·연구 코드·기존 물리 코드를 [소스 스냅샷](../../models/{MODEL_VERSION}/manifest.json)에 해시와 함께 보관했다. 전체 저장소와 이전 기상 어댑터, 별도 위성 H5·DEM이 재현에 필요하다. 앱 소스·기본값·빌드·릴리스·배포는 변경하지 않았다.
'''
    (revision/'README.md').write_text(text, encoding='utf-8', newline='\n')


def update_index(report):
    path = RESEARCH/'index.json'; index = json.loads(path.read_text(encoding='utf-8'))
    index['research_model_history'].append(index['research_candidate_model'])
    index['latest_dataset'] = DATASET; index['latest_run'] = RUNS[DATASET]
    index['latest_model_revision'] = 'revisions/'+REVISION
    for item in index['datasets']:
        if item['id'] in RUNS:
            item['runs'].append(RUNS[item['id']]); item['status'] = 'joint_four_date_candidate_calibrated_not_applied'
    index['datasets'].append({'id': DATASET, 'raw_observations': 49, 'included_observations': 48, 'missing_observations': 1,
                             'runs': ['001_frozen_three_day', RUNS[DATASET]], 'active_for_fitting': True,
                             'instrument': 'SQM-L', 'site': '제주과학고 서쪽 건물 북쪽 부분 4층 높이 옥상',
                             'coordinates': {'latitude': 33.42642, 'longitude': 126.53016, 'surveyed': False,
                                             'method': 'manual screenshot registration', 'uncertainty_m_assumed': 10},
                             'observation_interval_kst': ['2026-10-28T21:13+09:00', '2026-10-28T21:23+09:00'],
                             'per_minute_times_preserved': True, 'local_moon_disk_visibility': 0.,
                             'api_ready': True, 'api_received_after_observation': True,
                             'status': 'joint_four_date_candidate_calibrated_not_applied'})
    index['active_training_datasets'].append(DATASET)
    index['research_candidate_model'] = {'version': MODEL_VERSION, 'physics_model': 'sos3d_with_twilight_expected_sqm_and_local_lunar_disk_visibility',
                                        'revision': 'revisions/'+REVISION, 'adopted_by_app': False, 'coefficient_fit_performed': True,
                                        'fitted_datasets': list(report['datasets']), 'n': 179,
                                        'parameters': 'models/'+MODEL_VERSION+'/candidate_params.json',
                                        'validation': 'Frozen previous coefficients on Oct28, then retrospective four-date/angular-held-out diagnostics. Twilight held-out uses declared priors.'}
    write_json(path, index)


def update_documents(repo, report):
    frozen = report['frozen_oct28']['metrics']; metrics = report['aggregate']
    block = f'''## 2026-10-28 · 옥상 48개 추가 · 네 날짜 공통 연구 후보

22·26·27·28일의 유효 **179개**를 각자의 장소·시간·기상으로 계산했다. 28일은 사진의 옥상 근사 좌표(33.42642, 126.53016), 11개 분 시각, 계속 가려진 달 원반 조건을 반영했다. 대기의 산란 달빛은 유지했다. 새 API를 28일 21:57 KST에 받아 원본·수신 기록과 함께 저장했다.

28일의 직전 세 날짜 고정 계수 RMSE는 가림 없는 대조 **{frozen['frozen_unobstructed']['rmse']:.5f}**, 실제 달 원반 가림 조건 **{frozen['frozen_roof_condition']['rmse']:.5f}**다. 이후 네 날짜를 함께 보정했다.

| 날짜 | n | 직전 고정 계수 RMSE | 새 MSE | 새 RMSE | 방향 제외 | 관측일 제외 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
{metric_table(report)}

[조건·모델·그래프·한계](revisions/{REVISION}/README.md) · [수치](revisions/{REVISION}/report.json) · [179개 입력과 예측](revisions/{REVISION}/input_and_predictions.csv). 공동 보정은 학습 오차, 분할 검사는 사후 진단이며 실시간 예보 성능 검증은 아니다. 106개 검사와 라벨 없는 native 추론 확인을 통과했다. 앱은 0.9.3·legacy를 유지한다.

'''
    for filename in ('RESULTS.md', 'CHANGELOG.md'):
        path = RESEARCH/filename; lines = path.read_text(encoding='utf-8').splitlines(keepends=True)
        lines.insert(1, '\n'+block); path.write_text(''.join(lines), encoding='utf-8', newline='\n')
    path = RESEARCH/'README.md'; text = path.read_text(encoding='utf-8')
    text = text.replace('현재 연구 후보는 **joint-sos3d-twilight-2026.10.28**이다.', '직전 세 날짜 연구 후보는 **joint-sos3d-twilight-2026.10.28**이었다.')
    lines = text.splitlines(keepends=True)
    lines.insert(1, f'\n현재 연구 후보는 **{MODEL_VERSION}**이다. 22·26·27·28일 179개를 모두 공통 보정했다. [최신 결과·원본·조건·그래프](revisions/{REVISION}/README.md)를 먼저 확인한다. 28일 고정 계수 평가와 공동 보정을 따로 저장했으며 앱은 미적용이다.\n')
    path.write_text(''.join(lines), encoding='utf-8', newline='\n')
    path = repo/'AGENTS.md'; text = path.read_text(encoding='utf-8').replace('## 최신 공통 연구 후보\n', '## 직전 세 날짜 공통 연구 후보 (이력)\n')
    text += f'''\n## 최신 네 날짜 공통 연구 후보

- 2026-10-28 옥상 관측 48개를 추가해 22·26·27·28일 유효 179개를 공통 보정했다. 현재 후보는 `{MODEL_VERSION}`이고 `research/revisions/{REVISION}/`와 `research/models/{MODEL_VERSION}/`를 확인한다. 기존 세 날짜의 조건·131개 전달장·이전 실행은 보존했다.
- 28일은 사진을 수동 대조한 옥상 근사 좌표 33.42642,126.53016(오차 최소 10m 가정), 4층 높이·정확한 미터 미상, 21:13~21:23의 11개 분을 각각 사용한다. 빈 시간은 이전 명시 분을 이어받고 초는 미상이다. 결측은 고도30/방위각300 한 점뿐이다.
- 사용자가 달 원반이 계속 지붕에 가렸다고 확인했다. `research/roof_model.py`의 `RoofSkyModel`은 로컬 원반 가시율 0으로 직접광만 차단하고 대기 산란 달빛을 유지한다. 가시율은 실측 조건이며 SQM으로 피팅하지 않는다. 다음 데이터의 달 가림을 이 날짜에서 자동 전파하지 않는다.
- 새 데이터는 저장한 공통 계수와 관측 조건으로 먼저 고정 평가한다. 앱의 `evaluator.py --physics-model sos3d`는 이 공동 계수·옥상 조건을 자동 적용하지 않는다. 새 보정은 새 실행으로 보존하고 앱 적용은 별도 명시 요청을 따른다.
- 28일 API는 같은 좌표로 21:57 KST에 받은 3시간 모델 출력이다. 관측 뒤 수신한 자료를 실제 대기 관측이나 실시간 예보 검증으로 부르지 않는다. 106개 검사와 native 라벨 없는 추론 일치를 확인했으며 앱 소스·기본값·빌드·배포는 변경하지 않았다.
'''
    path.write_text(text, encoding='utf-8', newline='\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('fit', 'rooftop-basis', 'inference', 'test-log'):
        parser.add_argument('--'+name, type=Path, required=True)
    args = parser.parse_args(); main(args.fit, args.rooftop_basis, args.inference, args.test_log)
