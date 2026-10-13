# AstroSky PWA

아이폰·아이패드의 Safari에서 https://astrosky.jmgj-kakao-search.workers.dev/ 를 열고 공유 메뉴의 **홈 화면에 추가**를 선택합니다. 무료 설치형 웹 앱이며 Apple 개발자 계정이나 7일마다 재서명이 필요하지 않습니다.

설정 창 아래의 **업데이트 확인**에서 설치 안내·오프라인 준비·사용량·지역 자료 정리를 이용합니다. **오프라인 사용 준비**를 완료한 뒤 홈 화면 아이콘으로 실행하면 기본 하늘·장비·촬영 안내와 계산 엔진을 인터넷 없이 사용합니다. 선택한 지역의 DEM·Black Marble은 첫 선택 시 인터넷으로 받으며 검증한 자료를 재사용합니다. 새 기상·시상·장소 검색과 저장하지 않은 천체 사진은 인터넷이 필요합니다.

## Android와 공유하는 기능

`android/web/src/main.tsx`, `api.ts`, `model.ts`, `compass.ts`와 `frontend/components/SkyViewer`를 그대로 사용합니다. 천체·한글 별칭 검색, 딥스카이 사진, 시간·위치·현재 위치, 좌표선·은하수·자연 배경, 장비·카메라·LRGB/SHO 필터, 카메라·접안렌즈 화각, 촬영 안내, 사용자 파노라마의 자동 하늘 분리, 개인 Meteoblue 키·크레딧·기상 캐시, 시상과 기존 하늘 밝기 모델을 포함합니다.

플랫폼 연결은 `src/bridge.ts`에서 브라우저 방향 센서, 암호화 IndexedDB와 지역 CacheStorage로 바꿉니다. 나침반은 사용자 버튼에서 센서 권한을 요청하고 후면 카메라 방향을 따라갑니다. 새 값을 받은 뒤 기기를 조금 기울여 Safari의 북쪽 기준을 확보합니다. Android와 같은 북쪽 정렬·평활화·손 조작 시 따라가기 해제를 사용합니다. 실제 센서 오차·자기장 간섭과 모든 iPhone/iPad 모델의 성능을 보장하지 않으며 실기기 검증이 필요합니다.

## 저장·계산·업데이트

- 기본 오프라인 자산 약 121MB(압축 전)이며 새 지역·사진·배경은 추가됩니다. 설정에서 브라우저 추정 사용량·할당 한도를 확인하고 영구 저장을 요청합니다. 사용자나 운영체제의 저장소 정리로 자료가 없어지면 다시 내려받아야 합니다.
- 개인 키는 비추출 AES-GCM 키와 암호문으로 IndexedDB에 저장합니다. 서버가 키를 보관하거나 기상 조회를 자동 수행하지 않습니다. 브라우저의 동일 출처 스크립트에는 복호화 기능이 있으므로 네이티브 Keychain과 같은 보안 경계는 아닙니다. 연결 해제는 키만 제거합니다.
- `/bridge`는 HTTPS의 정해진 제공자·경로만 전달하는 동일 출처 POST입니다. 리디렉션, 임의 목적지와 외부 출처를 거부하며 키를 로그·캐시·서버 저장소에 남기지 않습니다. Kakao 운영자 키는 기존 별도 Worker에만 있습니다.
- 2025년 Black Marble 고정 목록·해시와 Copernicus GLO-90을 사용하며 원본 해상도를 낮추지 않습니다. Android와 같은 Pyodide/Python 모델을 별도 Worker에서 실행합니다. 기본 적용 지역과 위도·날짜 변경선 제한, 데이터 부족 시 대체 추정은 Android와 같습니다.
- 앱 업데이트는 새 Service Worker를 확인한 뒤 **업데이트 적용**으로 반영합니다. 이전 앱 자산 캐시만 정리하고 개인 키·장비·장소·기상·지역·사용자 배경은 보존합니다. **지역 자료 정리**는 다시 받을 수 있는 지역 파일만 삭제합니다.
- PWA 버전은 0.9.0부터입니다. iOS/iPadOS 17 이상·최신 Safari·WebGL 지원을 권장합니다. 휴대폰·태블릿과 세로·가로 화면을 공유 UI로 지원합니다.

## 빌드·배포

기존 `frontend` 의존성과 배경 모델 준비 도구가 필요합니다. 저장소 루트에서 실행합니다.

```powershell
node pwa/scripts/build.cjs
node frontend/node_modules/typescript/bin/tsc -p pwa/tsconfig.json --noEmit
node frontend/node_modules/vitest/vitest.mjs run --config pwa/vitest.config.mts
node --test pwa/tests/server.test.mjs
node services/kakao-search/node_modules/wrangler/bin/wrangler.js dev --config pwa/wrangler.jsonc --port 3010
node services/kakao-search/node_modules/wrangler/bin/wrangler.js deploy --config pwa/wrangler.jsonc
```

`pwa/build`는 Git에 넣지 않습니다. 정식 릴리스의 PWA ZIP에 정적 파일·전용 Worker·설정·설치 안내를 제공합니다. 로컬 파일을 더블 클릭하는 방식은 HTTPS·Service Worker 요건을 충족하지 않으므로 접속 링크 또는 로컬 개발 서버로 사용합니다. 25MiB를 넘는 배경 모델 파일은 배포 시만 분할하고 서버에서 원본 바이트로 합쳐 전달하며, 오프라인 저장 때 원본 SHA-256을 확인합니다.

출처와 라이선스는 앱의 **출처** 탭 및 `NOTICE.txt`, `licenses/`에서 확인합니다. Windows·Android 버전은 계속 제공됩니다.
