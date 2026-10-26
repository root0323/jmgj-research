# 2026-10-26 탐라교육원 운동장 · SQM-L 49개

한국시간 **18:29~18:35**, 고도 30°·60°에서 15° 간격 각각 24개와 천정 1개다.
사용자가 지정한 **탐라교육원 운동장 중앙**을 지도 도형으로 근사한 **33.42785°N, 126.53208°E**를 사용했다. 실제 측정기의 GPS 좌표가 아니다.
이전 날짜의 좌표나 건물 제외 규칙은 옮겨 적용하지 않았다. 이번 표의 49개 전부를 보존·평가했다.
장비는 사용자 지정 **SQM-L 고정**, 방위각은 북쪽 0°·동쪽 90°다. 개별 측정 시각과 이번 차폐 여부는 별도로 확인되지 않았다.
표에서 생략된 고도 60°·천정의 시간 칸은 같은 관측 구간을 상속하며, 대표 시각 **18:32**는 각 방향의 정확한 측정 시각이 아니다.

## 결과

| 같은 49개에서의 평가 | MSE | RMSE (mag/arcsec²) |
| --- | ---: | ---: |
| 현재 앱 기본 모델 | 2.97291661 | 1.72421478 |
| 10월 22일 후보 계수 고정 · 새 자료로 다시 맞추지 않음 | 1.52032002 | 1.23301258 |
| 새 국소 황혼 항 · 전체 보정 | 0.21622258 | 0.46499739 |
| 새 국소 황혼 항 · 방향 구간 검증 | 0.30499330 | 0.55226198 |

정확한 값과 계수는 실행 [001](runs/001_frozen_candidate_evaluation/report.json) / [002](runs/002_local_twilight_probe/report.json)에 있다.
전체 보정과 방향 검증은 서로 다르다. 002의 후보 형태는 이 관측을 본 뒤 고른 탐색적 모델이며, 다른 날의 독립 검증을 통과했다는 뜻이 아니다.

## 황혼과 관측 조건

