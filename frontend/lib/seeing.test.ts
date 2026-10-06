import { describe, expect, it } from "vitest";
import { parseSeeing, seeingAt, seeingFresh, SEEING_RANGES } from "./seeing";

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
  });
  it("rejects malformed dates, non-ASTRO results and unsupported grades", () => {
    expect(() => parseSeeing({ product: "astro", init: "2026023006", dataseries: [] }, location)).toThrow();
    expect(() => parseSeeing({ product: "civil", init: "2026100606", dataseries: [{ timepoint: 3, seeing: 1 }] }, location)).toThrow();
    expect(() => parseSeeing({ product: "astro", init: "2026100606", dataseries: [{ timepoint: 3, seeing: 0 }] }, location)).toThrow();
  });
  it("expires saved data after 24 hours and rejects future cache timestamps", () => {
    const snapshot = fixture();
    const start = Date.parse(snapshot.fetchedAt);
    expect(seeingFresh(snapshot, start + 86_399_999)).toBe(true);
    expect(seeingFresh(snapshot, start + 86_400_000)).toBe(false);
    expect(seeingFresh(snapshot, start - 1)).toBe(false);
  });
});
