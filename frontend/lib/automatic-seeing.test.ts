import { describe, expect, it, vi } from "vitest";
import { createSeeingLoader } from "./automatic-seeing";
import { parseSeeing, seeingAt, seeingCacheKey, SEEING_CACHE_LIFETIME_MS, type SeeingSnapshot } from "./seeing";
import type { WeatherLocation } from "./meteoblue";

const location = { latitude: 33.425814, longitude: 126.5308195 };
const time = new Date("2026-10-06T09:00:00Z");
const raw = { product: "astro", init: "2026100606", dataseries: [
  { timepoint: 3, seeing: 1 }, { timepoint: 6, seeing: 8 }, { timepoint: 9, seeing: 4 },
] };

function setup() {
  let now = Date.parse("2026-10-06T08:00:00Z");
  const saved = new Map<string, SeeingSnapshot>();
  const read = vi.fn(async (key: string) => saved.get(key) ?? null);
  const save = vi.fn(async (key: string, snapshot: SeeingSnapshot) => { saved.set(key, snapshot); return true; });
  const request = vi.fn(async (target: WeatherLocation): Promise<unknown> => parseSeeing(raw, target, new Date(now)));
  const load = createSeeingLoader({ read, save, request, now: () => now });
  return { load, saved, read, save, request, advance: (ms: number) => { now += ms; } };
}

describe("automatic seeing cache", () => {
  it("saves a first request, then reuses the same place and forecast slot", async () => {
    const app = setup();
    const first = await app.load(location, time);
    expect(app.save).toHaveBeenCalledWith(seeingCacheKey(location, time), first.snapshot);
    const next = await app.load(location, new Date("2026-10-06T10:15:00Z"));
    expect(next.snapshot).toEqual(first.snapshot);
    expect(app.request).toHaveBeenCalledTimes(1);
  });
  it("loads another slot and place separately, and reuses a previously visited slot", async () => {
    const app = setup();
    await app.load(location, time);
    await app.load(location, new Date("2026-10-06T12:00:00Z"));
    await app.load({ ...location, latitude: 37 }, time);
    await app.load(location, time);
    expect(app.request).toHaveBeenCalledTimes(3);
    expect(app.saved.size).toBe(3);
  });
  it("reloads an expired slot even if the location and selected time are unchanged", async () => {
    const app = setup();
    const first = await app.load(location, time);
    app.advance(SEEING_CACHE_LIFETIME_MS);
    const updated = await app.load(location, time);
    expect(app.request).toHaveBeenCalledTimes(2);
    expect(updated.snapshot.fetchedAt).not.toBe(first.snapshot.fetchedAt);
  });
  it("coalesces simultaneous requests for the same slot", async () => {
    const app = setup();
    const results = await Promise.all([app.load(location, time), app.load(location, time)]);
    expect(app.request).toHaveBeenCalledTimes(1);
    expect(app.save).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual(results[1]);
  });
  it("keeps late responses in their own place/slot instead of overwriting a new selection", async () => {
    const app = setup();
    let finish!: (value: unknown) => void;
    app.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const old = app.load(location, time);
    await Promise.resolve();
    const target = { ...location, latitude: 37 };
    const current = await app.load(target, time);
    finish(parseSeeing(raw, location, new Date("2026-10-06T08:00:00Z")));
    await old;
    expect(app.saved.get(seeingCacheKey(target, time))).toEqual(current.snapshot);
    expect(current.snapshot.location).toEqual(target);
  });
  it("does not poll repeatedly or borrow data for times beyond the forecast horizon", async () => {
    const app = setup();
    const outside = new Date("2026-11-06T09:00:00Z");
    const result = await app.load(location, outside);
    expect(seeingAt(result.snapshot, outside)).toBeNull();
    await app.load(location, outside);
    expect(app.request).toHaveBeenCalledTimes(1);
  });
  it("retries after a failure while preserving the existing saved forecast", async () => {
    const app = setup();
    const first = await app.load(location, time);
    app.advance(SEEING_CACHE_LIFETIME_MS);
    app.request.mockRejectedValueOnce(new Error("offline"));
    await expect(app.load(location, time)).rejects.toThrow("offline");
    expect(app.saved.get(seeingCacheKey(location, time))).toEqual(first.snapshot);
    await app.load(location, time);
    expect(app.request).toHaveBeenCalledTimes(3);
  });
  it("rejects invalid responses and a response for a different location without saving", async () => {
    const app = setup();
    app.request.mockResolvedValueOnce({ error: "unavailable" });
    await expect(app.load(location, time)).rejects.toThrow();
    app.request.mockResolvedValueOnce(parseSeeing(raw, { ...location, latitude: 37 }));
    await expect(app.load(location, time)).rejects.toThrow();
    expect(app.save).not.toHaveBeenCalled();
  });
  it("still returns usable data when persistent browser storage is unavailable", async () => {
    const app = setup();
    app.save.mockImplementation(async (key, snapshot) => { app.saved.set(key, snapshot); return false; });
    const result = await app.load(location, time);
    expect(result.persisted).toBe(false);
    expect(seeingAt(result.snapshot, time)?.label).toBe("< 0.5″");
    expect((await app.load(location, time)).persisted).toBe(false);
    expect(app.request).toHaveBeenCalledTimes(1);
  });
});
