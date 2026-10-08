import { afterEach, expect, it, vi } from "vitest";
import { loadBrightStarCatalog, updateVisibleStarCatalog } from "./skyCatalog";
import type { BrightStar, SearchSuggestion, StellariumEngine, SweObj } from "./types";

afterEach(() => vi.unstubAllGlobals());

it("keeps faint-star batches complete across zoom changes without duplicating stars", async () => {
  const stars: BrightStar[] = Array.from({ length: 710 }, (_, id) => ({
    id, hr: null, hd: null, name: `Test ${id}`, names: [`Test ${id}`],
    ra: 0, dec: 0, vmag: id === 0 ? 3 : id === 709 ? 7.4 : 6, spect: "G",
  })).reverse(); // Input order must not determine which stars are added.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stars }) }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
  const add = vi.fn((obj: SweObj) => obj);
  let fov = Math.PI / 3;
  const engine = {
    createLayer: () => ({ v: 1, add }),
    createObj: (_type: string, value: { id: string }) => ({ v: 1, id: value.id }),
    getValue: () => fov,
  } as unknown as StellariumEngine;
  const targets: SearchSuggestion[] = [];
  expect(await loadBrightStarCatalog(engine, new Map(), [], targets)).toBe(1);
  expect(updateVisibleStarCatalog(engine, targets)).toBe(0);
  fov = 20 * Math.PI / 180;
  expect(updateVisibleStarCatalog(engine, targets)).toBe(700);
  fov = Math.PI / 3;
  expect(updateVisibleStarCatalog(engine, targets)).toBe(0);
  fov = 20 * Math.PI / 180;
  expect(updateVisibleStarCatalog(engine, targets)).toBe(8);
  expect(updateVisibleStarCatalog(engine, targets)).toBe(0);
  fov = 5 * Math.PI / 180;
  expect(updateVisibleStarCatalog(engine, targets)).toBe(1);
  expect(updateVisibleStarCatalog(engine, targets)).toBe(0);
  expect(add).toHaveBeenCalledTimes(710);
  expect(new Set(targets.map(item => item.obj.id)).size).toBe(710);
});
