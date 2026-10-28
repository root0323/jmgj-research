import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { loadConstellationLabels, projectConstellationLabels } from "./constellationLabels";
import type { ConstellationLabel } from "./constellationLabels";
import { createConstellationLineObjects, patchWasmMemoryHelpers } from "./engineControls";
import type { StellariumEngine, SweObj } from "./types";

const fixtures = new Map(["index.json", "hip-stars.json"].map(name => [name,
  JSON.parse(readFileSync(new URL(`../../public/stellarium/skycultures/western/${name}`, import.meta.url), "utf8").replace(/^\uFEFF/, ""))]));
const bundledFetch = () => vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
  ok: true, json: async () => fixtures.get(url.split("/").at(-1)!),
})));
let engine: StellariumEngine;
let labels: ConstellationLabel[];

beforeAll(async () => {
  bundledFetch();
  labels = await loadConstellationLabels();
  vi.unstubAllGlobals();
  const require = createRequire(import.meta.url);
  engine = await require("../../public/stellarium/stellarium-web-engine.js")({
    wasmBinary: readFileSync(new URL("../../public/stellarium/stellarium-web-engine.wasm", import.meta.url)),
  });
  patchWasmMemoryHelpers(engine);
  engine.observer = engine.core?.observer as SweObj;
  engine.observer.latitude = 37.5665 * Math.PI / 180;
  engine.observer.longitude = 126.978 * Math.PI / 180;
  engine.observer.utc = engine.date2MJD!(new Date("2026-10-20T10:30:00Z").getTime());
  engine._observer_update?.(engine.observer.v, false);
});
afterEach(() => vi.unstubAllGlobals());

function pointAt(id: string) {
  const label = labels.find(label => label.id === `CON western ${id}`)!;
  const observed = engine.convertFrame!(engine.observer!, "ICRF", "OBSERVED", [...label.vector, 0]);
  engine.lookAt!(observed.slice(0, 3) as [number, number, number], 0);
  engine.zoomTo!(Math.PI / 3, 0);
  engine._observer_update?.(engine.observer!.v, false);
}

it("keeps all 88 bundled constellation names attached to their actual sky positions once", () => {
  expect(labels).toHaveLength(88);
  expect(new Set(labels.map(label => label.id)).size).toBe(88);
  const ra = (id: string) => {
    const [x, y] = labels.find(label => label.id === `CON western ${id}`)!.vector;
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  };
  expect(ra("Gem")).toBeGreaterThan(90);
  expect(ra("Gem")).toBeLessThan(120);
  expect(ra("Sgr")).toBeGreaterThan(270);
  expect(ra("Sgr")).toBeLessThan(300);
});

it("never projects Gemini over Sagittarius, or Sagittarius over Gemini, even with ground off", () => {
  pointAt("Sgr");
  let points = projectConstellationLabels(engine, labels, 1280, 720, false);
  expect(points.has("CON western Sgr")).toBe(true);
  expect(points.has("CON western Gem")).toBe(false);
  expect(points.get("CON western Sgr")!.x).toBeCloseTo(640, 0);
  expect(points.get("CON western Sgr")!.y).toBeCloseTo(360, 0);
  pointAt("Gem");
  points = projectConstellationLabels(engine, labels, 1280, 720, false);
  expect(points.has("CON western Gem")).toBe(true);
  expect(points.has("CON western Sgr")).toBe(false);
});

it("clips below-horizon names with ground on and never changes the observer or camera", () => {
  pointAt("Gem");
  const observer = engine.observer!;
  const snapshot = () => ({ utc: observer.utc, latitude: observer.latitude, longitude: observer.longitude,
    view: engine.convertFrame!(observer, "VIEW", "ICRF", [0, 0, -1, 0]), fov: engine.core?.fov });
  const before = snapshot();
  expect(projectConstellationLabels(engine, labels, 1280, 720, false).has("CON western Gem")).toBe(true);
  expect(projectConstellationLabels(engine, labels, 1280, 720, true).has("CON western Gem")).toBe(false);
  expect(snapshot()).toEqual(before);
});

it("removes the faulty native point-title renderer while preserving all constellation line segments", async () => {
  bundledFetch();
  const objects = await createConstellationLineObjects({ createObj: () => ({ v: 1 }) });
  const features = objects.flatMap(obj => (obj.data as { features: Array<{ geometry: { type: string } }> }).features);
  const raw = fixtures.get("index.json") as { constellations: Array<{ lines: unknown[] }> };
  expect(objects).toHaveLength(88);
  expect(features).toHaveLength(raw.constellations.reduce((sum, constellation) => sum + constellation.lines.length, 0));
  expect(features.every(feature => feature.geometry.type === "LineString")).toBe(true);
});
