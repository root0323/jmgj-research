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
- NASA: Earthdata 계정으로 LAADS에 로그인해 다운로드 토큰을 발급한다. 필요한 계정 승인·약관 동의는 계정 소유자가 직접 진행한다. 토큰은 다운로드 작업 메모리에서만 사용하며 설정·자료 메타데이터에 저장하지 않는다.

## 자료 준비와 재사용

설정 화면에서 장소의 위도·경도와 선택적 기준 월을 지정하고 `두 자료 준비`를 누른다. Meteoblue 유료 호출은 이 과정에서 발생하지 않는다. 자료는 Git에서 제외한 `.local-data/` 아래에 저장한다. `RESEARCH_ASSET_DIR` 환경변수로 경로를 바꿀 수 있다.

- Copernicus GLO-90: 관측 장소 주변 30km와 여유 구간의 지형 타일을 익명 다운로드해 EPSG:4326 GeoTIFF로 합친다. 약 90m 간격의 **DSM**이므로 건물·식생을 포함한다. 원본 연구 DEM과 같은 자료가 아니며 지형 차폐 결과는 다시 검증해야 한다. 공식 타일 목록에 없는 바다만 0m로 채우며, 다운로드 실패나 결측값을 바다로 처리하지 않는다.
- Black Marble VNP46A3 V2: NASA CMR에서 영역에 맞는 공식 10° 타일을 찾아 LAADS 다운로드 토큰으로 받는다. 같은 영역에 여러 타일이 필요하면 기준 월을 맞춘다. 월을 비우면 첫 타일의 최신 공개 월을 사용한다. 월별 위성 합성 자료이며 선택 시각의 실시간 광공해 측정값이 아니다.
- 이미 있는 타일은 재사용한다. 완성된 자료 목록은 원자적으로 교체한다. 저장 영역이 계산 반경을 덮는 경우만 사용하며, 다른 장소는 그 위치에서 자료를 준비해야 한다. 날짜 변경선·위도 ±85° 이상은 현재 지원하지 않는다.
- 과거 관측일 분석에는 그 시기에 맞는 기준 월을 직접 선택한다. 월별 자료의 자동 갱신은 수행하지 않는다. 새 자료가 필요하면 준비 버튼을 다시 누른다.
- 기존 H5·DEM도 `.env`의 `BLACK_MARBLE_H5_PATH`, `DEM_RASTER_PATH`로 연결 가능하다. DEM은 WGS84 EPSG:4326, 단위 m, 필요한 범위 전체를 포함해야 한다. 잘못된 좌표계·결측 지형은 연구 모델에서 제외한다.

## 연구 모델 연결

현재 웹의 3시간 기상 자료에서 AOD·구름량·구름 밑면 압력을 읽고, 같은 장소·시각의 달 위치·위상은 Stellarium 엔진의 복제한 관측자로 계산한다. 화면의 시각과 위치는 바꾸지 않는다. 시상은 밝기 모델 수식에서 사용되지 않으므로 필수 조건에서 제외하며, 시상 값을 새로 추정하지 않는다. 기존 7Timer 시상 예보 표시는 유지한다.

모델에 Black Marble 인공광, 지형에 의한 인공광 차폐와 달빛 차폐, 저장 기상 자료를 전달한다. 방향·시간 변경 때 Meteoblue를 추가 호출하지 않는다. 필수 기상값·달 위치·지형·인공광 자료가 없거나 범위가 맞지 않으면 간이 추정으로 남는다. `POST /api/difficulty/evaluate-cached` 응답의 `source`가 `black-marble-dem`인 경우만 실제 연구 모델 계산 성공이다. `GET /api/health`의 키 설정·캐시 존재 정보 자체는 계산 성공을 뜻하지 않는다.

원본 연구 자료가 없으므로 새로운 공개 자료를 사용한 결과의 과학적 타당성은 기존 관측 CSV 등과 별도로 검증해야 한다. 모델 계수의 재보정은 이번 연결 작업의 범위에 포함하지 않는다.

## 출처

새 제공자는 웹의 설정 → 출처에 함께 기록한다. 공식 링크:

- [Copernicus DEM 공개 자료와 라이선스](https://copernicus-dem-90m.s3.amazonaws.com/readme.html)
- [NASA Black Marble VNP46A3](https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VNP46A3/)
- [NASA CMR API](https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html)
- [KakaoMap 개발자 문서](https://developers.kakao.com/docs/ko/kakaomap/common)
- [VWorld](https://www.vworld.kr/)

키, 토큰, `.env`, 내려받은 지형·H5 및 사용자 계정 사용량은 GitHub에 올리지 않는다. 현재 GitHub Release에 없는 원본 예제 자료 URL을 배포 설정으로 사용하지 않는다. 공용 웹의 무료 호스팅은 재시작 때 로컬 파일이 사라질 수 있으므로, 현재 로컬 저장 방식은 개인 컴퓨터·추후 Windows 앱 사용을 우선한다.
