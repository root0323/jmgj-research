import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cacheKey, isFresh, newLedger, recordSnapshot, usageSummary, validKey, validLocation,
  type CreditLedger, type WeatherSnapshot,
} from "./meteoblue";
import { weatherAt, evaluateWeather } from "./weather-evaluation";
import { readLedger, saveLedger } from "./weather-storage";

const location = { latitude: 37.5665, longitude: 126.978 };
const snapshot: WeatherSnapshot = {
  id: "one", plan: "research", location, fetchedAt: "2026-10-05T10:00:00Z",
  results: ["seeing-1h", "airquality-1h", "ensemble-1h", "air-1h"].map((name) => ({
    package: name, data: {}, credits: name === "ensemble-1h" ? 16000 : 8000,
    creditSource: "header", error: null,
  })),
};

afterEach(() => vi.unstubAllGlobals());

describe("credit accounting", () => {
  it("shows 249/250 for one original refresh and does not debit the same response twice", () => {
    const once = recordSnapshot(newLedger(), snapshot);
    const twice = recordSnapshot(once, snapshot);
    expect(usageSummary(twice, "research")).toMatchObject({ used: 40000, remaining: 9960000, remainingLoads: 249, totalLoads: 250 });
    expect(twice).toBe(once);
  });
  it("charges partial successes and billed errors instead of subtracting one click", () => {
    const partial = { ...snapshot, results: snapshot.results.map((result, i) => i === 0
      ? { ...result, credits: 0, data: null, creditSource: "unknown" as const, error: "forbidden" } : result) };
    expect(usageSummary(recordSnapshot(newLedger(), partial), "research")).toMatchObject({ used: 32000, uncertain: true, remainingLoads: 249 });
    const billed = { ...partial, results: [{ ...partial.results[0], credits: 1234, creditSource: "header" as const }] };
    expect(usageSummary(recordSnapshot(newLedger(), billed), "research").used).toBe(1234);
  });
  it("replaces past local history with account history without double counting today", () => {
    const ledger: CreditLedger = { ...newLedger(), history: { credits: 80000, through: "2026-10-04" }, entries: [
      { id: "old", at: "2026-10-04T23:59:00Z", credits: 40000, estimated: false, uncertain: false },
      { id: "today", at: "2026-10-05T00:00:00Z", credits: 40000, estimated: false, uncertain: false },
    ] };
    expect(usageSummary(ledger, "research").used).toBe(120000);
    expect(usageSummary({ ...ledger, budget: 1 }, "free3h").remainingLoads).toBe(0);
  });
});

describe("cache isolation and persistence", () => {
  it("separates keys, locations, and package plans and expires at exactly 24 hours", () => {
    const key = cacheKey("account-a", "research", location);
    expect(key).not.toBe(cacheKey("account-b", "research", location));
    expect(key).not.toBe(cacheKey("account-a", "free3h", location));
    expect(key).not.toBe(cacheKey("account-a", "research", { ...location, latitude: location.latitude + .00001 }));
    const time = Date.parse(snapshot.fetchedAt);
    expect(isFresh(snapshot, time + 86400000 - 1)).toBe(true);
    expect(isFresh(snapshot, time + 86400000)).toBe(false);
    expect(isFresh(snapshot, time - 1)).toBe(false);
  });
  it("persists a ledger by key fingerprint and rejects malformed saved balances", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    const ledger = recordSnapshot(newLedger(), snapshot);
    expect(saveLedger("a", ledger)).toBe(true);
    expect(readLedger("a").entries).toHaveLength(1);
    expect(readLedger("b").entries).toHaveLength(0);
    storage.set("jmgj-weather-credits-v1:a", '{"budget": -10}');
    expect(readLedger("a").budget).toBe(10000000);
  });
  it("handles unavailable browser storage without crashing", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); } });
    const ledger = recordSnapshot(newLedger(), snapshot);
    expect(saveLedger("blocked-storage", ledger)).toBe(false);
    expect(readLedger("blocked-storage").entries).toHaveLength(1);
  });
});

describe("saved forecast evaluation", () => {
  const forecast = { ...snapshot, results: [
    { ...snapshot.results[0], data: { data_1h: { time: ["2026-10-05 19:00", "2026-10-05 20:00"], seeing_arcsec: [1, 3] } } },
    { ...snapshot.results[1], data: { data_3h: { time: ["2026-10-05 18:00", "2026-10-05 21:00"], aod550: [0, 0] } } },
    { ...snapshot.results[2], data: { gfsensemble_1h: { time: ["2026-10-05 19:00", "2026-10-05 20:00"], totalcloudcover: [[0, 20], [20, 40]] } } },
  ] };
  it("interpolates three-hour data, zero AOD, and ensemble members in Korean time", () => {
    expect(weatherAt(forecast, new Date("2026-10-05T10:30:00Z"))).toMatchObject({ seeingArcsec: 2, aod: 0, cloudCover: 20 });
  });
  it("leaves out-of-range forecasts unavailable and makes no external weather call", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const result = await evaluateWeather(forecast, new Date("2026-10-06T10:00:00Z"), null, new AbortController().signal);
    expect(result.seeingArcsec).toBe(null);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sends saved data only to the local evaluation route", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sqm: 19, source: "black-marble-dem" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const result = await evaluateWeather(forecast, new Date("2026-10-05T10:30:00Z"), { altitude: 45, azimuth: 180 }, new AbortController().signal);
    expect(fetch.mock.calls[0][0]).toBe("/api/research/evaluate");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty("apiKey");
    expect(result.sqm).toBe(19);
  });
});

it("validates coordinates and accepts keys rather than URLs or credentials", () => {
  expect(validLocation({ latitude: NaN, longitude: 0 })).toBe(false);
  expect(validLocation({ latitude: 91, longitude: 0 })).toBe(false);
  expect(validKey("https://example.com/key")).toBe(false);
  expect(validKey("name@example.com")).toBe(false);
});
