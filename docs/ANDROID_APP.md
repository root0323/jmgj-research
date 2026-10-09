# AstroSky Android

Windows 앱을 유지하면서 추가한 Android 버전이다. 휴대폰·태블릿에서 같은 천체 화면, 장비 설정, 사진, 촬영 안내, 개인 기상 자료와 지역 계산을 사용한다.

## 설치와 호환

- Android 8.0(API 26) 이상, WebGL 지원과 최근 Android System WebView가 필요하다. ARM/ARM64/x86 기종으로 제한하지 않는 Java+WebAssembly APK이다.
- GitHub Release의 `AstroSky-0.8.0-Android.apk`를 기기에서 연다. Android가 요청하면 해당 다운로드 앱의 APK 설치 권한을 허용한다.
- 휴대폰·태블릿, 세로·가로 화면에 맞춰 버튼과 패널을 배치한다. 모든 제조사·기기에 대한 실제 검증을 의미하지 않는다.
- 나침반 버튼을 누르면 후면 카메라가 가리키는 하늘 방향을 따라간다. 회전 벡터 센서, 지자기 회전 벡터, 가속도+지자기 순으로 사용한다. 관측 위치의 자기편각을 보정하며 기울기·방위각을 부드럽게 적용한다. 센서가 없는 기기는 손으로 조작한다. 백그라운드에서는 센서를 해제한다.
- 동일 앱 ID와 서명 키로 새 APK를 설치하면 기존 버전에 덮어쓰며 앱 설정과 지역 저장 자료를 유지한다. 이 첫 Android 버전은 APK 방식으로 배포한다.

## 데이터와 계산

- 기존 Windows/FastAPI 서버 또는 사용자의 PC에 연결하지 않는다. 지역 계산은 기기 안의 별도 Pyodide 0.29.3 작업에서 실행한다.
- 기존 Python 연구 모델과 계수, NumPy/H5Py/Rasterio를 포함한다. Numba JIT는 같은 Python 함수로 대체한다. 기종에 따라 첫 준비와 계산 시간이 달라진다.
- 기본 별·은하수·지평 배경과 배경 분리 모델은 내장한다. DSS 등 원격 사진, 첫 지역 다운로드와 새로운 기상 조회에는 인터넷이 필요하다.
- Copernicus GLO-90 DEM과 2025년 Black Marble 앱용 타일을 관측 위치 주변만 자동 다운로드한다. NASA 계정은 필요 없으며 H5의 크기·SHA-256을 검증한다.
- 원본 압축 타일은 앱 전용 파일 폴더에 저장한다. 다시 선택하면 재사용한다. 전체 세계 데이터는 APK에 포함하지 않는다.
- GDAL/WASM의 Deflate 제약 때문에 DEM은 계산 작업의 임시 메모리에서만 무압축 float32 TIFF로 바꾼다. 픽셀·해상도·원래 PixelIsPoint/Area 좌표·결측값을 유지한다. 디스크 원본은 변경하지 않는다. 임시 지역 작업은 두 곳까지 유지한다.
- 기상은 IndexedDB, 장비·설정은 WebView 저장소, 사용자가 넣은 배경은 기기 CacheStorage에 저장한다. 개인 Meteoblue 키는 입력 후 현재 세션에서만 사용한다. 로그·앱 파일·Git에 넣지 않는다.
- Android 원점은 `https://appassets.androidplatform.net`으로 고정한다. 네이티브 메시지는 해당 원점의 최상위 프레임으로 한정하고 외부 링크는 브라우저로 연다. HTTPS 제공자·자료 경로를 제한한다. 위치 권한은 현재 위치 요청 시에만 묻는다.

## 빌드

JDK 17, Gradle 8.11.1, Android SDK 35와 Build Tools 35가 필요하다. 먼저 frontend 의존성을 설치한다. `android/scripts/build.ps1`은 Vite 화면, 해시 검증한 별 카탈로그, 모델·라이브러리와 기존 공개 자료를 묶어 APK를 만든다. Gradle/SDK는 한글 경로 제약을 피하도록 별도 ASCII 경로에서 실행한다.

배포 서명 키 `android/astrosky-release.jks`와 `android/signing.properties`는 Git 제외 대상이다. 후속 APK의 동일 서명을 위해 안전하게 보관한다. 새 키로 대체하면 기존 앱 위에 업데이트할 수 없다.

`node --test android/tests/*.test.cjs`는 DEM 값·좌표 보존을, Gradle `testDebugUnitTest`는 후면 카메라 방향·자기편각과 네트워크 제공자 제한을 확인한다. 실제 휴대폰의 자기장 간섭·센서 정확도는 실기기 검증이 필요하다.

## 0.8.0 검증

Android 15 전용 에뮬레이터의 실제 APK/WebView에서 360×800 화면의 모든 도구 버튼, 나침반 방향 적용, 서울 지역 자료 준비, 제주과학고등학교 검색을 확인했다. 같은 실제 DEM/H5와 고정 기상 입력에서 Android WASM과 검증된 Windows 계산 서버가 모두 SQM 15.929, 야간광 픽셀 835개를 반환했다. 기상 입력은 검증용 고정 값이며 새 Meteoblue 조회를 사용하지 않았다. 이 비교는 실행 일치 검증이며 실제 하늘 밝기의 정확도 검증을 대신하지 않는다.

최종 APK는 배포 키의 Android 서명 검증을 통과했다. 다운로드 크기 76,010,708 bytes, SHA-256 `1cc7e735094d5ad8524c7b9fa9a4ab156eb692533a898600be1bd2deed634bf1`. 서명 인증서 SHA-256은 `e5b8e6099682eb248b624e2baa28c2450e6ea8188409db784ecb9f596542c9d9`이다. 실제 제조사별 휴대폰·태블릿 검증은 후속 단계다.
