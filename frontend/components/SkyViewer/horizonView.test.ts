import { describe, expect, it, vi } from "vitest";
import { keepHorizonLevel, setInitialHorizonView } from "./engineControls";
import { projectTargetToScreen } from "./coordinates";
import type { StellariumEngine } from "./types";

describe("level horizon view", () => {
  it("uses perspective and resets roll while preserving the viewing direction", () => {
    const core = { projection: 2, observer: { v: 1, roll: 0.2, yaw: 1, pitch: 0.3 } };
    const engine = { core, lookAt: vi.fn(), _observer_update: vi.fn() } as StellariumEngine;
    setInitialHorizonView(engine);
    expect(core.projection).toBe(1);
    expect(core.observer.roll).toBe(0);
    expect(core.observer.yaw).toBe(1);
    expect(core.observer.pitch).toBe(0.3);
    expect(engine.lookAt).toHaveBeenCalledOnce();
    expect(engine._observer_update).toHaveBeenCalledOnce();
    keepHorizonLevel(engine);
    expect(engine._observer_update).toHaveBeenCalledOnce();
  });

  it.each([1, 2])("projects centre/right/up and rejects targets behind projection %i", projection => {
    let ray = [0, 0, -1];
    const engine = { core: { projection, fov: Math.PI / 3, observer: { v: 1 } },
      convertFrame: () => ray } as StellariumEngine;
    const canvas = {getBoundingClientRect: () => ({ width: 1200, height: 800 })} as HTMLCanvasElement;
    const project = () => projectTargetToScreen(engine, canvas, { v: 2 }, [1, 0, 0]);
    expect(project()).toEqual({ x: 600, y: 400 });
    const angle = Math.PI / 6;
    ray = [Math.sin(angle), 0, -Math.cos(angle)];
    expect(project()!.x).toBeCloseTo(1000);
    expect(project()!.y).toBe(400);
    ray = [0, Math.sin(angle), -Math.cos(angle)];
    expect(project()!.y).toBeCloseTo(0);
    ray = [0, 0, 1];
    expect(project()).toBeNull();
  });

  it("uses the shorter viewport dimension for a portrait camera preview", () => {
    const engine = { core: { projection: 1, fov: Math.PI / 3, observer: { v: 1 } },
      convertFrame: () => [0.5, 0, -Math.sqrt(0.75)] } as StellariumEngine;
    const canvas = {getBoundingClientRect: () => ({ width: 400, height: 800 })} as HTMLCanvasElement;
    expect(projectTargetToScreen(engine, canvas, { v: 2 }, [1, 0, 0])!.x).toBeCloseTo(400);
  });
});
