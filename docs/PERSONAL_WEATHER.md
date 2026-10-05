# 개인 API 키로 관측 환경 자료 사용하기

첫 버전은 기존 관측 웹에 개인 Meteoblue 계정을 사용하는 기능을 붙인다.
Windows 앱으로 확장하기 전에 웹의 조회·저장·계산 경로를 먼저 검증한다.

## 사용 순서

1. 관측 패널의 **Meteoblue 로그인**을 눌러 공식 사이트에서 로그인한다.
2. **API 키 발급·계정**에서 Account overview의 Weather API를 활성화하고 키를 확인한다.
3. 웹에 돌아와 **개인 API 키 입력 → 키 적용**을 누른다. 키 적용만으로 API를 조회하지 않는다.
4. **지도에서 선택**으로 장소 한 곳을 정한다. 처음 선택된 곳은 서울이다.
5. 자료 구성을 선택하고 **선택한 장소 불러오기**를 누른다.
6. 받은 시각, 관측 시각의 시상·구름량·AOD, 누락 자료, 사용 크레딧을 확인한다.

비밀번호·이메일은 이 앱에 입력하지 않는다. 키는 현재 화면 메모리에만 두며 새로고침하면 지워진다.
키를 다시 입력하면 SHA-256 지문을 기준으로 해당 키의 저장 자료와 사용 기록을 연다.
연결을 해제해도 저장 자료와 사용 기록은 유지된다.

## 구성과 크레딧

| 구성 | 요청 패키지 | 1회 예상 비용 | 1천만 크레딧 기준 |
| --- | --- | ---: | ---: |
| 연구 당시 구성 | seeing-1h, airquality-1h, ensemble-1h, air-1h | 40,000 크레딧 | 250회 |
| 무료 3시간 구성 | airquality-3h, clouds-3h, air-3h | 24,000 크레딧 | 416회 |

연구 당시 구성은 기존 연구의 AOD·앙상블 구름량·운저·시상을 사용한다.
현재 무료 패키지 목록에는 seeing-1h·ensemble-1h가 없으므로 실제 키의 사용 권한은 응답으로 확인한다.
거절된 패키지를 표시하며, 다른 구성으로 자동 재요청하지 않는다.
3시간 구성은 Clouds의 구름량을 사용하고 **시상·달 위치를 제공하지 않는다**.
따라서 두 구성을 동등한 연구 입력으로 취급하지 않는다.

남은 횟수는 **남은 크레딧 ÷ 선택한 구성의 예상 비용을 내림**한 값이다.
연구 구성을 처음 한 번 정상 조회해 40,000 크레딧이 차감되면 **249 / 250**으로 표시한다.
응답의 `MB-Credits-Accounted` 헤더를 우선하고, 없는 성공 응답은 공식 패키지 가격으로 추정했다고 표시한다.
일부 자료만 받았거나 오류 응답에서도 차감 헤더가 오면 그 비용도 합산한다.
네트워크 실패로 비용을 확인하지 못하면 불명확하다고 표시한다.

**크레딧 기준과 계정 사용량 설정**에서 총 제공 크레딧과 앱 사용 이전의 사용량을 입력한다.
기본값 1천만은 공식 무료 체험 기준이며, 실제 제공량·만료일은 계정에서 확인한다.
API 활성화 날짜를 시작일로 맞추고 **전일까지 계정 사용량 동기화**를 누르면 Accounting API의 전체 페이지를 합산한다.
동기화한 과거 날짜의 로컬 기록은 중복 합산하지 않는다. 이후 날짜는 이 기기 기록을 더한다.
당일 다른 기기·앱의 사용, 구매, 기간 만료는 반영되지 않을 수 있으므로 공식 잔액으로 표시하지 않는다.
권한 거절·페이지 누락 시 기존 기록을 유지한다.

공식 자료 (2026-10-05 확인):

