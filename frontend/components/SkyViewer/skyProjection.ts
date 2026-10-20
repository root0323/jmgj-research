export type ScreenPoint = { x: number; y: number };

export function projectViewVector(vector: number[], width: number, height: number, fov: number, projection: number): ScreenPoint | null {
  if (vector.length < 3 || !vector.every(Number.isFinite) || Math.hypot(...vector.slice(0, 3)) === 0 ||
      width <= 0 || height <= 0 || !Number.isFinite(fov) || fov <= 0) return null;
  const [x, y, z] = vector;
  const forward = -z; // Stellarium VIEW uses X right, Y up, -Z forward.
  if (forward <= 0) return null;
  const halfSize = Math.min(width, height) / 2;
  const scale = projection === 2
    ? halfSize / Math.tan(fov / 4) / (Math.hypot(x, y, z) + forward)
    : halfSize / Math.tan(fov / 2) / forward;
  const point = { x: width / 2 + x * scale, y: height / 2 - y * scale };
  return Number.isFinite(point.x) && Number.isFinite(point.y) &&
    Math.abs(point.x) < 1e7 && Math.abs(point.y) < 1e7 ? point : null;
}
