# 운영자 공용 장소 검색 서버

사용자 앱에는 카카오 키를 포함하지 않는다. 운영자의 Cloudflare Workers 무료 계정에 이 서버를 배포하고 `KAKAO_REST_API_KEY`를 Worker Secret으로 등록한다. 앱은 공개 Worker 주소로 검색하며 카카오 회원가입·로그인·개별 키 입력이 필요 없다. 기상 키 정책과 DEM·Black Marble 저장 방식은 바꾸지 않는다.

## 운영자 준비

1. 카카오 개발자 앱을 만들고 카카오맵 API를 활성화한다. 무료 쿼터 대상 앱인지 확인한다. 2026-10-08 공식 문서 기준 개발자 계정에서 처음 활성화한 앱에 무료 쿼터를 제공한다.
2. Cloudflare 무료 계정을 생성·이메일 인증한다. 유료 Workers 플랜이나 카카오 유료 API는 활성화하지 않는다.
3. 이 폴더에서 `npm ci`, `npx wrangler login`, `npm test`를 실행한다. 로그인 권한 승인은 계정 소유자가 직접 한다.
4. `npm run deploy`로 배포하고 `npx wrangler secret put KAKAO_REST_API_KEY`의 비공개 입력에 운영자 키를 넣는다. 키를 명령행 인자·wrangler.jsonc·Git·앱에 쓰지 않는다.
5. `/health`와 실제 국내 장소의 키워드·주소·역지오코딩 응답을 확인한다. 키가 없는 설치 환경에서 확인해야 사용자별 키가 필요 없음을 검증할 수 있다.
6. 공개 `https://<worker>.<계정>.workers.dev` 주소만 `desktop/public-services.json`의 `kakaoProxyUrl`에 넣고 새 설치 파일을 만든다. 개발 웹은 운영자 설정의 `KAKAO_PROXY_URL`로 같은 주소를 사용한다. 2026-10-08 배포 주소는 `https://jmgj-kakao-search.jmgj-kakao-search.workers.dev`이며, 개인 키 없는 검색·주소·역지오코딩을 확인했다.

## 처리 범위와 한도

- `GET /v2/local/search/address.json`, `/v2/local/search/keyword.json`, `/v2/local/geo/coord2address.json`만 허용한다. 외부 URL·추가 파라미터·중복 파라미터는 거부한다. 업스트림 목적지는 `https://dapi.kakao.com`에 고정하고 리다이렉트를 따르지 않는다.
- 검색어 2~160자, 최대 15개 검색 결과, WGS84 위경도만 지원한다. 사용자 헤더의 인증 정보는 카카오에 전달하지 않는다. 운영자 키는 서버에서 카카오에만 전송한다.
- Cloudflare의 호출 제한 바인딩으로 IP당 각 Cloudflare 지점에서 분당 120개 요청을 제한한다. 사용자 계정이 없으므로 공유 네트워크 사용자는 이 제한을 함께 적용받을 수 있다. 이 값은 전 세계의 엄밀한 사용자별·일별 한도나 남용 완전 차단을 보장하지 않는다.
- API 오류·타임아웃·한도 초과의 원문과 응답 헤더를 전달하거나 기록하지 않는다. Worker의 요청 로그를 활성화하지 않는다. 검색어·현재 위치는 요청 처리에만 사용하며 서버 DB·공유 캐시에 저장하지 않는다. 카카오 결과는 앱·백엔드의 검색 캐시에도 저장하지 않고 실시간으로 사용한다. 기존 Photon·OpenStreetMap 캐시는 유지한다.
- 2026-10-08 공식 문서 기준 Workers Free는 계정 합계 하루 100,000요청, 카카오 키워드 검색은 앱 합계 하루 100,000회, 전체 카카오 API는 무료 월간 3,000,000회다. 모든 앱 사용자가 운영자 한도를 공유하며 제한은 변경될 수 있다. 유료 옵션을 켜지 않으면 초과 시 검색 제한이 생기므로 무제한 무료 서비스를 약속하지 않는다.
- 공용 서버가 응답하지 않으면 앱의 기존 공개 검색 경로를 사용한다. 공개 서버는 로그인 없는 검색을 제공하므로 사용량을 운영자가 확인하고 필요하면 일시 중단할 수 있어야 한다. 서버 키 교체는 설치 파일을 다시 배포하지 않고 가능하다.

공식 문서: [카카오맵 사용 방법](https://developers.kakao.com/docs/ko/kakaomap/common), [카카오 실시간 호출 안내](https://devtalk.kakao.com/t/local-api/151731), [카카오 쿼터](https://developers.kakao.com/docs/ko/getting-started/quota), [Workers 무료 한도](https://developers.cloudflare.com/workers/platform/limits/), [Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [호출 제한 바인딩](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
