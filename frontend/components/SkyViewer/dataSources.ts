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
      { name: "NASA Black Marble · VJ146A4 V2", url: "https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VJ146A4/", description: "NASA/NOAA-20 VIIRS 2025년 연별 야간광 합성 자료. Windows 앱에 전 세계 540개 앱용 타일(약 1.14GB)을 포함해 사용자 NASA 계정 없이 사용. 밝기·품질·좌표를 원본 해상도·자료형·값 그대로 추출·무손실 압축한 파생 자료이며 원본의 모든 레이어를 포함하지 않음. 실시간 측정값이 아님", notice: { label: "자료 인용·DOI", url: "https://doi.org/10.5067/VIIRS/VJ146A4.002" } },
      { name: "NASA Earthdata CMR", url: "https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html", description: "장소와 기준 기간에 맞는 Black Marble 공식 파일 메타데이터 검색" },
    ],
  },
  {
    title: "천체·사진",
    sources: [
      { name: "Celestron · 광학 계산 참고", url: "https://www.celestron.com/blogs/knowledgebase/astronomy-glossary-of-terms", description: "접안렌즈 겉보기 시야각과 배율로 실시야각을 추정하는 계산 기준. 앱의 원형 시야는 광학 사양 기반 근사이며 실측 영상이 아님" },
      { name: "Stellarium Web Engine", url: "https://github.com/Stellarium/stellarium-web-engine", description: "천구 표시 엔진과 Stellarium의 별·별자리·태양계·딥스카이 자료" },
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
