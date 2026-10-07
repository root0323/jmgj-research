# Stellarium 은하수 HiPS 자료

Stellarium Web Engine 공식 예제의 은하수 자료를 변경 없이 포함한다.
`properties`, `Norder0/Allsky.webp`, `Norder0/Dir0/Npix0.webp`~`Npix11.webp`는 원본 Git blob SHA-1과 대조했다.

- 원본: https://github.com/Stellarium/stellarium-web-engine/tree/15cd08a266a9fed1081bb5cd8fe62984943a9286/apps/test-skydata/surveys/milkyway
- 제공: Stellarium 프로젝트. 원본 설명은 "Milkyway survey based on Stellarium milkyway texture."
- 원본 저장소 라이선스: 함께 보관한 `LICENSE-AGPL-3.0.txt`와 https://github.com/Stellarium/stellarium-web-engine/blob/15cd08a266a9fed1081bb5cd8fe62984943a9286/LICENSE-AGPL-3.0.txt 참고.

전체 12개 기본 해상도(order 0) 타일을 앱에서 직접 제공하므로 은하수 표시를 위한 별도 API 키나 외부 이미지 조회가 필요하지 않다.
은하수는 엔진의 넓은 시야 표시를 사용한다. 엔진은 20°부터 10°로 확대할 때 이 층을 점차 숨긴다. 확대 천체 사진은 별도의 DSS 기능에 해당한다.
