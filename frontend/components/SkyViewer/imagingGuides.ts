// Editorial starting ranges for tracked imaging, not measured averages or an
// exposure calculator for the selected sky. References live in dataSources.ts.
export type ImagingCamera = "dslr" | "color" | "mono";
export type ImagingRecipe = "RGB" | "LRGB" | "HaRGB" | "dual" | "HOO" | "SHO";
type ProfileId = "orion" | "brightGalaxy" | "galaxy" | "emission" | "faintEmission" | "reflection" | "cluster" | "planetary" | "wide";
type Range = readonly [number, number];
type GuideIdentity = {
  id: string;
  name: string;
  catalog: string;
  aliases: readonly string[];
  season: "겨울" | "봄" | "여름" | "가을" | "남쪽 하늘" | "관측 시기 확인";
  note: string;
};
export type LensGuide = {
  focalLength: string;
  aperture: string;
  iso: string;
  fixedSeconds: Range;
  trackedSeconds: Range;
  fixedFrames: Range;
  trackedFrames: Range;
  note: string;
};
export type DeepSkyGuide = GuideIdentity & { profile: ProfileId; lens?: LensGuide; lensOnly?: boolean; kind?: never };
export type PlanetGuide = GuideIdentity & {
  kind: "planet";
  exposureMs: Range;
  clipSeconds: Range;
  filterNote: string;
};
export type ImagingGuide = DeepSkyGuide | PlanetGuide;

type ImagingProfile = {
  label: string;
  broadSeconds: Range;
  narrowSeconds: Range | null;
  hours: Range;
  monoRecipe: ImagingRecipe;
  filterNote: string;
};

export const IMAGING_PROFILES: Record<ProfileId, ImagingProfile> = {
  orion: { label: "밝은 성운 · HDR", broadSeconds: [30, 120], narrowSeconds: [120, 300], hours: [1, 3], monoRecipe: "LRGB", filterNote: "컬러는 광대역, 모노는 LRGB로 시작. Hα·OⅢ 촬영은 성운 구조를 강조하는 선택입니다." },
  brightGalaxy: { label: "밝은 은하", broadSeconds: [60, 180], narrowSeconds: null, hours: [2, 5], monoRecipe: "LRGB", filterNote: "컬러는 광대역, 모노는 LRGB. 협대역만으로 촬영하면 은하의 연속광과 별 색을 잃습니다." },
  galaxy: { label: "은하 · 은하군", broadSeconds: [60, 180], narrowSeconds: null, hours: [3, 6], monoRecipe: "LRGB", filterNote: "컬러는 광대역, 모노는 LRGB. 어두운 하늘을 우선하고, Hα는 별 생성 영역을 보충할 때 선택합니다." },
  emission: { label: "방출성운", broadSeconds: [60, 180], narrowSeconds: [180, 300], hours: [3, 6], monoRecipe: "HOO", filterNote: "컬러는 광대역 또는 Hα/OⅢ 듀얼밴드. 모노는 HOO(Hα·OⅢ), SⅡ를 더한 SHO도 선택할 수 있습니다." },
  faintEmission: { label: "희미한 방출성운", broadSeconds: [120, 180], narrowSeconds: [180, 300], hours: [6, 12], monoRecipe: "SHO", filterNote: "컬러는 Hα/OⅢ 듀얼밴드, 모노는 SHO 또는 HOO로 성운 대비를 높일 수 있습니다. 약한 채널에는 시간을 더 배분합니다." },
  reflection: { label: "반사성운 · 먼지", broadSeconds: [60, 180], narrowSeconds: null, hours: [4, 8], monoRecipe: "LRGB", filterNote: "컬러는 광대역, 모노는 LRGB. 반사광·먼지는 협대역으로 잘 잡히지 않아 어두운 하늘과 총 노출시간이 중요합니다." },
  cluster: { label: "성단", broadSeconds: [30, 90], narrowSeconds: null, hours: [1, 2], monoRecipe: "RGB", filterNote: "컬러는 광대역, 모노는 RGB 또는 LRGB. 별 색을 남기도록 협대역보다 광대역을 사용합니다." },
  planetary: { label: "행성상성운 · 초신성 잔해", broadSeconds: [30, 120], narrowSeconds: [120, 300], hours: [2, 4], monoRecipe: "HOO", filterNote: "컬러는 광대역 또는 Hα/OⅢ 듀얼밴드, 모노는 HOO. 별 색을 보완하려면 RGB도 따로 확보합니다." },
  wide: { label: "광시야 성운 영역", broadSeconds: [60, 180], narrowSeconds: null, hours: [3, 6], monoRecipe: "LRGB", filterNote: "반사성운·암흑성운과 별 색을 함께 담는 광대역 촬영이 기본입니다. 모노는 LRGB를 사용합니다." },
};