- [무료 체험: 1년·1천만 크레딧](https://docs.meteoblue.com/en/weather-apis/free-weather-api/overview)
- [무료 패키지 목록과 구성](https://docs.meteoblue.com/en/weather-apis/forecast-api/forecast-api-configurator)
- [패키지 가격·응답 헤더·변수 명세](https://my.meteoblue.com/packages/openapi.json)
- [Accounting API 안내](https://docs.meteoblue.com/en/weather-apis/accounting-api/overview)
- [Accounting API 명세](https://my.meteoblue.com/account/openapi.json)

## 브라우저 저장

원본 JSON과 발행·모델 실행 시각 등의 메타데이터, 자료를 받은 시각을 **IndexedDB**에 저장한다.
키 자체를 저장하지 않으며 키 지문·위경도·구성별로 구분한다. 크레딧 기록은 localStorage에 보관한다.
서버의 유료 저장 공간은 이 캐시에 필요하지 않다.

- 같은 장소·키·구성의 24시간 이내 자료는 차감 없이 재사용한다.
- 시간·천체·관측 방향 변경은 Meteoblue를 호출하지 않는다.
- 캐시가 없거나 24시간이 지나도 **버튼을 누르기 전에는 새 조회하지 않는다**.
- 오래된 자료는 참고용으로 남겨 두며 화면에 24시간이 지났다고 표시한다.
- 갱신하려면 **새 자료 요청 · 크레딧 사용**을 명시적으로 누른다.
- 예보 범위 밖의 관측 시각은 자료 없음으로 표시하며 가까운 날짜로 대신하지 않는다.
- 저장 공간이 차단되거나 부족하면 메모리로 재사용하고 종료 시 사라질 수 있다고 알린다.

브라우저 데이터 삭제·시크릿 모드 종료·사이트 주소 변경은 저장 자료와 사용 기록을 없앨 수 있다.
조회 시 최대 7일 예보와 이전 4일 자료를 요청한다. 이전 자료도 과거 예보이며 관측 실측값이 아니다.
키 만료·패키지 권한 문제는 브라우저 저장이나 Windows 앱 전환만으로 해결되지 않는다.

## 계산 경로와 연구 범위

수동 조회는 자체 Next.js `/api/meteoblue/weather`를 통해 Meteoblue에 전달한다.
키는 POST 본문으로 받으며 서버 파일·공유 캐시·연구 계산 서버에 저장하거나 전달하지 않는다.
키가 포함될 수 있는 원격 오류·URL을 반환하거나 로그에 출력하지 않으며, 응답에 되돌아온 키도 제거한다.

계산은 `/api/research/evaluate` → FastAPI `/api/difficulty/evaluate-cached`에서 저장 자료만 사용한다.
이 경로는 `.env`의 키, 기존 `environment_query()`의 네트워크 조회, 다른 사용자의 응답 캐시를 사용하지 않는다.
기존 연구 파서의 보간·달 위치 시간 인덱스 규칙을 재사용하고 기상 시간축은 Asia/Seoul로 요청한다.
달 위치의 기존 UTC 인덱스 규칙에 대한 과학적 재검증은 별도 연구 작업이다.
유효한 0 (AOD 0·달 위상각 0 등)이 기본값으로 바뀌던 환경 설정 문제도 수정했다.

Black Marble H5·DEM과 필요한 환경 입력이 모두 있으면 기존 연구 모델을 사용한다.
자료가 없거나 입력이 누락되면 **간이 추정**으로 표시한다. 계산 서버가 없어도 웹에서 저장 기상과 간이 추정을 볼 수 있다.
시상 없음은 0으로 표시하지 않는다. 기존 난이도 분류, 새로운 촬영 SNR 모델, 49방향 관측 기록기는 이번 변경 범위 밖이다.
Stellarium 원격 데이터·천체 사진·지도까지 모두 오프라인으로 제공하는 버전은 아니다.

## 로컬 실행

저장소 루트에서 Python 가상 환경을 만든다. 기존 환경이 있으면 그대로 사용한다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\src\app\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --app-dir backend\src
```

다른 터미널에서 웹을 실행한다.

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

[http://localhost:3000](http://localhost:3000)에 접속한다.
연구 서버 주소를 바꾸려면 Next.js 서버 환경 변수 `RESEARCH_BACKEND_URL`을 지정한다. 기본값은 `http://127.0.0.1:8000`이다.
새 경로에 개인 기상 키를 서버 환경 변수로 설정할 필요는 없다.
프로덕션은 `npm.cmd run build` 후 `npm.cmd run start`로 실행한다.
배포 시 Next.js API Routes가 실행되는 환경이 필요하며 정적 파일만 제공하는 호스팅에서는 기상 프록시가 작동하지 않는다.

## 검증

```powershell
# frontend 폴더에서
npm.cmd test
npm.cmd run lint
npm.cmd run build

# 저장소 루트에서
$env:PYTHONPATH = (Join-Path (Get-Location) 'backend\src')
.\.venv\Scripts\python.exe -m unittest discover -s backend\tests -v
```

중복 차감 방지, 키별 기록, 24시간 경계, 부분 실패, 헤더·추정 비용 구분, 계정 페이지 합산,
키 유출 방지, 시간 보간·자료 범위, 저장 계산 시 API 미호출, 유효한 0 보존을 자동 검증한다.
실제 사용자 키의 권한과 청구는 사용자 키로 처음 조회할 때 확인해야 한다.
