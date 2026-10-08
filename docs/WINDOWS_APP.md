# Windows 앱 미리보기

현재 관측 웹을 Electron 창에서 실행한다. Next.js 서버와 Python 계산 서버를 포함하므로 사용자는 Node.js나 Python을 따로 설치하지 않는다. 서버는 이 컴퓨터의 `127.0.0.1`에서만 실행하며 앱 종료 시 함께 종료한다. Render 등 호스팅 서버를 깨우지 않는다.

## 사용

- `JMGJ-Research-0.2.0-Windows-x64-Setup.exe`로 사용자 계정에 설치한다. 이번 개발 빌드는 `desktop/dist/0.2.0/win-unpacked/JMGJ Research.exe`로 실행할 수도 있다. 실행 파일 옆의 `resources`와 DLL 등 폴더 전체가 필요하다.
- 2025년 전 세계 Black Marble 앱용 자료 540개(1,137,270,637 bytes)를 설치 파일에 포함한다. 원본 해상도의 밝기·품질·좌표를 보존한 무손실 압축 부분집합이며 NASA 원본의 모든 레이어를 포함한 것은 아니다. 설치된 `resources/data/black-marble/VJ146A4-2025`에서 직접 읽으므로 사용자 데이터 폴더에 또 복사하지 않는다. 최종 사용자는 NASA 계정·다운로드 토큰이 필요 없다.
- DEM은 장소 선택 후 약 30km 주변에 필요한 Copernicus GLO-90 타일을 자동 다운로드하고 `%LOCALAPPDATA%/jmgj-research/assets/dem`에 저장한다. 같은 장소와 앱 재실행에서 저장 자료를 재사용한다. 첫 다운로드에는 인터넷이 필요하며 AWS 계정·키는 필요 없다. 날짜 변경선과 극지방을 가로지르는 영역은 아직 지원하지 않는다. 빠른 장소 변경은 작업 하나만 진행하고 현재 선택 장소만 이어서 준비한다.
- 기본 자료 경로는 `%LOCALAPPDATA%/jmgj-research`다. `dem/Copernicus-GLO-90`, `black-marble/VJ146A4-2025`의 기존 연구 자료가 있으면 우선 재사용한다. 전 세계 DEM 49.61GB와 NASA 원본 51.14GB는 설치 파일에 포함하지 않는다.
- 메뉴 `데이터 → 기존 데이터 폴더 연결…`에서 `dem`·`black-marble`이 들어 있는 상위 폴더를 고를 수 있다. 다음 실행부터 적용하며 기존 자료는 이동·삭제하지 않는다.
- 기존 연구에서 별도로 준비한 지역 지형은 `config.json`의 선택적인 `assetRoot`로 연결할 수 있다. 이번 기기에서는 기존 지역 DEM 1개(약 2.12MB)와 지역 설명만 앱 데이터 폴더로 해시 확인 후 보존해 기존 웹과 같은 파일을 사용한다. 전 세계 자료는 복사하지 않는다. 새 데이터 폴더를 선택하면 그 폴더의 자료로 다시 계산한다.
- 앱 설정과 브라우저 프로필은 `%LOCALAPPDATA%/jmgj-research/desktop`에 저장한다. 고정된 로컬 포트와 프로필을 재사용해 IndexedDB 기상·시상 캐시, 장비 설정과 사용량 장부를 유지한다. 포트 충돌 때 주소를 몰래 바꾸지 않으며 다른 실행 창을 닫고 재시도한다.
- 웹 브라우저와 앱의 저장소는 별도다. 기존 브라우저 기상 캐시는 자동 이전되지 않는다. API 키는 앱에서도 화면 메모리에만 유지한다. 앱을 재실행하면 키를 다시 입력해야 하며, 같은 키·장소의 유효한 앱 캐시는 재사용한다.
- Meteoblue 로그인·자료 출처 링크는 기본 브라우저로 연다. API 키 입력은 기존 기상 화면에서 한다. 장소 검색·기상·시상·DSS/일부 천체 자료는 인터넷이 필요하다. 모든 기능의 오프라인 지원은 아직 완료하지 않았다.
- 딥스카이 검색 목록 선택과 Enter 검색 모두 DSS 사진을 켜고 8° 시야로 이동한다. `안드로메다 은하`, `말머리 성운` 등 대표 이름 21개와 별칭·영문 이름을 검색할 수 있다. 말머리 성운은 Barnard 33이며 검색은 배경 성운 IC 434의 사진 영역으로 이동한다. DSS는 온라인 자료로, 사진 전체를 설치 파일에 포함하지 않는다.
- 현재 위치는 앱의 허용 창과 Windows 위치 제공자 상태에 영향을 받는다. 사용할 수 없으면 지도·좌표 선택을 사용한다.

## 개발 빌드

Windows x64, Node.js와 프로젝트 Python 가상환경이 필요하다. frontend 의존성과 backend requirements를 설치한 상태에서 실행한다.

```powershell
.venv/Scripts/python.exe -m pip install -r desktop/requirements-build.txt
cd desktop
npm ci --ignore-scripts=false
npm run prepare:app
npm start
npm run dist
```

