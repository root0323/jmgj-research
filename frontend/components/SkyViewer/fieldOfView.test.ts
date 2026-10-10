import { describe, expect, it } from "vitest";
import { calculateFieldOfView, calculateEyepieceFieldOfView, fieldOfViewEdges, eyepieceFieldOfViewEdges } from "./fieldOfView";

describe("camera field of view", () => {
  it("uses physical sensor angles and pixel scale, independent of aperture", () => {
    const field = calculateFieldOfView(1000, { sensorWidthMm: 36, sensorHeightMm: 24, pixelSizeUm: 3.76 })!;
    expect(field.width * 180 / Math.PI).toBeCloseTo(2.0624253, 6);
    expect(field.height * 180 / Math.PI).toBeCloseTo(1.3750327, 6);
    expect(field.pixelScale).toBeCloseTo(0.77555567, 6);
    expect(field.aspect).toBe(1.5);
    expect(field.viewportFov).toBe(field.height);
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

describe("eyepiece field of view", () => {
  it("uses magnification and apparent field, without requiring a camera", () => {
    const eye = { focalLengthMm: 25, apparentFieldDegrees: 60 };
    const field = calculateEyepieceFieldOfView(1000, eye)!;
    expect(field.magnification).toBe(40);
    expect(field.diameter * 180 / Math.PI).toBeCloseTo(1.5, 10);
    expect(field.viewportFov).toBe(field.diameter);
    expect(field.aspect).toBe(1);
    expect(calculateEyepieceFieldOfView(2000, eye)!.diameter).toBe(field.diameter / 2);
  });
  it("requires valid optical specifications instead of inventing a default field", () => {
    for (const eye of [{ focalLengthMm: null, apparentFieldDegrees: 60 }, { focalLengthMm: 25, apparentFieldDegrees: null }, { focalLengthMm: 0, apparentFieldDegrees: 60 }, { focalLengthMm: 25, apparentFieldDegrees: 181 }])
      expect(calculateEyepieceFieldOfView(1000, eye)).toBeNull();
    expect(calculateEyepieceFieldOfView(0, { focalLengthMm: 25, apparentFieldDegrees: 60 })).toBeNull();
  });
  it("draws a closed small circle at the true angular radius even at poles and RA wrap", () => {
    const diameter = 1.5 * Math.PI / 180;
    for (const center of [[0, 0, 1], [0, 0, -1], [1, -0.00001, 0]]) {
      const edges = eyepieceFieldOfViewEdges(center, diameter);
      edges.forEach((edge, index) => {
        const points = edge.features[0].geometry.coordinates;
        expect(points.at(-1)).toEqual(edges[(index + 1) % edges.length].features[0].geometry.coordinates[0]);
        expect(JSON.stringify(edge).length).toBeLessThan(1024);
        for (const [ra, dec] of points) {
          const a = ra * Math.PI / 180, d = dec * Math.PI / 180;
          const dot = (Math.cos(d) * Math.cos(a) * center[0] + Math.cos(d) * Math.sin(a) * center[1] + Math.sin(d) * center[2]) / Math.hypot(...center);
          expect(Math.acos(Math.min(1, dot))).toBeCloseTo(diameter / 2, 7);
        }
      });
    }
  });
});