function guide(id: string, name: string, catalog: string, season: ImagingGuide["season"], profile: ProfileId, note: string, ...aliases: string[]): DeepSkyGuide {
  return { id, name, catalog, season, profile, note, aliases };
}

// A row represents an imaging field. Multiple catalog numbers can be parts of
// one field; the list is not a count of distinct astronomical objects.
const DEEP_SKY_GUIDES: readonly DeepSkyGuide[] = [
  guide("orion", "오리온 대성운 · 러닝맨 성운", "M42 · M43 · NGC 1977", "겨울", "orion", "중심부는 5–15초 짧은 노출을 20–40장 추가해 HDR로 합성하세요. 러닝맨의 푸른 반사광은 광대역으로 남깁니다.", "오리온 성운", "Orion", "Running Man"),
  guide("horsehead", "말머리 성운 · 불꽃 성운", "B33 · IC 434 · NGC 2024", "겨울", "emission", "말머리는 B33, 밝은 배경은 IC 434입니다. Hα로 붉은 배경을 강조하고, 불꽃과 별 색은 RGB로 보완하세요. 알니탁의 번짐·고스트를 확인하세요.", "Barnard 33", "Horsehead", "Flame"),
  guide("rosette", "장미 성운", "NGC 2237 · 2238 · 2239 · 2246 / NGC 2244", "겨울", "emission", "성운 전체를 담는 화각을 먼저 확인하세요. HOO·SHO 모두 쓰이며 중앙 성단의 별 색은 RGB로 보완할 수 있습니다.", "Rosette", "C49", "NGC 2238", "NGC 2239", "NGC 2246"),
  guide("pleiades", "플레이아데스 성단", "M45", "겨울", "reflection", "밝은 별은 포화시키지 않고 주변의 푸른 먼지에 총 노출시간을 충분히 배분하세요. 협대역보다 광대역이 적합합니다.", "좀생이별", "Pleiades", "Seven Sisters"),
  guide("california", "캘리포니아 성운", "NGC 1499", "겨울", "faintEmission", "Hα 비중이 큰 대상입니다. OⅢ·SⅡ는 약할 수 있어 HaRGB나 Hα 중심 조합도 고려하세요. 긴 형태가 잘리지 않도록 구도를 잡으세요.", "California"),
  guide("christmas", "크리스마스트리 성단 · 원뿔 성운", "NGC 2264", "겨울", "emission", "Hα 성운과 푸른 반사성운이 섞여 있습니다. 협대역만 쓰기보다 RGB를 보완하면 여우털·성단 주변 색을 함께 남길 수 있습니다.", "Christmas Tree", "Cone", "여우털 성운", "Fox Fur"),
  guide("flaming", "불타는 별 성운 · 올챙이 성운", "IC 405 · IC 410", "겨울", "emission", "IC 405의 푸른 반사광에는 RGB가 유리하고, IC 410의 올챙이 구조에는 HOO·SHO가 쓰입니다. 두 영역을 함께 담을 화각을 확인하세요.", "Flaming Star", "Tadpoles", "불꽃별 성운"),
  guide("crab", "게 성운", "M1 · NGC 1952", "겨울", "planetary", "작은 초신성 잔해입니다. 광대역과 Hα·OⅢ를 함께 쓰며 필라멘트 세부에는 충분한 초점거리·추적 정확도가 필요합니다.", "Crab"),
  guide("jellyfish", "해파리 성운", "IC 443", "겨울", "faintEmission", "희미한 필라멘트에는 긴 총 노출시간이 유리합니다. Hα·OⅢ로 시작하고 밝은 주변 별의 반사·고스트를 확인하세요.", "Jellyfish"),
  guide("m78", "M78 반사성운", "M78 · NGC 2068", "겨울", "reflection", "푸른 반사광과 주변 먼지에는 광대역을 사용하세요. 달빛이 적고 어두운 하늘에서 희미한 배경을 쌓는 것이 중요합니다.", "메시에 78"),
  guide("witch", "마녀머리 성운", "IC 2118", "겨울", "reflection", "넓고 희미한 반사성운입니다. 광대역과 짧은 초점거리로 전체 구도를 잡고 리겔의 화면 밖 번짐도 확인하세요.", "Witch Head"),
  guide("barnard", "바너드 루프", "Sh2-276", "겨울", "faintEmission", "오리온 주변의 매우 넓은 Hα 영역입니다. 망원경보다 카메라 렌즈·모자이크가 알맞을 수 있고 Hα 반응이 약한 미개조 카메라는 더 많은 시간이 필요합니다.", "Barnard's Loop", "Barnards Loop", "바나드 루프"),
  guide("whirlpool", "소용돌이 은하", "M51 · NGC 5194 · NGC 5195", "봄", "galaxy", "두 은하와 나선팔을 함께 담으세요. 광대역을 기본으로 하고 Hα는 별 생성 영역의 보충 자료로 사용합니다.", "Whirlpool"),
  guide("bodes", "보데 은하 · 시가 은하", "M81 · M82", "봄", "galaxy", "두 은하의 밝은 중심부를 포화시키지 마세요. M82의 붉은 가스에는 별도의 Hα 자료를 보충할 수 있습니다.", "Bode", "Bodes", "Cigar", "보데스 은하"),
  guide("pinwheel", "바람개비 은하", "M101 · NGC 5457", "봄", "galaxy", "넓고 희미한 나선팔을 위해 총 노출시간을 늘리세요. Hα는 광대역에 별 생성 영역을 보충할 때 사용합니다.", "Pinwheel"),
  guide("leo", "사자자리 삼중 은하", "M65 · M66 · NGC 3628", "봄", "galaxy", "세 은하를 한 프레임에 담는 구도입니다. NGC 3628의 희미한 외곽·조석 꼬리는 기본 시작 범위보다 훨씬 긴 총 노출이 필요할 수 있습니다.", "Leo Triplet", "레오 트리플렛", "햄버거 은하"),
  guide("markarian", "마카리안 체인", "M84 · M86 · NGC 4435 · NGC 4438 등", "봄", "galaxy", "개별 은하보다 은하들이 이어지는 전체 구도가 핵심입니다. 충분히 넓은 광대역 화각을 잡으세요.", "마르카리안", "Markarian", "처녀자리 은하단"),
  guide("sombrero", "솜브레로 은하", "M104 · NGC 4594", "봄", "galaxy", "밝은 팽대부와 어두운 먼지 띠가 함께 보이도록 노출을 조절하세요. 별이 둥근지 확인한 뒤 초점거리를 늘리세요.", "Sombrero"),
  guide("sunflower", "해바라기 은하", "M63 · NGC 5055", "봄", "galaxy", "촘촘한 나선 구조와 희미한 외곽을 함께 남기려면 광대역 총 노출을 늘리세요.", "Sunflower"),
  guide("blackeye", "검은눈 은하", "M64 · NGC 4826", "봄", "galaxy", "핵 주변의 먼지 띠가 포화된 중심부에 묻히지 않도록 한 장 노출을 확인하세요.", "검은 눈 은하", "Black Eye"),
  guide("needle", "바늘 은하", "NGC 4565", "봄", "galaxy", "얇은 측면과 먼지 띠에는 적절한 영상 스케일과 추적이 중요합니다. 광대역 LRGB가 기본입니다.", "Needle"),
  guide("whale", "고래 은하", "NGC 4631", "봄", "galaxy", "기본은 광대역입니다. 주변 은하를 함께 담을 수 있지만 각 대상의 크기와 구도를 먼저 확인하세요.", "Whale"),
  guide("m106", "M106 은하", "M106 · NGC 4258", "봄", "galaxy", "밝은 중심과 희미한 외곽의 차이가 큽니다. Hα는 특이한 가스 구조를 광대역에 보충할 때 선택하세요."),
  guide("owl", "올빼미 성운 · M108 은하", "M97 · NGC 3587 · M108", "봄", "planetary", "올빼미는 Hα·OⅢ, 함께 있는 M108은 광대역이 유리합니다. 두 대상을 함께 담으면 RGB 자료를 꼭 확보하세요.", "Owl", "Surfboard"),
  guide("lagoon", "석호 성운", "M8 · NGC 6523", "여름", "emission", "광대역·HOO·SHO 모두 쓰입니다. 밝은 중심부를 확인하고 한국에서는 낮은 고도의 대기·지형 영향을 살피세요.", "라군 성운", "Lagoon"),
  guide("trifid", "삼렬 성운", "M20 · NGC 6514", "여름", "emission", "붉은 방출성운과 푸른 반사성운이 함께 있어 RGB가 중요합니다. 협대역은 붉은 영역을 보충하는 용도로 쓰세요.", "삼열 성운", "Trifid"),
  guide("eagle", "독수리 성운", "M16 · IC 4703", "여름", "emission", "창조의 기둥 세부는 초점거리·시상의 영향을 받습니다. 전체 성운은 HOO·SHO로, 별 색은 RGB로 보완할 수 있습니다.", "Eagle", "창조의 기둥", "Pillars of Creation"),
  guide("omega", "오메가 · 백조 성운", "M17 · NGC 6618", "여름", "emission", "밝은 중심부의 포화를 확인하세요. HOO·SHO가 쓰이며 주변 가스까지 담으려면 구도를 넓히세요.", "Omega", "Swan"),
  guide("northamerica", "북아메리카 · 펠리컨 성운", "NGC 7000 · IC 5070", "여름", "emission", "두 영역 전체는 넓은 화각이 필요합니다. 백조자리 벽이나 펠리컨을 따로 촬영하는 구도도 가능합니다.", "North America", "Pelican", "북미 성운"),
  guide("westveil", "서쪽 베일 성운", "NGC 6960", "여름", "emission", "Hα·OⅢ 필라멘트가 특징입니다. 52 Cyg의 밝은 별 포화·고스트를 확인하세요.", "Western Veil", "마녀 빗자루", "Witch's Broom"),
  guide("eastveil", "동쪽 베일 성운", "NGC 6992 · NGC 6995", "여름", "emission", "HOO 또는 듀얼밴드로 필라멘트를 담을 수 있습니다. 베일 전체와 동쪽 부분 촬영은 필요한 화각이 다릅니다.", "Eastern Veil"),
  guide("crescent", "초승달 성운", "NGC 6888", "여름", "emission", "Hα·OⅢ 껍질과 주변 Hα 구름에 시간을 배분하세요. 주변 비누방울 성운까지 담으려면 훨씬 긴 총 노출을 고려하세요.", "Crescent"),
  guide("elephant", "코끼리코 성운", "IC 1396 · IC 1396A", "여름", "faintEmission", "IC 1396 전체와 코끼리코 부분은 구도를 따로 잡으세요. 협대역 구조를 담고 RGB로 별 색을 보완할 수 있습니다.", "Elephant's Trunk", "Elephant Trunk"),
  guide("dumbbell", "아령 성운", "M27 · NGC 6853", "여름", "planetary", "밝은 내부는 짧게, 희미한 외곽 껍질은 긴 총 노출로 나누세요. 외곽을 목표로 하면 기본 범위보다 시간이 더 필요합니다.", "덤벨 성운", "Dumbbell"),
  guide("ring", "고리 성운", "M57 · NGC 6720", "여름", "planetary", "작은 고리의 세부에는 초점거리·시상이 중요합니다. 밝은 내부와 희미한 외곽은 다른 노출로 나누어 담을 수 있습니다.", "링 성운", "Ring"),
  guide("hercules", "헤라클레스 구상성단", "M13 · NGC 6205", "여름", "cluster", "중심부 별이 뭉개지지 않게 짧은 노출부터 시작하세요. RGB 또는 LRGB로 별 색을 보존하세요.", "헤르쿨레스", "Hercules"),
  guide("wildduck", "야생오리 성단", "M11 · NGC 6705", "여름", "cluster", "밀집한 별과 주변 은하수 별을 함께 담습니다. 짧은 광대역 노출로 밝은 별의 포화를 줄이세요.", "Wild Duck"),
  guide("rho", "뱀주인자리 로 · 안타레스 주변", "Rho Ophiuchi · IC 4604 주변", "여름", "wide", "푸른 반사광·황색 성운·암흑 먼지를 함께 찍는 광시야 구도입니다. 어두운 하늘과 광대역을 우선하세요.", "로 오피유키", "Rho Ophiuchi", "Antares"),
  { ...guide("andromeda", "안드로메다 은하", "M31 · M32 · M110", "가을", "brightGalaxy", "넓은 화각을 확인하고 핵이 포화되면 10–30초 짧은 노출을 20–40장 보충하세요. 위성 은하도 함께 담을 수 있습니다.", "Andromeda", "망원경 없이 안드로메다"),
    lens: { focalLength: "135–300mm · 실제 초점거리", aperture: "f/2.8–5.6", iso: "ISO 800–3200", fixedSeconds: [.5, 2], trackedSeconds: [30, 120], fixedFrames: [300, 1000], trackedFrames: [60, 180], note: "망원경 없이 망원렌즈로 은하 전체를 촬영할 수 있습니다. 삼각대 고정 촬영은 짧은 노출을 많이 합성하고 자주 구도를 다시 잡으세요. 적도의를 쓰면 긴 노출로 외곽을 더 쉽게 확보합니다. 센서 크기에 따라 화각은 달라집니다." } },
  guide("triangulum", "삼각형자리 은하", "M33 · NGC 598", "가을", "galaxy", "나선팔의 표면 밝기가 낮습니다. 광대역 총 노출을 늘리고 Hα로 별 생성 영역을 선택적으로 보충하세요.", "삼각형 은하", "Triangulum"),
  guide("heart", "하트 성운", "IC 1805", "가을", "faintEmission", "전체 하트와 중심 Melotte 15 촬영은 화각이 다릅니다. HOO·SHO 모두 쓰이며 약한 채널에 시간을 더 배분하세요.", "Heart", "Melotte 15"),
  guide("soul", "소울 · 태아 성운", "IC 1848 · W5", "가을", "faintEmission", "넓은 성운 전체는 짧은 초점거리·모자이크가 필요할 수 있습니다. 하트 성운과 함께 담는 구도도 있습니다.", "Soul", "영혼 성운"),
  guide("pacman", "팩맨 성운", "NGC 281", "가을", "emission", "성운의 어두운 먼지 띠와 밝은 가스 대비를 살리세요. HOO·SHO와 RGB 별 색 보완이 쓰입니다.", "Pacman"),
  guide("bubble", "버블 성운", "NGC 7635", "가을", "faintEmission", "버블 세부와 주변 가스를 함께 담으세요. M52까지 포함하는 넓은 구도도 가능하며 약한 OⅢ·SⅡ를 충분히 확보하세요.", "Bubble", "거품 성운", "M52"),
  guide("wizard", "마법사 성운", "NGC 7380", "가을", "faintEmission", "협대역으로 성운 구조를 담고 별 색은 RGB로 보완할 수 있습니다. 별의 포화와 약한 채널 신호를 따로 확인하세요.", "Wizard"),
  guide("iris", "아이리스 성운", "NGC 7023", "가을", "reflection", "푸른 반사광과 갈색 먼지는 광대역으로 촬영하세요. 밝은 중심부와 희미한 먼지에 서로 다른 노출을 보충할 수 있습니다.", "Iris", "붓꽃 성운"),
  guide("cocoon", "고치 성운", "IC 5146 · B168", "가을", "reflection", "붉은 성운에는 Hα를 보충할 수 있지만 길게 이어지는 암흑성운에는 광대역·어두운 하늘이 중요합니다.", "Cocoon", "누에고치 성운", "Barnard 168"),
  guide("helix", "나선 성운", "NGC 7293", "가을", "planetary", "Hα·OⅢ와 광대역이 쓰입니다. 한국에서는 낮은 고도로 인한 지형·대기 영향을 확인하고 외곽에는 총 노출을 늘리세요.", "Helix", "신의 눈"),
  guide("double", "페르세우스 이중성단", "NGC 869 · NGC 884", "가을", "cluster", "두 성단이 함께 들어오도록 화각을 잡으세요. 밝은 별의 색을 살리기 위해 짧은 광대역 노출부터 시작하세요.", "Double Cluster", "C14", "이중 성단"),
  guide("stephan", "스테판 오중주 · NGC 7331", "HCG 92 · NGC 7331", "가을", "galaxy", "작은 은하군과 큰 NGC 7331을 함께 담는 구도입니다. 작은 은하의 세부는 추적·시상의 영향을 크게 받습니다.", "Stephan's Quintet", "Stephans Quintet", "스테판 5중주"),
  guide("pegasus", "페가수스 구상성단", "M15 · NGC 7078", "가을", "cluster", "밀집한 중심을 포화시키지 않도록 짧은 노출부터 확인하세요. 별 색에는 RGB 또는 LRGB를 사용하세요.", "Pegasus Cluster"),
  guide("carina", "용골자리 성운", "NGC 3372", "남쪽 하늘", "emission", "넓은 성운 전체와 밝은 중심부의 차이가 큽니다. 한국에서는 지평선 위로 올라오지 않으므로 남쪽 관측지를 선택하세요.", "Carina", "Eta Carinae"),
  guide("tarantula", "타란툴라 성운", "NGC 2070 · 30 Doradus", "남쪽 하늘", "emission", "대마젤란 은하 속 성운입니다. 성운 세부와 주변 별·은하를 함께 담으면 협대역에 광대역을 보충하세요. 한국에서는 뜨지 않습니다.", "Tarantula", "독거미 성운"),
  guide("omegaCentauri", "오메가 센타우리", "NGC 5139", "남쪽 하늘", "cluster", "매우 밝고 밀집한 성단입니다. 짧은 광대역 노출로 중심 포화를 줄이세요. 한국에서는 관측이 어렵거나 고도가 매우 낮습니다.", "Omega Centauri", "C80"),
  guide("tucanae", "47 Tucanae 구상성단", "NGC 104 · 47 Tuc", "남쪽 하늘", "cluster", "짧은 광대역 노출로 중심과 별 색을 남기세요. 한국에서는 지평선 위로 올라오지 않습니다.", "큰부리새자리 47", "C106"),
  guide("centaurus", "센타우루스 A", "NGC 5128 · Cen A", "남쪽 하늘", "galaxy", "밝은 팽대부와 검은 먼지 띠를 함께 담는 광대역 대상입니다. 한국에서는 고도가 매우 낮아 남쪽 관측지가 유리합니다.", "Centaurus A", "C77"),
  guide("sculptor", "조각가자리 은하", "NGC 253", "남쪽 하늘", "galaxy", "광대역으로 먼지 띠와 별 색을 담으세요. 한국에서도 뜨지만 낮은 고도의 지형·대기 영향을 확인하세요.", "Sculptor", "Silver Dollar", "C65"),
  guide("magellanic", "대·소마젤란 은하", "LMC · SMC", "남쪽 하늘", "wide", "매우 넓은 두 은하를 각각 광시야로 촬영합니다. 광대역을 기본으로 하고 내부 방출성운에는 Hα를 보충할 수 있습니다. 한국에서는 뜨지 않습니다.", "대마젤란", "소마젤란", "Magellanic Clouds"),
];

