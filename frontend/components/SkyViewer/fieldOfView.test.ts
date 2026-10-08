import { describe, expect, it } from "vitest";
import { calculateFieldOfView, fieldOfViewEdges } from "./fieldOfView";

describe("camera field of view", () => {
  it("uses physical sensor angles and pixel scale, independent of aperture", () => {
    const field = calculateFieldOfView(1000, { sensorWidthMm: 36, sensorHeightMm: 24, pixelSizeUm: 3.76 })!;
    expect(field.width * 180 / Math.PI).toBeCloseTo(2.0624253, 6);
    expect(field.height * 180 / Math.PI).toBeCloseTo(1.3750327, 6);
    expect(field.pixelScale).toBeCloseTo(0.77555567, 6);
    expect(field.fit).toBeGreaterThan(Math.hypot(field.width, field.height));
  });
  it("does not invent a field for an unconfigured or invalid camera", () => {
    expect(calculateFieldOfView(1000, { sensorWidthMm: null, sensorHeightMm: 24, pixelSizeUm: null })).toBeNull();
    expect(calculateFieldOfView(0, { sensorWidthMm: 36, sensorHeightMm: 24, pixelSizeUm: 3.76 })).toBeNull();
  });
  it("puts edge midpoints at the specified half angles", () => {
    const edges = fieldOfViewEdges([1, 0, 0], 0.018, 0.012);
    const right = edges[1].features[0].geometry.coordinates[4];
    const top = edges[2].features[0].geometry.coordinates[4];
    expect(right[0]).toBeCloseTo(Math.atan(0.018) * 180 / Math.PI, 6);
    expect(top[1]).toBeCloseTo(Math.atan(0.012) * 180 / Math.PI, 6);
    edges.forEach(edge => expect(JSON.stringify(edge).length).toBeLessThan(1024));
  });
  it("stays finite at both poles and across the RA seam with a closed frame", () => {
    for (const center of [[0, 0, 1], [0, 0, -1], [1, -0.00001, 0]]) {
      const edges = fieldOfViewEdges(center, 0.018, 0.012);
      edges.forEach((edge, i) => {
        const points = edge.features[0].geometry.coordinates;
        expect(points.flat().every(Number.isFinite)).toBe(true);
        expect(points.at(-1)).toEqual(edges[(i + 1) % 4].features[0].geometry.coordinates[0]);
      });
    }
  });
});