Electron 설치 스크립트가 정책상 비활성화된 환경에서는 공식 런타임 설치를 위해 `node node_modules/electron/install.js`를 실행한다. `JMGJ_BUILD_PYTHON`으로 빌드용 Python 경로를 바꿀 수 있다. 빌드 도구 캐시는 OneDrive 밖에 두는 것이 좋다. 빌드 컴퓨터에는 검증된 2025년 Black Marble 압축본 540개와 `index.json`이 필요하다. 기본 연구 자료 경로를 쓰거나 `JMGJ_BLACK_MARBLE_SOURCE`로 지정한다. 준비 도구가 각 파일의 SHA-256·필수 H5 필드를 검사하고 압축본만 복사하며, 원문 다운로드 주소·원본 자료·계정 키는 포함하지 않는다.

앱용 Next 빌드는 `.next-desktop`에 만들어 개발 웹의 `.next`와 구분한다. `standalone` 서버·정적 파일·Stellarium 자산과 PyInstaller `onedir` 계산 서버를 `desktop/build`에 모은다. Python 코드 묶음은 EXE 옆 `.pkg`로 분리해 실행 중인 EXE를 다시 읽을 때의 Windows 접근 오류를 피한다. EXE·PKG·`_internal`을 함께 배포한다. `npm run dist`는 `desktop/dist`에 사용자별 NSIS 설치 프로그램을 만든다. 검증한 Black Marble 부분집합은 별도 data 리소스로 포함한다. 웹·Python 서버 묶음에 연구 데이터·`.env`가 섞이면 준비 스크립트가 실패한다. 빌드 결과와 대용량 자료는 Git에 올리지 않는다.

## 실행 격리와 진단

렌더러의 Node 통합을 끄고 context isolation·sandbox·web security를 유지한다. 파일 접근 IPC는 제공하지 않는다. 외부 탐색은 알려진 제공자의 HTTPS 링크만 기본 브라우저로 열고 앱 내 팝업은 막는다. 현재 위치 이외의 권한은 기본 거부한다.

실행마다 생성한 토큰을 Next 서버와 Python 서버에 전달한다. Electron은 앱 세션에 HttpOnly·SameSite=Strict 쿠키를 설정하고, 서버 간 계산·장소 요청에는 별도 헤더를 보낸다. 외부 사이트·다른 브라우저 탭의 무인증 요청은 차단한다. 토큰과 API 키·원문 응답은 시작 로그에 남기지 않는다.

`--diagnostics`는 숨긴 창으로 서버·페이지 로딩 및 무인증 차단을 확인한 뒤 종료한다. 결과는 프로필의 `diagnostics.json`에 쓰며 외부 기상 조회는 하지 않는다. 개발 시험의 `JMGJ_DESKTOP_PROFILE`로 프로필을 분리할 수 있다. `startup.log`에는 단계·종료 코드만 기록한다.

사용한 빌드 방식: [Next.js standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [Electron 보안 권장 사항](https://www.electronjs.org/docs/latest/tutorial/security), [electron-builder Windows](https://www.electron.build/win.html), [PyInstaller](https://pyinstaller.org/en/stable/usage.html). 포함된 엔진·자료의 출처·크레딧은 앱 설정의 출처 탭, `resources/NOTICE.txt`, `resources/licenses/DATA-NOTICES.txt`에서 확인한다. Copernicus 필수 크레딧·변경 자료 표기·책임 제한을 유지한다. 대응 소스는 공개 연구 GitHub의 `codex/personal-weather-app` 브랜치에 보관한다.

## 다음 작업

검증: 웹 63개, 백엔드 54개, 앱 실행 구조 3개 테스트와 변경 웹 코드 lint·TypeScript·앱용 production build를 통과했다. Black Marble 540개 파일의 해시와 필수 필드를 검사했다. 이전 0.1.0 묶인 Python 실행 파일에서 같은 지형·야간광·저장 예보를 사용한 18개 응답이 기존 웹의 결과와 정확히 같았다. 이때 기상을 새로 조회하지 않았으며 계산 서버는 stdin 종료로 정상 종료했다. 원본 지역 캐시와 세계 타일에서 새로 만든 지역 캐시가 다르면 같은 좌표라도 모델 결과가 달라질 수 있으므로 자료 선택까지 일치시켜 비교한다. 모델 계수나 실측 SQM 보정은 바꾸지 않았다.

0.2.0 계산 실행 파일은 기존 DEM·Black Marble 사용자 폴더가 없는 시험 환경에서 서울 주변 DEM 2개 타일·지역 모자이크·목록·지역 설정(합계 12,669,896 bytes)을 실제 저장하고 내장 야간광 자료를 연결했다. 같은 장소 재요청과 계산 서버 재실행에서 파일의 해시·크기·수정 시각이 모두 같았다. NASA 계정이나 Meteoblue 키 없이 진행했다. 패키지의 숨긴 창 진단에서는 0.2.0 페이지 로딩·내장 Black Marble 포함·두 서버의 무인증 403 차단을 확인했다. 이는 별도 PC 설치와 사진·검색의 화면상 표시까지 검증한 결과는 아니다.

- DEM 캐시 용량·삭제 관리와 Black Marble 기준 연도 갱신 화면
- Windows 설치·업데이트와 깨끗한 사용자 계정에서의 추가 확인
- 앱 아이콘·버전 관리 및 필요 시 코드 서명. 현재 미리보기는 유료 인증서로 서명하지 않는다.
- SQM 실측 정확도 검증·보정은 사용자가 정한 후속 연구 시점에 진행한다.