const MILKY_WAY: DeepSkyGuide = {
  ...guide("milkyway", "은하수", "Milky Way · 광시야", "여름", "wide", "은하 중심부의 고도·방향과 달빛을 확인하세요. 한국에서는 보통 봄 새벽부터 여름·가을 초저녁에 중심부를 촬영합니다. 하늘과 움직이지 않는 전경은 따로 촬영해 합성할 수 있습니다.", "은하수 중심", "Milky Way", "Galaxy landscape", "망원경 없이", "광각렌즈"),
  lensOnly: true,
  lens: { focalLength: "14–35mm · 실제 초점거리", aperture: "f/1.8–2.8부터 · 별 모양 확인", iso: "ISO 1600–6400", fixedSeconds: [5, 15], trackedSeconds: [30, 90], fixedFrames: [20, 60], trackedFrames: [20, 60], note: "카메라와 광각렌즈·삼각대로 시작할 수 있습니다. 고정 촬영의 노출 한계는 초점거리·픽셀 크기·하늘 방향에 따라 다릅니다. 별이 흐르면 더 짧게 촬영하세요. 추적한 하늘과 전경은 별도로 합성합니다." },
};

const PLANETS: readonly PlanetGuide[] = [
  { id: "mercury", name: "수성", catalog: "Mercury", aliases: ["행성", "수성 촬영"], season: "관측 시기 확인", kind: "planet", exposureMs: [1, 10], clipSeconds: [30, 90], filterNote: "컬러는 UV/IR 차단, 모노는 RGB. IR-pass는 흑백 명암을 보완하는 선택입니다.", note: "주로 위상 촬영 대상입니다. 낮은 고도와 밝은 박명 때문에 초점·시상 확보가 어렵습니다. 태양과 충분히 떨어진 때를 선택하고 광학계를 태양으로 향하지 마세요." },
  { id: "venus", name: "금성", catalog: "Venus", aliases: ["행성", "샛별"], season: "관측 시기 확인", kind: "planet", exposureMs: [1, 10], clipSeconds: [60, 180], filterNote: "가시광 RGB는 위상을 기록합니다. 구름 무늬는 UV 대역을 통과하는 필터·카메라·광학계가 별도로 필요하고 노출도 길어질 수 있습니다.", note: "밝은 원반의 포화를 먼저 막으세요. UV 무늬 촬영은 일반 RGB 세팅과 별도입니다. 태양에 가까운 대상이므로 태양과 충분히 떨어진 때를 선택하세요." },
  { id: "mars", name: "화성", catalog: "Mars", aliases: ["행성", "붉은 행성"], season: "관측 시기 확인", kind: "planet", exposureMs: [2, 10], clipSeconds: [60, 180], filterNote: "컬러는 UV/IR 차단, 모노는 RGB. IR-pass는 명암 보완용이며 자연색 RGB와 구분합니다.", note: "충 부근에서 원반이 커집니다. 극관·표면 무늬가 포화되지 않도록 확인하고, 낮은 고도의 색 번짐은 ADC와 고도 선택으로 줄일 수 있습니다." },
  { id: "jupiter", name: "목성", catalog: "Jupiter", aliases: ["행성", "대적점", "Jove"], season: "관측 시기 확인", kind: "planet", exposureMs: [3, 15], clipSeconds: [60, 120], filterNote: "컬러는 UV/IR 차단, 모노는 RGB. IR-pass는 흑백 세부 보완에 사용합니다. SHO는 일반 자연색 행성 촬영 방식이 아닙니다.", note: "빠른 자전 때문에 긴 영상을 한 번에 합치면 세부가 흐려질 수 있습니다. 짧은 클립을 여러 번 찍고, 모노 RGB도 전체 채널 촬영 시간을 짧게 유지하세요. 위성에는 원반과 별도의 밝은 노출이 필요할 수 있습니다." },
  { id: "saturn", name: "토성", catalog: "Saturn", aliases: ["행성", "토성 고리"], season: "관측 시기 확인", kind: "planet", exposureMs: [10, 30], clipSeconds: [120, 180], filterNote: "컬러는 UV/IR 차단, 모노는 RGB. IR-pass는 명암 보완용으로 선택합니다.", note: "목성보다 어두워 노출·Gain의 균형이 중요합니다. 고리가 원반보다 어두울 수 있으므로 함께 확인하세요. 장시간 클립은 자전·시상 변화 때문에 구간을 나눌 수 있습니다." },
  { id: "uranus", name: "천왕성", catalog: "Uranus", aliases: ["행성"], season: "관측 시기 확인", kind: "planet", exposureMs: [30, 100], clipSeconds: [120, 300], filterNote: "우선 광대역 RGB로 작은 원반과 색을 기록하세요. IR 무늬 촬영은 큰 구경·민감한 카메라·별도 노출이 필요합니다.", note: "밝기가 낮고 원반이 작습니다. 목성처럼 많은 표면 세부를 기대하기보다 정확한 위치 확인과 초점·추적을 우선하세요. 위성은 원반과 별도 장노출이 필요합니다." },
  { id: "neptune", name: "해왕성", catalog: "Neptune", aliases: ["행성"], season: "관측 시기 확인", kind: "planet", exposureMs: [50, 200], clipSeconds: [120, 300], filterNote: "우선 광대역 RGB로 원반과 색을 기록하세요. IR 관측은 별도 전문 촬영으로 구분합니다.", note: "매우 작고 어두운 원반입니다. 충분한 구경·정확한 초점·추적이 필요하고 주변 별과 구분해야 합니다. 위성 촬영은 원반 촬영과 별도로 진행하세요." },
];

