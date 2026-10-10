import { describe, expect, it } from "vitest";
import { parseSeeing, seeingAt, seeingCacheKey, seeingFresh, seeingTimeSlot, SEEING_CACHE_LIFETIME_MS, SEEING_RANGES } from "./seeing";

const location = { latitude: 33.425814, longitude: 126.5308195 };
const fixture = () => parseSeeing({ product: "astro", init: "2026100606", dataseries: [
  { timepoint: 3, seeing: 1 }, { timepoint: 6, seeing: 8 }, { timepoint: 9, seeing: 4 },
] }, location, new Date("2026-10-06T08:00:00Z"));

describe("7Timer seeing categories", () => {
  it("interprets the model run and offsets in UTC, without inventing arcseconds", () => {
    const snapshot = fixture();
    expect(snapshot.issuedAt).toBe("2026-10-06T06:00:00.000Z");
    expect(seeingAt(snapshot, new Date("2026-10-06T18:00:00+09:00"))).toMatchObject({ grade: 1, label: "< 0.5″" });
    expect(seeingAt(snapshot, new Date("2026-10-06T21:00:00+09:00"))).toMatchObject({ grade: 8, label: "> 2.5″" });
    expect(SEEING_RANGES).toHaveLength(8);
  });
  it("uses the closest three-hour slot without interpolating categories", () => {
    expect(seeingAt(fixture(), new Date("2026-10-06T10:00:00Z"))).toMatchObject({ grade: 1, at: "2026-10-06T09:00:00.000Z" });
    expect(seeingAt(fixture(), new Date("2026-10-06T11:00:00Z"))).toMatchObject({ grade: 8 });
  });
  it("does not borrow forecasts outside their horizon or across missing slots", () => {
    const snapshot = fixture();
    expect(seeingAt(snapshot, new Date("2026-10-06T08:59:59Z"))).toBeNull();
    expect(seeingAt(snapshot, new Date("2026-10-06T15:00:01Z"))).toBeNull();
    snapshot.points.splice(1, 1);
    expect(seeingAt(snapshot, new Date("2026-10-06T12:00:00Z"))).toBeNull();
    expect(seeingAt(snapshot, new Date("2026-10-06T13:30:00Z"))).toBeNull();
    expect(seeingAt(snapshot, new Date("2026-10-06T13:30:00.001Z"))).toMatchObject({ at: "2026-10-06T15:00:00.000Z" });
  });
  it("rejects malformed dates, non-ASTRO results and unsupported grades", () => {
    expect(() => parseSeeing({ product: "astro", init: "2026023006", dataseries: [] }, location)).toThrow();
    expect(() => parseSeeing({ product: "civil", init: "2026100606", dataseries: [{ timepoint: 3, seeing: 1 }] }, location)).toThrow();
    expect(() => parseSeeing({ product: "astro", init: "2026100606", dataseries: [{ timepoint: 3, seeing: 0 }] }, location)).toThrow();
  });
  it("expires saved data after three hours and rejects future cache timestamps", () => {
    const snapshot = fixture();
    const start = Date.parse(snapshot.fetchedAt);
    expect(seeingFresh(snapshot, start + SEEING_CACHE_LIFETIME_MS - 1)).toBe(true);
    expect(seeingFresh(snapshot, start + SEEING_CACHE_LIFETIME_MS)).toBe(false);
    expect(seeingFresh(snapshot, start - 1)).toBe(false);
  });
  it("uses the same cache within a forecast slot and changes at the midpoint or location", () => {
    const time = new Date("2026-10-06T21:00:00+09:00");
    expect(seeingTimeSlot(time)).toBe("2026-10-06T12:00:00.000Z");
    expect(seeingCacheKey(location, new Date("2026-10-06T22:30:00+09:00"))).toBe(seeingCacheKey(location, time));
    expect(seeingCacheKey(location, new Date("2026-10-06T22:30:00.001+09:00"))).not.toBe(seeingCacheKey(location, time));
    expect(seeingCacheKey({ ...location, latitude: 37 }, time)).not.toBe(seeingCacheKey(location, time));
    expect(seeingTimeSlot(new Date("invalid"))).toBeNull();
  });
  it("keeps the same slot across a local midnight and follows the actual minutes", () => {
    expect(seeingTimeSlot(new Date("2026-10-06T23:45:00+09:00"))).toBe(seeingTimeSlot(new Date("2026-10-07T00:15:00+09:00")));
    expect(seeingTimeSlot(new Date("2026-10-06T22:31:00+09:00"))).toBe("2026-10-06T15:00:00.000Z");
  });
  it("maps the checked Seoul UTC response to its Korean forecast time and official range", () => {
    const snapshot = parseSeeing({ product: "astro", init: "2026100606", dataseries: [
      { timepoint: 3, seeing: 3 }, { timepoint: 6, seeing: 4 }, { timepoint: 9, seeing: 5 },
    ] }, { latitude: 37.5665, longitude: 126.978 });
    expect(seeingAt(snapshot, new Date("2026-10-06T22:00:00+09:00"))).toMatchObject({
      at: "2026-10-06T12:00:00.000Z", grade: 4, label: "1.0–1.25″",
    });
    expect(seeingAt(snapshot, new Date("2026-10-06T23:00:00+09:00"))).toMatchObject({
      at: "2026-10-06T15:00:00.000Z", grade: 5, label: "1.25–1.5″",
    });
  });
});
