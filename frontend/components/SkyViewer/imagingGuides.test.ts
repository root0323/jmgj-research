import { expect, it } from "vitest";
import { IMAGING_GUIDES, availableImagingRecipes, calculateImagingFrames, defaultImagingRecipe, searchImagingGuides } from "./imagingGuides";

it("finds common Korean/English names and separately prefixed component catalog numbers", () => {
  expect(searchImagingGuides("말머리 성운")[0].id).toBe("horsehead");
  expect(searchImagingGuides("Barnard 33")[0].id).toBe("horsehead");
  expect(searchImagingGuides("NGC2238")[0].id).toBe("rosette");
  expect(searchImagingGuides("Ｍ ３１")[0].id).toBe("andromeda");
  expect(searchImagingGuides("double cluster")[0].id).toBe("double");
  expect(searchImagingGuides("47 Tucanae")[0].id).toBe("tucanae");
  expect(searchImagingGuides("없는 천체")).toEqual([]);
});

it("covers every proposed northern field and southern additions without duplicate ids", () => {
  expect(new Set(IMAGING_GUIDES.map(item => item.id)).size).toBe(IMAGING_GUIDES.length);
  for (const name of ["M78", "IC2118", "Sh2-276", "M97", "NGC7380", "IC5146", "LMC", "NGC3372"]) {
    expect(searchImagingGuides(name).length).toBeGreaterThan(0);
  }
  expect(searchImagingGuides(" ")).toBe(IMAGING_GUIDES);
});

it("uses total integration across all channels, rather than multiplying it by channel count", () => {
  const rgb = calculateImagingFrames("dslr", "RGB", 60, 2)!;
  expect(rgb.count).toBe(120);
  expect(rgb.frames).toEqual([{ channel: "컬러", count: 120 }]);
  const lrgb = calculateImagingFrames("mono", "LRGB", 120, 5)!;
  expect(lrgb.frames.map(item => item.count)).toEqual([60, 30, 30, 30]);
  expect(lrgb.count).toBe(150);
  expect(lrgb.actualHours).toBe(5);
  expect(calculateImagingFrames("mono", "RGB", 60, 2)!.frames.map(item => item.count)).toEqual([40, 40, 40]);
});

it("counts distinct exposures for HOO, not the reused oxygen image twice", () => {
  expect(calculateImagingFrames("mono", "HOO", 180, 3)!.frames).toEqual([{ channel: "Hα", count: 30 }, { channel: "OⅢ", count: 30 }]);
  expect(calculateImagingFrames("color", "dual", 180, 3)!.count).toBe(60);
  const rounded = calculateImagingFrames("mono", "SHO", 180, 1)!;
  expect(rounded.count).toBe(21);
  expect(rounded.actualHours).toBe(1.05);
});

it("rejects incomplete, nonfinite or unreasonable plans instead of showing zero/infinite frames", () => {
  for (const [seconds, hours] of [[0, 2], [NaN, 2], [Infinity, 2], [60, 0], [60, 101], [3601, 1]]) {
    expect(calculateImagingFrames("dslr", "RGB", seconds, hours)).toBeNull();
  }
});

it("keeps narrowband out of reflection/galaxy primary recipes and separates camera modes", () => {
  for (const item of IMAGING_GUIDES) {
    for (const camera of ["dslr", "color", "mono"] as const) {
      expect(availableImagingRecipes(item, camera)).toContain(defaultImagingRecipe(item, camera));
    }
  }
  expect(availableImagingRecipes(searchImagingGuides("M45")[0], "mono")).toEqual(["LRGB", "RGB"]);
  expect(availableImagingRecipes(searchImagingGuides("장미")[0], "color")).toEqual(["RGB", "dual"]);
});
