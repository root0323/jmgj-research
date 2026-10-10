// Curated common names. The Horsehead itself is Barnard 33; IC 434 is its
// bright background, used here to navigate to the surrounding photographic field.
const entries = [
  ["M 1", "게 성운", "게성운", "Crab Nebula"],
  ["M 8", "석호 성운", "라군 성운", "Lagoon Nebula"],
  ["M 13", "헤라클레스 구상성단", "헤르쿨레스 구상성단", "Hercules Cluster"],
  ["M 16", "독수리 성운", "Eagle Nebula"],
  ["M 17", "오메가 성운", "백조 성운", "Omega Nebula", "Swan Nebula"],
  ["M 20", "삼렬 성운", "삼열 성운", "Trifid Nebula"],
  ["M 27", "아령 성운", "덤벨 성운", "Dumbbell Nebula"],
  ["M 31", "안드로메다 은하", "안드로메다", "Andromeda Galaxy"],
  ["M 33", "삼각형자리 은하", "삼각형 은하", "Triangulum Galaxy"],
  ["M 42", "오리온 성운", "오리온 대성운", "Orion Nebula"],
  ["M 45", "플레이아데스 성단", "플레이아데스", "좀생이별", "Pleiades", "Seven Sisters"],
  ["M 51", "소용돌이 은하", "Whirlpool Galaxy"],
  ["M 57", "고리 성운", "링 성운", "Ring Nebula"],
  ["M 63", "해바라기 은하", "Sunflower Galaxy"],
  ["M 64", "검은눈 은하", "검은 눈 은하", "Black Eye Galaxy"],
  ["M 81", "보데 은하", "Bode's Galaxy"],
  ["M 82", "시가 은하", "시가형 은하", "Cigar Galaxy"],
  ["M 97", "올빼미 성운", "Owl Nebula"],
  ["M 101", "바람개비 은하", "Pinwheel Galaxy"],
  ["M 104", "솜브레로 은하", "Sombrero Galaxy"],
  ["IC 434", "말머리 성운 주변", "말머리 성운", "말머리", "Horsehead Nebula", "B33", "Barnard 33"],
] as const;

const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
export const DEEP_SKY_NAMES = entries.map(([id, name, ...aliases]) => ({ id, name, aliases,
  label: `${name} (${id.replace(/ /g, "")})` }));

export function namedDeepSky(term: string) {
  const key = compact(term);
  return DEEP_SKY_NAMES.find((item) => [item.id, item.name, item.label, ...item.aliases].some((alias) => compact(alias) === key));
}

export function matchingDeepSkyNames(term: string) {
  const key = compact(term);
  if (key.length < 2) return [];
  return DEEP_SKY_NAMES.filter((item) => [item.id, item.name, ...item.aliases].some((alias) => compact(alias).includes(key))).slice(0, 8);
}
