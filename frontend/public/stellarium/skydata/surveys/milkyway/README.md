# Stellarium 은하수 HiPS 자료

Stellarium Web Engine 공식 예제의 은하수 자료를 변경 없이 포함한다.
`properties`, `Norder0/Allsky.webp`, `Norder0/Dir0/Npix0.webp`~`Npix11.webp`는 원본 Git blob SHA-1과 대조했다.

- 원본: https://github.com/Stellarium/stellarium-web-engine/tree/15cd08a266a9fed1081bb5cd8fe62984943a9286/apps/test-skydata/surveys/milkyway
- 제공: Stellarium 프로젝트. 원본 설명은 "Milkyway survey based on Stellarium milkyway texture."
- 원본 저장소 라이선스: 함께 보관한 `LICENSE-AGPL-3.0.txt`와 https://github.com/Stellarium/stellarium-web-engine/blob/15cd08a266a9fed1081bb5cd8fe62984943a9286/LICENSE-AGPL-3.0.txt 참고.

전체 12개 기본 해상도(order 0) 타일을 앱에서 직접 제공하므로 은하수 표시를 위한 별도 API 키나 외부 이미지 조회가 필요하지 않다.
은하수는 엔진의 넓은 시야 표시를 사용한다. 엔진은 20°부터 10°로 확대할 때 이 층을 점차 숨긴다. 확대 천체 사진은 별도의 DSS 기능에 해당한다.

## 검색 선택 윤곽선

`frontend/data/milkyway-outline.json`은 위 원본 이미지에서 추출한 화면 표시용 윤곽이다. 은하의 물리적 경계나 관측 가능 범위를 뜻하지 않는다. 은하수 검색으로 이동하면 두 가장자리를 표시하며, 다른 천체 선택이나 선택 해제 시 숨긴다.

재생성: NumPy·Pillow가 설치된 개발용 Python에서 `python frontend/scripts/build-milkyway-outline.py` 실행. 앱 실행에는 Python이나 추가 API가 필요하지 않다.

- Stellarium의 [HEALPix 좌표 계산](https://github.com/Stellarium/stellarium-web-engine/blob/15cd08a266a9fed1081bb5cd8fe62984943a9286/src/algos/healpix.c)과 [HiPS UV 축](https://github.com/Stellarium/stellarium-web-engine/blob/15cd08a266a9fed1081bb5cd8fe62984943a9286/src/hips.c)에 맞춰 12개 타일을 은하좌표 격자로 샘플링한다.
- [ERFA/SOFA 변환 행렬](https://github.com/liberfa/erfa/blob/master/src/g2icrs.c)을 사용한다.
- 0.25° 간격 격자에서 RGB 평균을 1° 가우시안으로 평활화하고, 12/255 밝기 이상인 가장 큰 연결 영역의 상·하단을 따른다. 고립된 별·마젤란운은 제외하고, 경도 0°/360°를 연결하여 1° 간격 ICRS 좌표로 저장한다.
- 파생 윤곽 자료에도 함께 보관한 AGPL-3.0 라이선스를 적용한다.
