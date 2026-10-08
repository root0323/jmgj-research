import type { CameraSettings } from "./types";

export function calculateFieldOfView(focalLengthMm: number, camera: CameraSettings) {
  const { sensorWidthMm: width, sensorHeightMm: height, pixelSizeUm: pixel } = camera;
  if (![focalLengthMm, width, height].every(value => typeof value === "number" && Number.isFinite(value) && value > 0)) return null;
  const halfWidth = width! / (2 * focalLengthMm);
  const halfHeight = height! / (2 * focalLengthMm);
  return {
    halfWidth, halfHeight,
    width: 2 * Math.atan(halfWidth), height: 2 * Math.atan(halfHeight),
    fit: Math.min(150 * Math.PI / 180, 2 * Math.atan(Math.hypot(halfWidth, halfHeight)) * 1.6),
    pixelScale: pixel && pixel > 0 ? 206264.806 * pixel / (1000 * focalLengthMm) : null,
  };
}

// Project the sensor's four straight edges onto the celestial sphere. Native
// geojson rendering then handles projection, horizon clipping and RA wrap.
export function fieldOfViewEdges(vector: number[], halfWidth: number, halfHeight: number) {
  const length = Math.hypot(...vector.slice(0, 3));
  if (!Number.isFinite(length) || length === 0) throw new Error("Invalid pointing");
  const center = vector.slice(0, 3).map(value => value / length);
  const xy = Math.hypot(center[0], center[1]);
  const east = xy > 1e-12 ? [-center[1] / xy, center[0] / xy, 0] : [0, 1, 0];
  const north = [center[1] * east[2] - center[2] * east[1], center[2] * east[0] - center[0] * east[2], center[0] * east[1] - center[1] * east[0]];
  const corners = [[-halfWidth, -halfHeight], [halfWidth, -halfHeight], [halfWidth, halfHeight], [-halfWidth, halfHeight]];
  return corners.map((start, edge) => {
    const end = corners[(edge + 1) % 4];
    const coordinates = Array.from({ length: 9 }, (_, i) => {
      const u = start[0] + (end[0] - start[0]) * i / 8;
      const v = start[1] + (end[1] - start[1]) * i / 8;
      const point = center.map((value, axis) => value + u * east[axis] + v * north[axis]);
      return [((Math.atan2(point[1], point[0]) * 180 / Math.PI + 360) % 360), Math.atan2(point[2], Math.hypot(point[0], point[1])) * 180 / Math.PI]
        .map(value => Math.round(value * 1e7) / 1e7);
    });
    return { type: "FeatureCollection", features: [{ type: "Feature", properties: {
      stroke: "#ffd38a", "stroke-opacity": 1, "stroke-width": 1.5, "stroke-glow": false,
      fill: "#000000", "fill-opacity": 0,
    }, geometry: { type: "LineString", coordinates } }] };
  });
}
