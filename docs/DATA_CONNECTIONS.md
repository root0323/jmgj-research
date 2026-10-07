# 외부 자료 연결

## 로컬 준비

저장소 루트에서 Python 환경에 `backend/src/app/requirements.txt`를 설치한 뒤 실행한다.

```powershell
$env:PYTHONPATH = Join-Path (Get-Location) 'backend/src'
.venv/Scripts/python.exe -m app.scripts.local_setup
```

설정 화면: <http://127.0.0.1:3004/>. 배포 API와 별도 프로세스이며 127.0.0.1에만 바인딩한다. Host·Origin·CSRF 검사로 외부 웹페이지에서 키를 변경하거나 다운로드를 시작하지 못하게 한다. 이 화면을 공용 서버에 노출하지 않는다.

- 카카오: 본인 앱의 REST API 키를 발급하고 카카오맵 사용을 설정한다. 키의 허용 API·IP 제한도 확인한다. 저장 후 주소·장소 검색, 자동완성, 역지오코딩에서 우선 사용한다.
- VWorld: 본인 인증키와 발급 시 등록한 사용 URL을 입력한다. 카카오 결과가 없는 경우 검색·자동완성·역지오코딩에 사용한다. 키는 HTTPS 요청에만 전달한다.
- 키 저장: `backend/src/app/.env`에 저장하며 설정 파일 변경은 실행 중인 백엔드에 반영된다. 배포 환경변수가 있으면 환경변수가 우선한다. 키 저장 여부와 실제 API 인증 성공 여부는 구별한다.
- NASA: [Earthdata Login](https://urs.earthdata.nasa.gov/)에 로그인한 뒤 Generate Token 메뉴에서 다운로드 토큰을 발급한다. [공식 발급 안내](https://urs.earthdata.nasa.gov/documentation/for_users/user_token). 필요한 계정 승인·약관 동의는 계정 소유자가 직접 진행한다. 토큰은 다운로드 작업 메모리에서만 사용하며 설정·자료 메타데이터에 저장하지 않는다.

## 자료 준비와 재사용

설정 화면에서 장소의 위도·경도와 선택적 기준 월을 지정하고 `두 자료 준비`를 누른다. Meteoblue 유료 호출은 이 과정에서 발생하지 않는다. 자료는 Git에서 제외한 `.local-data/` 아래에 저장한다. `RESEARCH_ASSET_DIR` 환경변수로 경로를 바꿀 수 있다.

- Copernicus GLO-90: 관측 장소 주변 30km와 여유 구간의 지형 타일을 익명 다운로드해 EPSG:4326 GeoTIFF로 합친다. 약 90m 간격의 **DSM**이므로 건물·식생을 포함한다. 원본 연구 DEM과 같은 자료가 아니며 지형 차폐 결과는 다시 검증해야 한다. 공식 타일 목록에 없는 바다만 0m로 채우며, 다운로드 실패나 결측값을 바다로 처리하지 않는다.
- Black Marble VNP46A3 V2: NASA CMR에서 영역에 맞는 공식 10° 타일을 찾아 Earthdata 다운로드 토큰으로 받는다. 같은 영역에 여러 타일이 필요하면 기준 월을 맞춘다. 월을 비우면 첫 타일의 최신 공개 월을 사용한다. 월별 위성 합성 자료이며 선택 시각의 실시간 광공해 측정값이 아니다.
- 이미 있는 타일은 재사용한다. 완성된 자료 목록은 원자적으로 교체한다. 저장 영역이 계산 반경을 덮는 경우만 사용하며, 다른 장소는 그 위치에서 자료를 준비해야 한다. 날짜 변경선·위도 ±85° 이상은 현재 지원하지 않는다.
- 과거 관측일 분석에는 그 시기에 맞는 기준 월을 직접 선택한다. 월별 자료의 자동 갱신은 수행하지 않는다. 새 자료가 필요하면 준비 버튼을 다시 누른다.
- 기존 H5·DEM도 `.env`의 `BLACK_MARBLE_H5_PATH`, `DEM_RASTER_PATH`로 연결 가능하다. DEM은 WGS84 EPSG:4326, 단위 m, 필요한 범위 전체를 포함해야 한다. 잘못된 좌표계·결측 지형은 연구 모델에서 제외한다.

## 연구 모델 연결

현재 웹의 3시간 기상 자료에서 AOD·구름량·구름 밑면 압력을 읽고, 같은 장소·시각의 달 위치·위상은 Stellarium 엔진의 복제한 관측자로 계산한다. 화면의 시각과 위치는 바꾸지 않는다. 시상은 밝기 모델 수식에서 사용되지 않으므로 필수 조건에서 제외하며, 시상 값을 새로 추정하지 않는다. 기존 7Timer 시상 예보 표시는 유지한다.

모델에 Black Marble 인공광, 지형에 의한 인공광 차폐와 달빛 차폐, 저장 기상 자료를 전달한다. 방향·시간 변경 때 Meteoblue를 추가 호출하지 않는다. 필수 기상값·달 위치·지형·인공광 자료가 없거나 범위가 맞지 않으면 간이 추정으로 남는다. `POST /api/difficulty/evaluate-cached` 응답의 `source`가 `black-marble-dem`인 경우만 실제 연구 모델 계산 성공이다. `GET /api/health`의 키 설정·캐시 존재 정보 자체는 계산 성공을 뜻하지 않는다.

원본 연구 자료가 없으므로 새로운 공개 자료를 사용한 결과의 과학적 타당성은 기존 관측 CSV 등과 별도로 검증해야 한다. 모델 계수의 재보정은 이번 연결 작업의 범위에 포함하지 않는다.

## 연별 Black Marble의 원본 해상도 유지·용량 축소

앱의 정적인 야간광 기준 자료는 NOAA-20 **VJ146A4 Version 2 연별 합성 자료**를 사용한다. 3004 설정 화면의 기존 장소별 다운로드는 VNP46A3 월별 경로다. 연별 전체 자료는 별도 3005 화면에서 준비하며, 개별 H5 파일도 아래 도구로 변환할 수 있다.

저장소 루트에서 실행:

```powershell
$env:PYTHONPATH = Join-Path (Get-Location) 'backend/src'
.venv/Scripts/python.exe -m app.scripts.compact_black_marble `
  'C:\data\VJ146A4.A2025001.h30v05.002.2026072180152.h5' `
  '.local-data\black-marble\compact\VJ146A4.A2025001.h30v05.002.2026072180152.h5' `
  --report '.local-data\black-marble\compact\h30v05-2025.report.json'
```

- `AllAngle_Composite_Snow_Free`, `AllAngle_Composite_Snow_Free_Quality`, `lat`, `lon`만 남긴다. 모든 픽셀의 원본 값·자료형·해상도와 데이터셋 속성(단위, scale/offset, 결측값 등), 원본 전역 속성을 보존한다. 재표본화·반올림·품질 마스크 변경을 하지 않는다.
- gzip+shuffle로 압축하며, 저장 완료 전에 남긴 데이터 **전체를 비트 단위로 비교**한다. 원본 파일은 읽기 전용으로 열고 기존 출력 파일은 덮어쓰지 않는다. 보고서에 원본·결과 파일 SHA-256, 각 데이터셋 해시와 바이트 수를 기록한다.
- 결과는 기존 앱 읽기 함수가 사용하는 경로를 유지한 **앱용 HDF5 부분 자료**다. 원본 NASA HDF-EOS 제품 전체를 대체하지 않는다. 다른 관측각·눈 덮임·관측 횟수·표준편차를 이용하는 후속 연구를 위해 원본을 별도로 보관한다.
- 변환 결과의 절대 경로를 로컬 `.env`의 `BLACK_MARBLE_H5_PATH`로 연결할 수 있다. 실제 하늘 밝기 계산에는 해당 관측 장소를 덮는 DEM과 기상·달 정보도 필요하다. 한 타일만 연결한 상태는 전 세계 지원 완료를 뜻하지 않는다.
- 최종 사용자 배포 목표는 필요한 지역 패키지만 다운로드해 앱 저장공간에서 재사용하는 방식이다. 아래 전 세계 준비 도구는 연구·개발자용 원자료 확보 기능이다. 공개 패키지 호스팅·최종 사용자용 지역 다운로드·연도 갱신·Windows 앱 패키징은 추후 구현한다.

2026-10-07 실파일 검증: 2025년 h30v05 타일(서울·제주 포함)의 원본 **102,997,018 bytes → 3,551,132 bytes**. 2400×2400 밝기·품질 배열과 2400개씩의 위도·경도 값이 일치했다. 이 한 타일의 압축률을 전 세계 자료의 확정 용량으로 사용하지 않는다. 앞서 계산한 약 15.6GB는 전 세계 540개 타일의 밝기+품질 배열을 모두 무압축으로 보관했을 때의 값이며, 실제 압축 후 다운로드 용량과 다르다.

앱 읽기 함수로 서울 21,419개·제주 11,483개의 유효 픽셀 레코드를 비교해 동일함을 확인했다. 서울의 기존 로컬 DEM과 **합성 시험 기상값**을 넣은 `POST /api/difficulty/evaluate-cached` 통합 검증에서도 두 파일의 전체 응답이 같았고 `source=black-marble-dem`이었다. 이는 압축 전후의 동작 동일성 확인이며 실제 기상 조회나 모델의 과학적 정확도 검증이 아니다. 로컬 앱에는 압축 파일과 서울 DEM을 연결했다. 제주를 포함한 다른 장소의 모델 계산에는 해당 지역 DEM도 필요하다.

## 2025년 전 세계 원자료 다운로드

```powershell
$env:PYTHONPATH = Join-Path (Get-Location) 'backend/src'
.venv/Scripts/python.exe -m app.scripts.download_black_marble
# 기존에 받은 원본 폴더가 있으면 --seed 'C:\data\black-marble' 추가
```

다운로드 화면: <http://127.0.0.1:3005/>. [Earthdata Login](https://urs.earthdata.nasa.gov/)에 로그인하고 상단 Generate Token → 페이지 아래 Generate Token → Show Token 순서로 발급한 토큰을 이 화면에 직접 입력한다. 기존 LAADS 자체 발급 토큰은 2024-05-01부터 지원이 종료됐다. Earthdata 토큰의 유효기간은 60일이다. [NASA 토큰 안내](https://urs.earthdata.nasa.gov/documentation/for_users/user_token), [지원 종료 공지](https://ladsweb.modaps.eosdis.nasa.gov/alerts-and-issues/194032). 127.0.0.1에만 바인딩하며 Host·Origin·CSRF 검사를 적용한다. 토큰은 해당 작업 메모리에서만 사용하고 화면·상태 응답·파일·로그에 기록하지 않는다. 이 프로세스를 공용 서버에 노출하지 않는다.

- NASA CMR에서 정확한 `VJ146A4.A2025001.*.002.*.h5` 패턴을 사용해 2025년 V2 자료만 검색한다. 연초 시간 범위의 중복으로 다른 연도까지 받는 일을 피한다. 전체 540개 고유 타일을 확인한 목록을 `manifest.json`에 고정하고 이어받을 때 같은 목록을 사용한다.
- 2026-10-07 공개 메타데이터 합계: 원본 **51,139,704,099 bytes (약 51.14GB)**. 압축해 보관하더라도 NASA 원본 전체를 받는 네트워크 사용량은 이 크기다. 최종 압축 용량은 실제 전체 처리가 끝나야 확정된다.
- 기본 저장 위치는 Windows `%LOCALAPPDATA%\jmgj-research\black-marble\VJ146A4-2025`로 OneDrive 밖이다. `raw/` 원본, `compact/` 앱용 H5, `reports/` 검증 기록, `index.json` 완료 색인을 보관한다. `BLACK_MARBLE_GLOBAL_DIR` 로컬 설정으로 경로를 지정할 수도 있다. 데이터와 계정 토큰은 Git에 포함하지 않는다.
- 한 타일씩 다운로드 → 예상 파일 크기·H5 제품/연도/타일 확인 → 무손실 압축 → 남긴 모든 값 비교 → 색인 등록 순서로 처리한다. 원본은 자동 삭제하지 않는다. 시작·파일 처리 전에 저장 공간을 확인한다.
- NASA 파일 서버가 반환한 HTTPS 서명 주소로 이어서 받는다. 2026-10-07 인증 연결에서 확인한 CloudFront 서버 `d13j1jds5ybppo.cloudfront.net`도 지원한다. Earthdata 토큰은 정확히 지정된 NASA 인증 호스트에만 보내며 CDN·S3에는 보내지 않는다. 허용되지 않은 주소는 서버 이름만 표시하고 서명 주소의 경로·쿼리는 노출하지 않는다.
- `현재 파일 처리 후 중단`은 진행 중인 파일의 다운로드·검증이 끝난 뒤 멈춘다. 다시 시작하면 완료 파일의 SHA-256을 확인해 재사용한다. 프로세스가 종료되면 토큰을 다시 입력해야 하며, 받다 만 파일 한 개는 처음부터 다시 받는다. 인증·네트워크·검증 오류에서는 중단하고 완료 파일을 유지한다.
- 이미 내려받은 파일은 `--seed` 폴더에서 정확히 같은 NASA 파일명인 것만 복사·검증해 재사용한다. 사용자가 보관한 원본은 수정하지 않는다.
- 백엔드는 관측 반경에 필요한 타일이 모두 검증된 경우에만 연별 색인의 압축 파일을 사용한다. 기존 장소별 DEM 캐시와 함께 사용하며 API의 `blackMarbleYear`에 2025를 전달한다. Black Marble을 모두 받더라도 다른 지역의 DEM까지 준비되는 것은 아니다. 날짜 변경선·극지방 지원 제한도 그대로다.

다운로드·이어받기·중단·오류·인증정보 비노출은 작은 합성 H5로 검증했다. 기존 서울·제주 실파일은 전체 자료 저장소에 가져왔다. NASA 토큰 입력 전에는 나머지 539개 파일의 인증 다운로드가 시작되지 않으며 완료로 표시하지 않는다.

## 전 세계 DEM 원본 다운로드

```powershell
$env:PYTHONPATH = Join-Path (Get-Location) 'backend/src'
.venv/Scripts/python.exe -m app.scripts.download_world_dem --start
```

진행 화면: <http://127.0.0.1:3006/>. 로그인·토큰이 필요 없는 공개 Copernicus GLO-90 COG 고도 타일을 받는다. `--start`를 빼면 준비 후 화면에서 시작한다. Host·Origin·CSRF 검사를 적용하고 127.0.0.1에만 바인딩한다.

- 2026-10-07 공식 `tileList.txt`와 S3 목록 대조: 고도 타일 **26,475개, 71,064,817,393 bytes (약 71.06GB)**. `manifest.json`에 파일 크기·ETag·출처·크레딧을 고정한다. AUXFILES의 보조 품질 레이어와 안내 파일은 이 고도 타일 용량에 포함하지 않는다. 공식 목록에 없는 바다에는 타일이 없다.
- GLO-90 공개 COG 원본 GeoTIFF의 바이트를 그대로 보존한다. 원본이 이미 DEFLATE 압축되어 있으며 추가 축소·양자화·재표본화를 하지 않는다. 약 90m 원본 격자, 고위도의 원본 경도 간격도 유지한다. 이 자료는 DSM으로 건물·식생을 포함한다.
- 기본 경로: Windows `%LOCALAPPDATA%\jmgj-research\dem\Copernicus-GLO-90`. `DEM_GLOBAL_DIR` 설정으로 지정할 수 있다. `tiles/`에 원본, `manifest.json`에 전체 목록, `index.sqlite`에 파일별 SHA-256·ETag·검증 시각을 보관한다. OneDrive 밖에 저장하며 Git에 포함하지 않는다.
- 파일 크기·S3 ETag(MD5)·WGS84 좌표계·float32·원본 격자·타일 위치·전체 높이 배열의 읽기 가능성을 확인한 뒤 타일을 등록한다. 이번 공식 목록의 ETag는 모두 단일 MD5다. 검증이 끝나기 전 파일은 앱에서 사용하지 않는다.
- 최대 4개 파일을 동시에 처리한다. 일시적 연결 오류/429/5xx는 파일당 최대 3회 시도하고, 그 외 오류는 중단한다. 중단 요청 시 진행 중인 파일들을 마친다. 이어받으면 완료 파일을 검증해 재사용하며 기존 파일을 덮어쓰지 않는다. 저장 공간 검사에는 Black Marble 전체 원본 용량도 여유분으로 반영한다.
- 이미 로컬 장소 캐시에 있는 정확한 원본 타일은 복사·검증해 재사용한다. 전 세계 파일을 하나로 합치지 않는다. 관측 반경에 필요한 검증 타일이 준비된 경우에만 작은 지형 묶음을 로컬에서 생성해 연별 Black Marble과 연결한다. 계산 중 추가 다운로드는 발생하지 않는다. 토지 타일의 미완료·실패·결측을 바다로 대체하지 않는다. 날짜 변경선·극지방을 가로지르는 관측 계산 제한은 그대로다.

검증: 백엔드 40개 테스트, 출처 파일 lint와 다운로드 화면 JavaScript 구문 검사 통과. 실제 적도 타일과 북위 80° 타일의 ETag·원본 격자·전체 배열 읽기를 확인했다. 내려받은 리브르빌 주변 DEM과 2025년 Black Marble을 **합성 시험 기상값**으로 연결한 evaluate-cached API는 `source=black-marble-dem`, 계산 픽셀 1,000개를 반환했고 외부 API 호출은 없었다. 이는 저장 자료 연결 검증이며 모델의 과학적 정확도 검증이 아니다.

현재 전 세계 다운로드는 진행 중이며 전체 완료와 구분한다. 최종 사용자용 Windows 앱 패키징과 지역 패키지 배포는 별도 작업이다.

## 출처

새 제공자는 웹의 설정 → 출처에 함께 기록한다. 공식 링크:

- [Copernicus DEM 공개 자료와 라이선스](https://copernicus-dem-90m.s3.amazonaws.com/readme.html)
- [NASA Black Marble VNP46A3](https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VNP46A3/)
- [NASA Black Marble VJ146A4 연별 자료](https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VJ146A4/)
- [NASA CMR API](https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html)
- [KakaoMap 개발자 문서](https://developers.kakao.com/docs/ko/kakaomap/common)
- [VWorld](https://www.vworld.kr/)

키, 토큰, `.env`, 내려받은 지형·H5 및 사용자 계정 사용량은 GitHub에 올리지 않는다. 현재 GitHub Release에 없는 원본 예제 자료 URL을 배포 설정으로 사용하지 않는다. 공용 웹의 무료 호스팅은 재시작 때 로컬 파일이 사라질 수 있으므로, 현재 로컬 저장 방식은 개인 컴퓨터·추후 Windows 앱 사용을 우선한다.
