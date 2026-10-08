import { describe, expect, it, vi } from "vitest";
import { getDeepSkySearchCandidates } from "./skyCatalog";
import { matchingDeepSkyNames, namedDeepSky } from "./deepSkyNames";
import { ensureDssDataSource } from "./engineControls";
import type { StellariumEngine } from "./types";

describe("deep-sky name search", () => {
  it("resolves Korean and English names, spacing variants and catalogue numbers", () => {
    for (const term of ["안드로메다 은하", "안드로메다은하", "Andromeda Galaxy", "안드로메다 은하 (M31)", "M031"]) {
      expect(getDeepSkySearchCandidates(term)[0]).toBe("M 31");
    }
    expect(getDeepSkySearchCandidates("오리온성운")[0]).toBe("M 42");
    expect(getDeepSkySearchCandidates("IC434")[0]).toBe("IC 434");
    expect(getDeepSkySearchCandidates("시리우스")).toEqual([]);
  });
  it("offers incomplete names and identifies the Horsehead navigation as the surrounding IC434 field", () => {
    expect(matchingDeepSkyNames("안드로")[0].id).toBe("M 31");
    expect(matchingDeepSkyNames("말머리")[0].id).toBe("IC 434");
    expect(namedDeepSky("말머리 성운")?.label).toContain("주변");
    expect(getDeepSkySearchCandidates("Barnard 33")[0]).toBe("IC 434");
  });
  it("does not mark a failed DSS registration as loaded, and can retry successfully", () => {
    const loaded = new Set<string>();
    const dss = { update: vi.fn() };
    const engine = { core: { dss } } as unknown as StellariumEngine;
    expect(ensureDssDataSource(engine, loaded)).toBe(false);
    expect(loaded.has("dss")).toBe(false);
    const addDataSource = vi.fn();
    Object.assign(dss, { addDataSource });
    expect(ensureDssDataSource(engine, loaded)).toBe(true);
    expect(ensureDssDataSource(engine, loaded)).toBe(true);
    expect(addDataSource).toHaveBeenCalledTimes(1);
    expect(addDataSource.mock.calls[0][0].url).toMatch(/^https:/);
  });
});
