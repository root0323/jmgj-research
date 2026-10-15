/** Prices are per package, not per HTTP request. Actual response headers take priority. */
export const WEATHER_PLANS = {
  research: {
    label: "연구 당시 구성 · 시상 포함",
    packages: ["seeing-1h", "airquality-1h", "ensemble-1h", "air-1h"],
    credits: 40_000,
  },
  free3h: {
    label: "무료 3시간 구성 · 시상 없음",
    packages: ["airquality-3h", "clouds-3h", "air-3h"],
    credits: 24_000,
  },
} as const;

export type WeatherPlan = keyof typeof WEATHER_PLANS;
export type JsonObject = Record<string, unknown>;
export type WeatherLocation = { latitude: number; longitude: number };
export type PackageResult = {
  package: string;
  data: JsonObject | null;
  credits: number;
  creditSource: "header" | "estimate" | "unknown";
  error: string | null;
};
export type WeatherSnapshot = {
  id: string;
  plan: WeatherPlan;
  location: WeatherLocation;
  fetchedAt: string;
  results: PackageResult[];
};

export const CACHE_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_CREDIT_BUDGET = 10_000_000;

export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validLocation(value: unknown): value is WeatherLocation {
  return isObject(value) && typeof value.latitude === "number" &&
    Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 &&
    typeof value.longitude === "number" && Number.isFinite(value.longitude) &&
    Math.abs(value.longitude) <= 180;
}

export function validKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,256}$/.test(value);
}

export function validPlan(value: unknown): value is WeatherPlan {
  return value === "research" || value === "free3h";
}

export function locationKey(location: WeatherLocation) {
  return `${location.latitude.toFixed(6)},${location.longitude.toFixed(6)}`;
}

export function cacheKey(fingerprint: string, plan: WeatherPlan, location: WeatherLocation) {
  return `v1:${fingerprint}:${plan}:${locationKey(location)}`;
}

export function isFresh(snapshot: WeatherSnapshot, now = Date.now()) {
  const age = now - Date.parse(snapshot.fetchedAt);
  return Number.isFinite(age) && age >= 0 && age < CACHE_LIFETIME_MS;
}

export function accountedCredits(results: PackageResult[]) {
  return results.reduce((sum, result) => sum + result.credits, 0);
}

export type CreditEntry = { id: string; at: string; credits: number; estimated: boolean; uncertain: boolean };
export type CreditLedger = {
  budget: number;
  activationDate: string;
  usedBeforeApp: number;
  entries: CreditEntry[];
  history: { credits: number; through: string } | null;
};

export function newLedger(): CreditLedger {
  return { budget: DEFAULT_CREDIT_BUDGET, activationDate: new Date().toISOString().slice(0, 10), usedBeforeApp: 0, entries: [], history: null };
}

export function recordSnapshot(ledger: CreditLedger, snapshot: WeatherSnapshot): CreditLedger {
  if (ledger.entries.some((entry) => entry.id === snapshot.id)) return ledger;
  return { ...ledger, entries: [...ledger.entries, {
    id: snapshot.id,
    at: snapshot.fetchedAt,
    credits: accountedCredits(snapshot.results),
    estimated: snapshot.results.some((result) => result.creditSource === "estimate"),
    uncertain: snapshot.results.some((result) => result.creditSource === "unknown"),
  }] };
}

export function usageSummary(ledger: CreditLedger, plan: WeatherPlan) {
  const entries = ledger.history
    ? ledger.entries.filter((entry) => entry.at.slice(0, 10) > ledger.history!.through)
    : ledger.entries;
  const used = (ledger.history?.credits ?? ledger.usedBeforeApp) + entries.reduce((sum, entry) => sum + entry.credits, 0);
  const remaining = Math.max(0, ledger.budget - used);
  const cost = WEATHER_PLANS[plan].credits;
  return {
    used, remaining,
    totalLoads: Math.floor(ledger.budget / cost),
    remainingLoads: Math.floor(remaining / cost),
    estimated: entries.some((entry) => entry.estimated),
    uncertain: entries.some((entry) => entry.uncertain),
  };
}

export function modelResponses(snapshot: WeatherSnapshot): JsonObject {
  const data = new Map(snapshot.results.filter((result) => result.data).map((result) => [result.package, result.data]));
  return {
    p1: data.get("seeing-1h") ?? {},
    p2: data.get("airquality-1h") ?? data.get("airquality-3h") ?? {},
    p3: data.get("ensemble-1h") ?? data.get("clouds-3h") ?? {},
    p4: data.get("air-1h") ?? data.get("air-3h") ?? {},
  };
}
