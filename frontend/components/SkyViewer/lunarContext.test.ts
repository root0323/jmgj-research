import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getLunarContext } from "./coordinates";
import { patchWasmMemoryHelpers } from "./engineControls";
import type { StellariumEngine } from "./types";

describe("native Stellarium lunar context", () => {
  it("uses the requested observer without changing the displayed time or location", async () => {
    const require = createRequire(import.meta.url);
    const factory = require("../../public/stellarium/stellarium-web-engine.js");
    const engine: StellariumEngine = await factory({ wasmBinary: readFileSync(new URL("../../public/stellarium/stellarium-web-engine.wasm", import.meta.url)) });
    patchWasmMemoryHelpers(engine);
    engine.observer = engine.core?.observer as StellariumEngine["observer"];
    const original = { utc: engine.observer?.utc, latitude: engine.observer?.latitude, longitude: engine.observer?.longitude };
    const time = new Date("2026-10-07T13:00:00Z");
    const seoul = getLunarContext(engine, time, { latitude: 37.5665, longitude: 126.978 });
    const opposite = getLunarContext(engine, time, { latitude: -37.5665, longitude: -53.022 });
    expect(seoul).not.toBeNull();
    expect(seoul?.phaseAngle).toBeGreaterThan(130);
    expect(seoul?.phaseAngle).toBeLessThan(150);
    expect(Math.abs(seoul!.altitude - opposite!.altitude)).toBeGreaterThan(20);
    expect(seoul?.datetime).toBe(time.toISOString());
    expect({ utc: engine.observer?.utc, latitude: engine.observer?.latitude, longitude: engine.observer?.longitude }).toEqual(original);
  });
});
