type DataSource = {
  name: string;
  url: string;
  description: string;
  credit?: string;
  notice?: { label: string; url: string };
};

type DataSourceGroup = {
  title: string;
  sources: readonly DataSource[];
};

// Add new external APIs, datasets and assets here when introducing them.
export const DATA_SOURCE_GROUPS: readonly DataSourceGroup[] = [
  {
    title: "앱 실행·기기 센서",
    sources: [
      { name: "Android Sensor Framework", url: "https://developer.android.com/develop/sensors-and-location/sensors/sensors_position", description: "Android 휴대폰·태블릿의 방향과 기울기 센서. 관측 위치에 따른 자기편각을 보정하며 센서 없는 기기는 손 조작 지원" },
      { name: "Pyodide", url: "https://pyodide.org/en/stable/", description: "Android 앱 안의 별도 WebAssembly 작업에서 기존 Python 연구 모델과 NumPy·HDF5·Rasterio를 실행. 과학 계산 결과는 실측값이 아님", notice: { label: "MPL-2.0 및 라이브러리별 이용 조건", url: "https://github.com/pyodide/pyodide/blob/main/LICENSE" } },
      { name: "geotiff.js", url: "https://github.com/geotiffjs/geotiff.js", description: "Android 계산 작업에서 DEM 압축을 해제. 원본 해상도·높이값·좌표를 유지하며 저장된 원본 파일은 보존", notice: { label: "MIT License", url: "https://github.com/geotiffjs/geotiff.js/blob/master/LICENSE" } },
    ],
  },
  {
    title: "천체 촬영 안내",
    sources: [
      { name: "AstroBackyard · 계절별 촬영 대상", url: "https://astrobackyard.com/astrophotography-targets-by-season/", description: "대표 촬영 대상·함께 담는 구도 참고. 앱의 한글 검색 이름과 대상별 촬영 포인트는 개발자가 정리" },
      { name: "Galactic Hunter · 겨울 촬영 대상", url: "https://www.galactic-hunter.com/post/winter-the-15-best-astrophotography-targets", description: "겨울 성운·성단의 촬영 사례와 구도 참고" },
      { name: "Galactic Hunter · 봄 촬영 대상", url: "https://www.galactic-hunter.com/post/spring-the-15-best-astrophotography-targets", description: "봄 은하·은하군과 올빼미 성운 촬영 사례 참고" },
      { name: "Galactic Hunter · 여름 촬영 대상", url: "https://www.galactic-hunter.com/post/summer-the-15-best-astrophotography-targets", description: "여름 방출성운·행성상성운·성단 촬영 사례 참고" },
      { name: "Galactic Hunter · 가을 촬영 대상", url: "https://www.galactic-hunter.com/post/fall-the-15-best-astrophotography-targets", description: "가을 은하·성운의 촬영 사례와 광대역·협대역 선택 참고" },
      { name: "Cloudy Nights · 남쪽 하늘 촬영 기록", url: "https://www.cloudynights.com/forums/topic/753727-what-southern-dso-should-i-photograph/", description: "남쪽 하늘의 대표 촬영 대상 참고. 촬영 인기도를 집계한 통계 자료는 아님" },
      { name: "Practical Astrophotography · 보정 프레임", url: "https://www.practicalastrophotography.com/a-brief-guide-to-calibration-frames", description: "Flat·Dark·Bias·Dark-flat의 촬영 조건과 시작 장수 참고. 앱 수치는 공개 가이드를 바탕으로 정리한 시작 범위이며 대상별 실측 평균·보장된 최적값이 아님" },
      { name: "Nebula Photos · Nico Carver", url: "https://www.nebulaphotos.com/doc/filters-summary.pdf", description: "컬러·모노 카메라와 필터 선택의 일반 원리 참고. 앱의 장수·시간 배분은 별도 계획 예시", credit: "Nico Carver · Filters for Deep Sky Astrophotography (2020) · CC BY-SA 4.0", notice: { label: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" } },
      { name: "AstroBackyard · 카메라 촬영 설정", url: "https://astrobackyard.com/7-astrophotography-tips/", description: "RAW·수동 노출·ISO·카메라 렌즈 조리개 등 기본 촬영 설정 참고. 노출·총 시간과 채널 배분은 앱에서 정리한 시험 촬영 시작 예시이며 기종·환경별 자동 노출 모델이 아님" },
      { name: "Nikon · 은하수 촬영", url: "https://www.nikon.com.au/news/getstarted-astrophotography", description: "카메라 렌즈·수동 초점·삼각대와 은하수 촬영의 기본 원리 참고. 앱의 고정·추적 노출과 장수는 시험 시작 예시이며 렌즈별 별 흐름 한계를 계산한 값이 아님" },
      { name: "Celestron · 태양계 촬영 카메라", url: "https://www.celestron.com/blogs/astroimaging-guides/how-to-choose-a-celestron-solar-system-imager", description: "행성의 고속 동영상 촬영·품질 선별·정렬 합성 방식 참고. 앱의 행성별 밀리초 노출·클립 길이·선별 비율은 개발자가 정리한 시험 범위이며 공식 대상별 권장 수치를 옮긴 값이 아님" },
    ],
  },
  {
    title: "사용자 배경 처리",
    sources: [
      { name: "Qualcomm FFNet-40S", url: "https://huggingface.co/qualcomm/FFNet-40S", description: "사용자 파노라마의 하늘 영역을 앱 안에서 분리하는 내장 모델. 원본과 보정 결과는 사용자 기기에 저장", credit: "Copyright © 2022 Qualcomm Technologies, Inc. · BSD-3-Clause", notice: {label: "FFNet 라이선스", url: "https://github.com/Qualcomm-AI-research/FFNet/blob/master/LICENSE"} },
      { name: "ONNX Runtime", url: "https://onnxruntime.ai/", description: "하늘 분리 모델의 오프라인 실행", credit: "Copyright © Microsoft Corporation · MIT" },
    ],
  },
  {
    title: "프로젝트",
    sources: [
      { name: "root0323 GitHub", url: "https://github.com/root0323", description: "개발자 GitHub 계정" },
      { name: "jmgj-research", url: "https://github.com/root0323/jmgj-research", description: "이 프로그램의 연구·개발 저장소" },
      { name: "GitHub Releases", url: "https://docs.github.com/en/rest/releases/releases", description: "개발자 저장소의 정식 릴리스와 Android·Windows 업데이트 파일 및 파일 검증 해시" },
      { name: "원본 연구 코드 · JMGJ", url: "https://github.com/gyeon27/JMGJ", description: "프로그램의 기반이 된 연구 코드" },
    ],
  },
  {
    title: "기상·시상",
    sources: [
      { name: "Meteoblue Weather API", url: "https://business.meteoblue.com/products/weather-apis/free-weather-api", description: "개인 API 키로 조회하는 기상·대기 예보와 계정 사용량" },
      { name: "7Timer! ASTRO", url: "https://www.7timer.info/doc.php?lang=en", description: "장소·관측 시각에 따른 시상 예보. NOAA/NCEP GFS 기반" },
    ],
  },
  {
    title: "장소·지도",
    sources: [
      { name: "OpenStreetMap", url: "https://www.openstreetmap.org/copyright", description: "위치 선택 지도와 공개 지리 데이터 · © OpenStreetMap contributors", notice: { label: "ODbL", url: "https://www.openstreetmap.org/copyright" } },
      { name: "Photon · komoot", url: "https://github.com/komoot/photon", description: "OpenStreetMap 기반 장소 자동완성과 검색" },
      { name: "Nominatim", url: "https://nominatim.org/", description: "OpenStreetMap 기반 장소·주소 검색과 좌표의 주소 변환" },
      { name: "카카오맵 · Local API", url: "https://developers.kakao.com/docs/ko/local/dev-guide", description: "국내 장소·주소 검색과 좌표의 주소 변환. 운영자 공용 검색 서버 또는 로컬 운영자 키가 연결된 경우 사용" },
      { name: "VWorld", url: "https://www.vworld.kr/", description: "국내 주소·장소 검색과 좌표의 주소 변환. 서버에 API 키가 설정된 경우 사용" },
    ],
  },
  {
    title: "지형·야간 인공광",
    sources: [
        { name: "Copernicus DEM · GLO-90", url: "https://registry.opendata.aws/copernicus-dem/", description: "약 90m 간격의 지표면 높이(DSM). Windows 앱에서 장소 선택 시 주변 지형을 자동 다운로드하고 앱 전용 폴더에 저장·재사용. 건물·식생 포함. Copernicus 자료 제공기관은 이 자료의 사용에 관하여 책임을 부담하지 않습니다. 본 앱은 제공기관의 공식 인증·후원을 받은 앱이 아닙니다.", credit: "produced using Copernicus WorldDEM-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved", notice: { label: "GLO-90 이용 조건·라이선스", url: "https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf" } },
      { name: "NASA Black Marble · VNP46A3 V2", url: "https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VNP46A3/", description: "NASA/VIIRS 월별 야간 인공광 합성 자료. NASA 다운로드 인증 후 장소 주변 자료를 로컬에 저장한 경우 연구 모델에서 사용. 실시간 광공해 측정값이 아님", notice: { label: "자료 인용·DOI", url: "https://doi.org/10.5067/VIIRS/VNP46A3.002" } },
      { name: "NASA Black Marble · VJ146A4 V2", url: "https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VJ146A4/", description: "NASA/NOAA-20 VIIRS 2025년 연별 야간광 합성 자료. Windows 앱에서 선택 장소 주변의 앱용 타일만 자동 저장·재사용하며 사용자 NASA 계정은 필요 없음. 밝기·품질·좌표를 원본 해상도·자료형·값 그대로 추출·무손실 압축한 파생 자료이며 원본의 모든 레이어를 포함하지 않음. 실시간 측정값이 아님", notice: { label: "자료 인용·DOI", url: "https://doi.org/10.5067/VIIRS/VJ146A4.002" } },
      { name: "AstroSky · Cloudflare 자료 배포", url: "https://astrosky-black-marble.jmgj-kakao-search.workers.dev/", description: "개발자가 검증한 2025년 Black Marble 앱용 타일을 Cloudflare Workers Static Assets에서 제공. 앱이 파일 크기와 SHA-256을 확인해 필요한 지역만 기기에 저장", notice: { label: "원자료·가공·배포 안내", url: "https://astrosky-black-marble.jmgj-kakao-search.workers.dev/DATA-NOTICES.txt" } },
      { name: "NASA Earthdata CMR", url: "https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html", description: "장소와 기준 기간에 맞는 Black Marble 공식 파일 메타데이터 검색" },
    ],
  },
  {
    title: "천체·사진",
    sources: [
      { name: "Celestron · 광학 계산 참고", url: "https://www.celestron.com/blogs/knowledgebase/astronomy-glossary-of-terms", description: "접안렌즈 겉보기 시야각과 배율로 실시야각을 추정하는 계산 기준. 앱의 원형 시야는 광학 사양 기반 근사이며 실측 영상이 아님" },
      { name: "Stellarium Web Engine", url: "https://github.com/Stellarium/stellarium-web-engine", description: "천구 표시 엔진과 Stellarium의 별·별자리·태양계·딥스카이 자료" },
      { name: "Stellarium 기본 별 자료", url: "https://github.com/Stellarium/stellarium-web-engine/tree/15cd08a266a9fed1081bb5cd8fe62984943a9286/apps/test-skydata/stars", description: "약 7등급까지의 기본 별 타일을 고정 버전·파일 해시로 검증해 앱에 내장. 별 이름과 추가 별 정보는 HYG 카탈로그를 함께 사용", notice: { label: "Stellarium Web Engine · AGPL-3.0", url: "https://github.com/Stellarium/stellarium-web-engine/blob/master/LICENSE-AGPL-3.0.txt" } },
      { name: "Stellarium 은하수 자료", url: "https://github.com/Stellarium/stellarium-web-engine/tree/master/apps/test-skydata/surveys/milkyway", description: "Stellarium 은하수 텍스처 기반 HiPS 이미지와 이 이미지에서 추출한 윤곽선. 윤곽선은 화면 표시용이며 은하의 물리적 경계를 뜻하지 않음", notice: { label: "Stellarium Web Engine 라이선스", url: "https://github.com/Stellarium/stellarium-web-engine/blob/master/LICENSE-AGPL-3.0.txt" } },
      { name: "Stellarium · Guéreins 배경", url: "https://github.com/Stellarium/stellarium-web-engine/tree/master/apps/test-skydata/landscapes/guereins", description: "Fabien Chéreau의 프랑스 Guéreins 자연 지평 배경을 앱에 내장. 선택한 관측 장소의 실제 지형 사진이 아닌 기본 배경", credit: "Guéreins landscape © Fabien Chéreau / Stellarium", notice: { label: "Stellarium Web Engine · AGPL-3.0", url: "https://github.com/Stellarium/stellarium-web-engine/blob/master/LICENSE-AGPL-3.0.txt" } },
      { name: "ERFA · IAU SOFA", url: "https://github.com/liberfa/erfa/blob/master/src/g2icrs.c", description: "은하수 검색 시 현재 하늘의 은하면 방향을 찾는 은하좌표 변환 기준" },
      { name: "DSS · CDS HiPS", url: "https://aladin.cds.unistra.fr/hips/", description: "천체 사진. STScI의 Digitized Sky Survey를 CDS HiPS 서비스로 표시", notice: { label: "DSS 원자료·크레딧", url: "https://archive.stsci.edu/dss/acknowledging.html" } },
      { name: "NASA Hubble Messier Catalog", url: "https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/", description: "유명한 딥스카이 천체의 일반 이름과 메시에 번호 대조 참고 자료. 한글 별칭은 앱에서 정리한 검색 이름이며 사진은 DSS에서 표시" },
      { name: "NASA · Horsehead Nebula", url: "https://science.nasa.gov/asset/hubble/the-horsehead-nebula/", description: "말머리 성운(Barnard 33)과 배경 발광 성운 IC 434의 구분 참고. 앱은 ‘말머리 성운’ 검색을 IC 434 주변 사진 영역으로 연결" },
      { name: "HYG Database v4.1 · David Nash", url: "https://github.com/astronexus/HYG-Database", description: "별의 이름·위치·등급 등. 원자료를 선별하고 앱 형식으로 변환해 사용", notice: { label: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" } },
      { name: "OpenNGC · Mattia Verga 외 기여자", url: "https://github.com/mattiaverga/OpenNGC", description: "NGC/IC 딥스카이 천체 정보. 원자료를 앱 형식으로 변환해 사용", notice: { label: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" } },
    ],
  },
];
