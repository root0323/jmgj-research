type DataSource = {
  name: string;
  url: string;
  description: string;
  notice?: { label: string; url: string };
};

type DataSourceGroup = {
  title: string;
  sources: readonly DataSource[];
};

// Add new external APIs, datasets and assets here when introducing them.
export const DATA_SOURCE_GROUPS: readonly DataSourceGroup[] = [
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
      { name: "Kakao Local API", url: "https://developers.kakao.com/docs/ko/local/dev-guide", description: "장소·주소 검색과 좌표의 주소 변환. 서버에 API 키가 설정된 경우 사용" },
      { name: "VWorld", url: "https://www.vworld.kr/", description: "국내 주소·장소 검색과 좌표의 주소 변환. 서버에 API 키가 설정된 경우 사용" },
    ],
  },
  {
    title: "천체·사진",
    sources: [
      { name: "Stellarium Web Engine", url: "https://github.com/Stellarium/stellarium-web-engine", description: "천구 표시 엔진과 Stellarium의 별·별자리·태양계·딥스카이 자료" },
      { name: "DSS · CDS HiPS", url: "https://aladin.cds.unistra.fr/hips/", description: "천체 사진. STScI의 Digitized Sky Survey를 CDS HiPS 서비스로 표시", notice: { label: "DSS 원자료·크레딧", url: "https://archive.stsci.edu/dss/acknowledging.html" } },
      { name: "HYG Database v4.1 · David Nash", url: "https://github.com/astronexus/HYG-Database", description: "별의 이름·위치·등급 등. 원자료를 선별하고 앱 형식으로 변환해 사용", notice: { label: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" } },
      { name: "OpenNGC · Mattia Verga 외 기여자", url: "https://github.com/mattiaverga/OpenNGC", description: "NGC/IC 딥스카이 천체 정보. 원자료를 앱 형식으로 변환해 사용", notice: { label: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" } },
    ],
  },
];