export const IMAGING_GUIDES: readonly ImagingGuide[] = [...DEEP_SKY_GUIDES, MILKY_WAY, ...PLANETS];
export function imagingGuideLabel(item: ImagingGuide): string {
  return item.kind === "planet" ? "행성 · 동영상 합성" : item.lensOnly ? "은하수 · 카메라 렌즈" : IMAGING_PROFILES[item.profile].label;
}

export function normalizeImagingSearch(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
}

export function searchImagingGuides(query: string): readonly ImagingGuide[] {
  const key = normalizeImagingSearch(query);
  if (!key) return IMAGING_GUIDES;
  return IMAGING_GUIDES.filter(item => [item.name, item.catalog, item.season, imagingGuideLabel(item), ...item.aliases]
    .some(value => normalizeImagingSearch(value).includes(key)));
}

export function availableImagingRecipes(item: ImagingGuide, camera: ImagingCamera): readonly ImagingRecipe[] {
  if (item.kind === "planet") return ["RGB"];
  const narrow = IMAGING_PROFILES[item.profile].narrowSeconds !== null;
  if (camera !== "mono") return narrow ? ["RGB", "dual"] : ["RGB"];
  return narrow ? ["LRGB", "RGB", "HOO", "SHO", "HaRGB"] : ["LRGB", "RGB"];
}