- 대표 시각 태양 고도 **−9.76494°**, 방위각 **261.39069°**. 구간 시작~끝 고도는 **−9.14596°~−10.38456°**다. 모두 항해 황혼이다.
- [미 해군천문대의 황혼 정의](https://aa.usno.navy.mil/faq/RST_defs)는 태양 중심의 기하 고도 −6°·−12°·−18°를 황혼의 어두운 경계로 구분한다. 이 관측은 완전히 어두운 밤 조건에 해당하지 않는다.
- 태양·달 위치는 Astronomy Engine으로 계산했다. 달 고도 **10.71829°**, 방위각 **76.05430°**, 조명 비율 약 **99.77%**다. 밝은 남서쪽 하늘을 달빛만으로 설명할 수 있다고 가정하지 않았다.
- 새 API는 해당 위치에서 수신한 `airquality-3h`, `clouds-3h`, `air-3h` 전체다. 각 89개 시각, **2026-10-22 00:00~11-02 00:00 KST**, 실제 간격은 모두 **3시간**이다. 18:00과 21:00을 선형 보간했다.
- 18:32 입력은 AOD550 **0.09822**, 구름 비율 **0.66711**, 모델이 사용하는 대류 구름 밑면 압력으로 환산한 높이 **13.01197km**다. 이는 현장 실측 대기값이나 확인된 전체 구름 밑면 높이가 아니다.
- API 수신/생성은 관측 이후인 **23:42 KST**다. 이번 비교는 보존한 사후 기상 자료를 이용하며 실시간 예보 성능 검증이 아니다. 차감 헤더 합계 24,000 크레딧과 수신 기록은 원본 옆에 저장했다. 인증 정보는 제외했다.

## 두 실행과 검증 방식

**001_frozen_candidate_evaluation**은 10월 22일의 `g=0.5`, `art_scale=0.05`, `moon_cloud_gain=118.24386924943558`을 고정해 새 날짜·근처의 다른 지점에 적용했다. 이번 실측은 이 계수의 보정에 사용하지 않았다. 기본/후보 모두 태양 황혼 항이 없어 적용 조건이 다르다는 한계가 있다.

**002_local_twilight_probe**는 앱 기본 모델에 다음 양의 휘도 항을 더했다. 10월 22일 달빛·구름 후보를 다시 보정한 모델이 아니다.

```text
L_total = L_app + A / sin(target_altitude) * exp(k * (cos(solar_separation) - 1))
SQM = 12.59 - 2.5 * log10(L_total)
```

`L_app=683*I_app`로 기존 모델의 광도 변환을 유지했다. A는 정규화 휘도 계수(cd/m²), k는 방향 집중도이며 각각 log10(A)와 k 두 개만 보정한다. 탐색 범위는 log10(A) −6~1, k 0~8이고 최적점은 경계에 걸리지 않았다. 완전한 복사 전달식이나 검증된 태양 고도별 황혼 밝기 법칙은 아니다.

방향 검증은 방위각 **60° 구간 6개와 천정 1개**, 총 7개 분할이다. 각 구간을 뺀 자료로 두 계수를 처음부터 맞추고 제외한 구간만 예측했다. 같은 방위각의 고도 30°·60°는 함께 제외하며, 49개 모두 정확히 한 번 검증에 들어간다. 천정은 방위각 0° 그룹에 넣지 않는다. 각도별 RMSE는 해당 그룹의 제곱 오차를 모아 계산하며 천정 n=1에서는 절대 오차와 같다.

- 방향 검증 RMSE: 고도 30° **0.67203**, 60° **0.41081**, 천정 **0.23534**.
- 고도 교차 검사: 30°만 보정→60° 예측 **0.50095**, 60°만 보정→30° 예측 **0.68711**. 고도 간 잔차도 남아 있다.
- 시작/종료 시각에서 계수를 고정한 보정 RMSE는 **0.46166 / 0.46848**다. 이 계산은 A를 일정하게 두므로 실제 황혼이 6분 동안 어두워지는 정도나 순회 순서의 영향을 추정하지 못한다.

밝은 인공광·직접광도 방향성을 만들 수 있어 오차 감소만으로 황혼이 원인이라고 확정할 수 없다. SQM-L 각도 응답, 실제 차폐, 방향별 측정 시각, 빠른 구름 변화도 분리하지 못했다. 다른 태양 고도·날짜·위치로 A를 옮기는 법칙이 없어 **연구 후보로 보존하며 앱 기본값에는 적용하지 않았다.**
10월 22일 자료는 기존 야간 후보 연구용으로 유지하고 이번 자료는 황혼 진단용으로 구분한다. 10월 15일 자료는 계속 보관 전용이다.

## 파일과 출처

- [원본 SQM 표](raw/sqm_observations.csv), [관측 메타데이터](raw/metadata.json), [운동장 도형·좌표 근거](raw/location_reference.json), [포함 기준](selections/v001_all_49.json), [모델 입력 49개](inputs/v001_all_49.csv).
- 001의 기본/고정 후보 및 002의 보정/방향 검증 폴더에 `metrics.json`, `evaluation.csv`, 방위각·고도별 CSV와 `rmse_by_direction.png`를 저장했다. 실행별 `comparison.csv`, `observed_vs_model.png`, `report.json`, `run.json`도 보존했다.
- Black Marble/DEM은 기존과 같은 자료·해시를 사용했다. 최대 광원 1,000개, 반경 30km, 방사량 비율 0.99, 최소 50개다. 대용량 원자료와 인증 정보는 올리지 않았다.
- 운동장 좌표: [OpenStreetMap way 1204798054](https://www.openstreetmap.org/way/1204798054), © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright). 네 꼭짓점 중심을 소수 다섯 자리로 반올림한 근사 위치다. [탐라교육원 공식 안내](https://www.tamna.or.kr/hp/hm/htmlConvert.do?menuId=1000001032)로 주소를 대조했다.
- 천체 좌표: [Astronomy Engine](https://github.com/cosinekitty/astronomy), MIT License. 황혼 구분: [US Naval Observatory](https://aa.usno.navy.mil/faq/RST_defs). 추가한 연구 출처도 앱의 출처 목록에 기록했다.

## 재현

저장소 루트에서 `PYTHONPATH=backend/src`를 설정하고, 연구 환경의 NumPy·SciPy·Pandas·Matplotlib·Rasterio·h5py·Numba·Astronomy Engine을 사용한다. H5/DEM은 `run.json` 해시와 같은 파일을 지정한다. 이미 존재하는 실행 폴더는 덮어쓰지 않는다.

```text
python backend/tools/sky_brightness/research/evaluate_frozen.py --observations <이 데이터 세트>/inputs/v001_all_49.csv --cache <이 데이터 세트>/raw/weather_cache_33.42785_126.53208_2026-10-26.json --params backend/tools/sky_brightness/research/datasets/2026-10-22_2123-2218_KST_jeju/runs/002_scattering_calibration/candidate_params.json --h5 <H5> --dem <DEM> --output <새 평가 폴더>
python backend/tools/sky_brightness/research/probe_twilight.py --evaluation <평가 폴더> --output <새 황혼 연구 폴더>
```

두 실행은 네트워크나 API 키 없이 저장된 입력으로 계산한다. 현재 결과와 과거 결과는 [전체 목록](../../RESULTS.md)과 [색인](../../index.json)에서 찾는다.
