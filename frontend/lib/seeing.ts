import { CACHE_LIFETIME_MS, isObject, locationKey, validLocation, type WeatherLocation } from "./meteoblue";

export type SeeingSnapshot = {
  source: "7timer-astro";
  location: WeatherLocation;
  fetchedAt: string;
  issuedAt: string;
  points: Array<{ at: string; grade: number }>;
};

// 7Timer returns categories, not measured arcseconds. Keep their ranges intact.
export const SEEING_RANGES = [
  "< 0.5″", "0.5–0.75″", "0.75–1.0″", "1.0–1.25″",
  "1.25–1.5″", "1.5–2.0″", "2.0–2.5″", "> 2.5″",
] as const;

export function seeingCacheKey(location: WeatherLocation) {
  return `7timer:v1:${locationKey(location)}`;
}

export function parseSeeing(raw: unknown, location: WeatherLocation, now = new Date()): SeeingSnapshot {
  if (!validLocation(location) || !isObject(raw) || raw.product !== "astro" ||
    typeof raw.init !== "string" || !/^\d{10}$/.test(raw.init) || !Array.isArray(raw.dataseries)) {
    throw new Error("invalid seeing forecast");
  }
  const stamp = `${raw.init.slice(0, 4)}-${raw.init.slice(4, 6)}-${raw.init.slice(6, 8)}T${raw.init.slice(8, 10)}:00:00.000Z`;
  const init = Date.parse(stamp);
  if (!Number.isFinite(init) || new Date(init).toISOString() !== stamp) throw new Error("invalid forecast date");
  const points = raw.dataseries.flatMap((point) => {
    if (!isObject(point) || typeof point.timepoint !== "number" || !Number.isInteger(point.timepoint) ||
      point.timepoint < 3 || point.timepoint > 72 || point.timepoint % 3 !== 0 ||
      typeof point.seeing !== "number" || !Number.isInteger(point.seeing) || point.seeing < 1 || point.seeing > 8) return [];
    return [{ at: new Date(init + point.timepoint * 3_600_000).toISOString(), grade: point.seeing }];
  }).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!points.length) throw new Error("missing seeing forecast");
  return { source: "7timer-astro", location, fetchedAt: now.toISOString(), issuedAt: stamp, points };
}

export function validSeeing(value: unknown): value is SeeingSnapshot {
  return isObject(value) && value.source === "7timer-astro" && validLocation(value.location) &&
    typeof value.fetchedAt === "string" && Number.isFinite(Date.parse(value.fetchedAt)) &&
    typeof value.issuedAt === "string" && Number.isFinite(Date.parse(value.issuedAt)) &&
    Array.isArray(value.points) && value.points.length > 0 && value.points.every((point) => isObject(point) &&
      typeof point.at === "string" && Number.isFinite(Date.parse(point.at)) &&
      typeof point.grade === "number" && Number.isInteger(point.grade) && point.grade >= 1 && point.grade <= 8);
}

export function seeingFresh(snapshot: SeeingSnapshot, now = Date.now()) {
  const age = now - Date.parse(snapshot.fetchedAt);
  return age >= 0 && age < CACHE_LIFETIME_MS;
}

export function seeingAt(snapshot: SeeingSnapshot | null, time: Date) {
  if (!snapshot || !validSeeing(snapshot)) return null;
  const points = [...snapshot.points].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const timestamp = time.getTime();
  if (!Number.isFinite(timestamp) || timestamp < Date.parse(points[0].at) || timestamp > Date.parse(points.at(-1)!.at)) return null;
  const closest = points.reduce((best, point) => Math.abs(Date.parse(point.at) - timestamp) < Math.abs(Date.parse(best.at) - timestamp) ? point : best);
  // A missing slot must not be filled by a remote time or interpolated category.
  if (Math.abs(Date.parse(closest.at) - timestamp) > 90 * 60_000) return null;
  return { ...closest, label: SEEING_RANGES[closest.grade - 1] };
}