export function defaultImagingRecipe(item: ImagingGuide, camera: ImagingCamera): ImagingRecipe {
  if (item.kind === "planet") return "RGB";
  return camera === "mono" ? IMAGING_PROFILES[item.profile].monoRecipe : "RGB";
}

export function imagingExposureRange(item: DeepSkyGuide, recipe: ImagingRecipe): Range {
  const profile = IMAGING_PROFILES[item.profile];
  return ["dual", "HOO", "SHO", "HaRGB"].includes(recipe) ? profile.narrowSeconds ?? profile.broadSeconds : profile.broadSeconds;
}

export function calculateLensFrames(seconds: number, count: number) {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600 || !Number.isInteger(count) || count < 1 || count > 10000) return null;
  return { count, minutes: seconds * count / 60 };
}

export function calculatePlanetFrames(exposureMs: number, fps: number, duration: number, percent: number) {
  if (![exposureMs, fps, duration, percent].every(Number.isFinite) || exposureMs < .1 || exposureMs > 1000 || fps < 1 || fps > 1000 || duration < 5 || duration > 600 || percent < 1 || percent > 100) return null;
  const effectiveFps = Math.min(fps, 1000 / exposureMs);
  const captured = Math.floor(effectiveFps * duration);
  return { captured, stacked: Math.floor(captured * percent / 100), effectiveFps };
}

const CHANNELS: Record<ImagingRecipe, readonly (readonly [string, number])[]> = {
  RGB: [["컬러", 1]], LRGB: [["L", .4], ["R", .2], ["G", .2], ["B", .2]],
  HaRGB: [["Hα", .4], ["R", .2], ["G", .2], ["B", .2]], dual: [["Hα/OⅢ 듀얼밴드", 1]],
  HOO: [["Hα", .5], ["OⅢ", .5]], SHO: [["SⅡ", 1 / 3], ["Hα", 1 / 3], ["OⅢ", 1 / 3]],
};

export function calculateImagingFrames(camera: ImagingCamera, recipe: ImagingRecipe, seconds: number, hours: number) {
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600 || !Number.isFinite(hours) || hours < .25 || hours > 100) return null;
  const channels = recipe === "RGB" && camera === "mono" ? [["R", 1 / 3], ["G", 1 / 3], ["B", 1 / 3]] as const : CHANNELS[recipe];
  const frames = channels.map(([channel, fraction]) => ({ channel, count: Math.ceil(hours * 3600 * fraction / seconds) }));
  const count = frames.reduce((sum, row) => sum + row.count, 0);
  return { frames, count, actualHours: count * seconds / 3600 };
}
