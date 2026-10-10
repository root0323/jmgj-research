import { describe, expect, it } from "vitest";
import { createMilkyWayOutlineObjects } from "./engineControls";
import outline from "@/data/milkyway-outline.json";
import type { SweObj } from "./types";

const radians = Math.PI / 180;
function vector([ra, dec]: number[]) {
  return [
    Math.cos(dec * radians) * Math.cos(ra * radians),
    Math.cos(dec * radians) * Math.sin(ra * radians),
    Math.sin(dec * radians),
  ];
}

describe("Milky Way outline geometry", () => {
  it("closes both contours without a jump at the RA or longitude seam", () => {
    expect(outline.boundaries).toHaveLength(2);
    for (const boundary of outline.boundaries) {
      expect(boundary[0]).toEqual(boundary.at(-1));
      for (let i = 1; i < boundary.length; i++) {
        const a = vector(boundary[i - 1]);
        const b = vector(boundary[i]);
        const dot = a.reduce((sum, value, axis) => sum + value * b[axis], 0);
        const separation = Math.acos(Math.min(1, dot)) / radians;
        expect(separation).toBeLessThan(5);
        if (i === boundary.length - 1) expect(separation).toBeLessThan(1.5);
      }
    }
  });

  it("bounds the main galactic band rather than a constant-width belt or isolated clouds", () => {
    const pole = [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669];
    const latitudes = outline.boundaries.map((boundary) => boundary.map((point) =>
      Math.asin(vector(point).reduce((sum, value, axis) => sum + value * pole[axis], 0)) / radians
    ));
    expect(Math.min(...latitudes[0])).toBeGreaterThan(0);
    expect(Math.max(...latitudes[1])).toBeLessThan(0);
    for (const edge of latitudes) {
      expect(Math.max(...edge) - Math.min(...edge)).toBeGreaterThan(5);
      expect(Math.max(...edge.map(Math.abs))).toBeLessThan(40);
    }
  });

  it("keeps native JSON transfers small and preserves all contour segments", () => {
    const objects = createMilkyWayOutlineObjects({ createObj: () => ({ v: 1 }) });
    expect(objects.length).toBeGreaterThan(0);
    let segments = 0;
    for (const object of objects) {
      // A single large transfer caused a real bundled-WASM memory error.
      expect(JSON.stringify(object.data).length).toBeLessThan(1024);
      const data = object.data as { features: { geometry: { coordinates: number[][] } }[] };
      segments += data.features[0].geometry.coordinates.length - 1;
    }
    expect(segments).toBe(outline.boundaries.reduce((sum, boundary) => sum + boundary.length - 1, 0));
    expect(objects.every((object: SweObj) => object.z === 16)).toBe(true);
  });
});
