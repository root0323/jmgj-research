import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { annualSampleDates, observedTargetVector, projectViewVector, sampleAnnualTrajectory, trajectoryCacheKey, trajectorySvgPath } from "./annualTrajectory";
import { patchWasmMemoryHelpers } from "./engineControls";
import type { SelectedTarget, StellariumEngine, SweObj } from "./types";

describe("same-clock annual sampling", () => {
  it("includes leap day and the next January 1 at the selected civil clock", () => {
    const anchor = new Date(2028, 9, 19, 20, 31, 42, 123);
    const dates = annualSampleDates(anchor);
    expect(dates).toHaveLength(367);
    expect(dates.some(date => date.getMonth() === 1 && date.getDate() === 29)).toBe(true);
    expect(dates.every(date => date.getHours() === 20 && date.getMinutes() === 31 && date.getSeconds() === 42)).toBe(true);
    expect(dates.at(-1)!.getFullYear()).toBe(2029);
    expect(anchor.getMonth()).toBe(9);
    expect(annualSampleDates(new Date("invalid"))).toEqual([]);
  });

  it("reuses the annual curve for a new date at the same clock, but not another clock/place/selection", () => {
    const observer: SweObj = { v: 1, latitude: .6, longitude: 2 };
    const target: SelectedTarget = { obj: { v: 2 }, label: "태양" };
    const start = new Date(2026, 2, 1, 12, 0, 0);
    const key = trajectoryCacheKey(target, start, observer);
    expect(trajectoryCacheKey(target, new Date(2026, 8, 1, 12), observer)).toBe(key);
    expect(trajectoryCacheKey(target, new Date(2026, 8, 1, 13), observer)).not.toBe(key);
    expect(trajectoryCacheKey(target, start, { ...observer, latitude: -.6 })).not.toBe(key);
    expect(trajectoryCacheKey({ ...target, obj: { v: 3 } }, start, observer)).not.toBe(key);
  });

  it("keeps the distance flag when converting nearby objects", () => {
    const convertFrame = vi.fn(() => [1, 2, 3, 0]);
    const vector = observedTargetVector({ convertFrame }, { obj: { v: 1, getInfo: () => [1, 2, 3, 1] }, label: "달" }, { v: 2 });
    expect(convertFrame.mock.calls[0]).toEqual([{ v: 2 }, "ICRF", "OBSERVED", [1, 2, 3, 1]]);
    expect(Math.hypot(...vector!)).toBeCloseTo(1);
  });

  it("releases a cancelled calculation's cloned observer", async () => {
    const destroy = vi.fn();
    const observer = { v: 3, destroy };
    const controller = new AbortController();
    const target = { obj: { v: 2, getInfo: () => { controller.abort(); return [1, 0, 0, 0]; } }, label: "별" };
    const points = await sampleAnnualTrajectory({ observer: { v: 1, clone: () => observer }, date2MJD: () => 1, convertFrame: () => [1, 0, 0, 0] }, target, new Date(), controller.signal);
    expect(points).toEqual([]);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("clips the back of the view and breaks disconnected paths", () => {
    expect(projectViewVector([0, 0, -1], 800, 600, Math.PI / 2, 1)).toEqual({ x: 400, y: 300 });
    expect(projectViewVector([0, 0, 1], 800, 600, Math.PI / 2, 1)).toBeNull();
    expect(projectViewVector([1, 0, -1], 800, 600, Math.PI / 2, 1)!.x).toBeCloseTo(700);
    expect(trajectorySvgPath([{ x: 0, y: 1 }, { x: 2, y: 3 }, null, { x: 4, y: 5 }])).toBe("M0.00,1.00 L2.00,3.00  M4.00,5.00");
  });
});

describe("real Stellarium annual ephemerides", () => {
  let engine: StellariumEngine;
  beforeAll(async () => {
    const require = createRequire(import.meta.url);
    const factory = require("../../public/stellarium/stellarium-web-engine.js");
    engine = await factory({ wasmBinary: readFileSync(new URL("../../public/stellarium/stellarium-web-engine.wasm", import.meta.url)) });
    patchWasmMemoryHelpers(engine);
    engine.observer = engine.core?.observer as SweObj;
    engine.observer.latitude = 37.5665 * Math.PI / 180;
    engine.observer.longitude = 126.978 * Math.PI / 180;
    engine.observer.utc = engine.date2MJD!(new Date("2026-10-19T03:00:00Z").getTime());
    engine._observer_update?.(engine.observer.v, false);
  });

  it("draws a solar analemma, not the ecliptic or a daily circle, without changing the viewer", async () => {
    const observer = engine.observer!;
    const before = { utc: observer.utc, latitude: observer.latitude, longitude: observer.longitude };
    const sun = engine.getObj!("NAME Sun")!;
    const original = sun.getInfo!("radec", observer) as number[];
    const points = await sampleAnnualTrajectory(engine, { label: "태양", obj: sun }, new Date("2026-06-15T03:00:00Z"));
    expect(points).toHaveLength(366);
    const xy = points.map(({ vector: [x, y, z] }) => [Math.atan2(y, x) * 180 / Math.PI, Math.asin(z) * 180 / Math.PI]);
    const span = (axis: number) => Math.max(...xy.map(p => p[axis])) - Math.min(...xy.map(p => p[axis]));
    expect(span(1)).toBeGreaterThan(43);
    expect(span(1)).toBeLessThan(50);
    expect(span(0)).toBeLessThan(40);
    const side = (a: number[], b: number[], p: number[]) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    let intersections = 0;
    for (let i = 0; i < xy.length - 1; i++) for (let j = i + 2; j < xy.length - 1; j++) {
      if (side(xy[i], xy[i + 1], xy[j]) * side(xy[i], xy[i + 1], xy[j + 1]) < 0 &&
        side(xy[j], xy[j + 1], xy[i]) * side(xy[j], xy[j + 1], xy[i + 1]) < 0) intersections++;
    }
    expect(intersections).toBeGreaterThanOrEqual(1);
    expect({ utc: observer.utc, latitude: observer.latitude, longitude: observer.longitude }).toEqual(before);
    const after = sun.getInfo!("radec", observer) as number[];
    original.forEach((value, index) => expect(after[index]).toBeCloseTo(value, 10));
  });

  it("traces Polaris around the north celestial pole at the selected clock", async () => {
    const ra = 37.95456 * Math.PI / 180, dec = 89.2641 * Math.PI / 180;
    const vector = [Math.cos(ra) * Math.cos(dec), Math.sin(ra) * Math.cos(dec), Math.sin(dec), 0];
    const points = await sampleAnnualTrajectory(engine, { obj: { v: -1, getInfo: () => vector }, label: "북극성" }, new Date("2026-10-19T11:00:00Z"));
    expect(points).toHaveLength(366);
    const pole = [Math.cos(engine.observer!.latitude!), 0, Math.sin(engine.observer!.latitude!)];
    const radii = points.map(({ vector: v }) => Math.acos(Math.max(-1, Math.min(1, v.reduce((sum, value, axis) => sum + value * pole[axis], 0)))) * 180 / Math.PI);
    expect(Math.min(...radii)).toBeGreaterThan(.4);
    expect(Math.max(...radii)).toBeLessThan(1);
    expect(Math.hypot(...points[0].vector.map((value, axis) => value - points[182].vector[axis]))).toBeGreaterThan(.015);
  });

  it("uses a planet's position on each sampled date", async () => {
    const mars = engine.getObj!("NAME Mars")!;
    const points = await sampleAnnualTrajectory(engine, { obj: mars, label: "화성" }, new Date("2026-10-19T11:00:00Z"));
    expect(points).toHaveLength(366);
    expect(Math.hypot(...points[0].vector.map((value, axis) => value - points.at(-1)!.vector[axis]))).toBeGreaterThan(.2);
  });
});
