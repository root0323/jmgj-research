# 개인 연구 관측 웹

Next.js Pages Router와 Stellarium Web Engine 기반 관측 화면입니다.
개인 Meteoblue 키로 한 장소를 수동 조회하고, 받은 자료를 브라우저 IndexedDB에 저장합니다.

```powershell
npm.cmd ci
npm.cmd run dev
```

[http://localhost:3000](http://localhost:3000)에서 관측 패널을 엽니다.
로그인·키 발급은 Meteoblue 공식 페이지에서 하고, 이 화면에 개인 API 키만 입력합니다.
자세한 구성과 크레딧 계산은 [사용 안내](../docs/PERSONAL_WEATHER.md)를 참고하세요.

검증:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

프로덕션 실행은 빌드 후 `npm.cmd run start`입니다.
Meteoblue 프록시와 저장 자료 계산 프록시는 Next.js API Routes를 사용합니다.
정적 파일만 제공하는 호스팅에서는 이 경로들이 실행되지 않습니다.
연구 계산 서버 주소는 서버 환경 변수 `RESEARCH_BACKEND_URL`로 지정합니다.
기본값은 `http://127.0.0.1:8000`이며, 사용자 키는 이 연구 서버로 전달하지 않습니다.
