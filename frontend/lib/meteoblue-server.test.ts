import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWeather, fetchAccountHistory } from "./meteoblue-server";

const key = "TEST_ONLY_NOT_A_REAL_KEY";
const location = { latitude: 37.5665, longitude: 126.978 };
afterEach(() => vi.unstubAllGlobals());

describe("Meteoblue manual request proxy", () => {
  it("uses the supplied key, one selected location, and actual accounted credits", async () => {
    const fetch = vi.fn().mockImplementation(async (url: URL) => {
      expect(url.origin).toBe("https://my.meteoblue.com");
      expect(url.searchParams.get("apikey")).toBe(key);
      expect(url.searchParams.get("lat")).toBe(String(location.latitude));
      expect(url.searchParams.get("tz")).toBe("Asia/Seoul");
      return new Response(JSON.stringify({ data_1h: { time: ["2026-10-05 19:00"], seeing_arcsec: [1.5] }, metadata: { apikey: key, url: `?apikey=${key}`, modelrun: "2026-10-05 06:00" } }),
        { status: 200, headers: { "MB-Credits-Accounted": "7777" } });
    });
    vi.stubGlobal("fetch", fetch);
    const result = await fetchWeather(key, location, "research");
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(result.results.every((result) => result.credits === 7777 && result.creditSource === "header")).toBe(true);
    expect(JSON.stringify(result)).not.toContain(key);
    expect(JSON.stringify(result)).toContain("modelrun");
  });
  it("records partial successes, charged errors, and missing-header estimates", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: URL) => {
      if (url.pathname.endsWith("seeing-1h")) return new Response(key, { status: 403, headers: { "MB-Credits-Accounted": "20" } });
      return new Response(JSON.stringify({ data_1h: { time: ["2026-10-05 19:00"] } }));
    }));
    const result = await fetchWeather(key, location, "research");
    expect(result.results[0]).toMatchObject({ data: null, credits: 20, creditSource: "header" });
    expect(result.results[2]).toMatchObject({ credits: 16000, creditSource: "estimate" });
    expect(JSON.stringify(result)).not.toContain(key);
  });
  it("never leaks key-bearing exceptions and marks uncertain billing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(`Network failure https://example.com?apikey=${key}`)));
    const result = await fetchWeather(key, location, "free3h");
    expect(result.results).toHaveLength(3);
    expect(result.results.every((result) => result.creditSource === "unknown")).toBe(true);
    expect(JSON.stringify(result)).not.toContain(key);
  });
});

describe("account history synchronization", () => {
  it("aggregates every page before returning a usable total", async () => {
    const fetch = vi.fn().mockImplementation(async (url: URL) => {
      expect(url.pathname).toBe("/account/usage");
      expect(url.searchParams.get("date_end")).toBe("2026-10-04");
      const page = Number(url.searchParams.get("page"));
      return new Response(JSON.stringify({ items: [{ request_credits: page * 40000 }], metadata: { total: 2 } }));
    });
    vi.stubGlobal("fetch", fetch);
    expect(await fetchAccountHistory(key, "2026-09-01", "2026-10-04")).toEqual({ credits: 120000, through: "2026-10-04" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not treat an incomplete account history as the account balance", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], metadata: { total: 2 } })));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchAccountHistory(key, "2026-09-01", "2026-10-04")).rejects.toThrow("불완전");
  });
});
