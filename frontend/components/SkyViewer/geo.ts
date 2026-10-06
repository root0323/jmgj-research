import type { GeocodeResult, ObserverLocation } from "./types";

const CACHE_MS = 10 * 60_000;
const places = new Map<string, { at: number; value: GeocodeResult[] }>();
const suggestions = new Map<string, { at: number; value: GeocodeResult[] }>();
const addresses = new Map<string, { at: number; value: string }>();

async function request(path: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(30_000);
  const response = await fetch(`/api/location/${path}`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw new Error("장소 검색 서버에 연결하지 못했습니다. 잠시 후 다시 시도하거나 지도·좌표로 선택하세요.");
  return response.json();
}

function parsePlaces(results: unknown, query: string): GeocodeResult[] {
  if (!Array.isArray(results)) throw new Error("장소 검색 응답을 확인하지 못했습니다.");
  const seen = new Set<string>();
  return results.filter((item) => item && item.lat != null && item.lon != null &&
    Number.isFinite(Number(item.lat)) && Math.abs(Number(item.lat)) <= 90 &&
    Number.isFinite(Number(item.lon)) && Math.abs(Number(item.lon)) <= 180)
    .map((item) => ({ latitude: Number(item.lat), longitude: Number(item.lon), name: item.display_name ?? item.name ?? query }))
    .filter((item) => {
      const key = `${item.latitude.toFixed(5)},${item.longitude.toFixed(5)}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
}

export function completePlaceQuery(query: string): string | null {
  const term = query.trim();
  if (!/[가-힣]/.test(term) || /학교$/.test(term)) return null;
  for (const [short, full] of [["초", "초등학교"], ["중", "중학교"], ["고", "고등학교"]]) {
    if (term.endsWith(short) && term.length > short.length) return term.slice(0, -short.length) + full;
  }
  return null;
}

export async function geocodeLocations(query: string): Promise<GeocodeResult[]> {
  const key = query.trim().toLowerCase();
  const cached = places.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = parsePlaces(await request(`search?query=${encodeURIComponent(query.trim())}`), query);
  // Only a successful response can establish that a place was not found.
  places.set(key, { at: Date.now(), value });
  return value;
}

export async function geocodeLocation(query: string): Promise<GeocodeResult | null> {
  return (await geocodeLocations(query))[0] ?? null;
}

export async function suggestLocations(query: string, signal: AbortSignal): Promise<GeocodeResult[]> {
  const key = query.trim().toLowerCase();
  const cached = suggestions.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = parsePlaces(await request(`suggest?query=${encodeURIComponent(query.trim())}`, signal), query);
  suggestions.set(key, { at: Date.now(), value });
  return value;
}

export async function reverseGeocodeLocation(location: ObserverLocation): Promise<string | null> {
  const key = `${location.latitude.toFixed(5)},${location.longitude.toFixed(5)}`;
  const cached = addresses.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  try {
    const result = await request(`reverse?${new URLSearchParams({ lat: String(location.latitude), lon: String(location.longitude) })}`);
    const value = result.display_name ?? result.name;
    if (typeof value === "string" && value) { addresses.set(key, { at: Date.now(), value }); return value; }
  } catch { /* Coordinates remain usable when address lookup is unavailable. */ }
  return null;
}
