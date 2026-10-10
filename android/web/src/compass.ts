/** Stellarium OBSERVED uses spherical azimuth: X north, Y east, Z up. */
export function directionVector(azimuth: number, altitude: number): [number, number, number] | null {
  if (!Number.isFinite(azimuth) || !Number.isFinite(altitude) || Math.abs(altitude) > 90) return null;
  const a = azimuth * Math.PI / 180, h = altitude * Math.PI / 180;
  return [Math.cos(h) * Math.cos(a), Math.cos(h) * Math.sin(a), Math.sin(h)];
}
export function smoothVector(previous: number[] | null, next: number[], blend = 0.25): [number, number, number] {
  let value = next;
  if (previous) {
    const dot = Math.max(-1, Math.min(1, next.reduce((sum, n, i) => sum + n * previous[i], 0)));
    const angle = Math.acos(dot);
    if (dot < -0.999999) {
      // Antipodal linear interpolation normalizes back to the old direction forever.
      const tangent = Math.hypot(previous[0], previous[1]) > 1e-6
        ? [-previous[1], previous[0], 0] : [1, 0, 0];
      const length = Math.hypot(...tangent);
      value = previous.map((n, i) => n * Math.cos(Math.PI * blend) + tangent[i] / length * Math.sin(Math.PI * blend));
    } else if (angle > 1e-6) {
      value = next.map((n, i) => (previous[i] * Math.sin((1 - blend) * angle) + n * Math.sin(blend * angle)) / Math.sin(angle));
    }
  }
  const length = Math.hypot(...value);
  return (length < 1e-6 ? next : value.map(n => n / length)) as [number, number, number];
}

export const NORTH_OFFSET_KEY = 'astrosky.compass.north-offset.v1';
export const normalizeAzimuth = (value: number) => ((value % 360) + 360) % 360;
export function readNorthOffset(storage: Pick<Storage, 'getItem'>): number | null {
  try {
    const raw = storage.getItem(NORTH_OFFSET_KEY);
    if (raw === null || raw.trim() === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value < 360 ? value : null;
  } catch { return null; }
}
export function alignedAzimuth(azimuth: number, northOffset: number | null) {
  return normalizeAzimuth(azimuth - (northOffset ?? 0));
}

/** Filter in 3D, avoiding the 359°/0° seam and frame-rate dependent lag. */
export class CompassFilter {
  private vector: [number, number, number] | null = null;
  private time: number | null = null;
  reset() { this.vector = null; this.time = null; }
  update(azimuth: number, altitude: number, time: number) {
    const next = directionVector(azimuth, altitude);
    if (!next || !Number.isFinite(time)) return null;
    if (this.time !== null && time <= this.time) return null;
    const elapsed = this.time === null ? Infinity : time - this.time;
    this.time = time;
    if (this.vector && elapsed < 1000) {
      const separation = Math.hypot(...next.map((n, i) => n - this.vector![i]));
      if (separation < 0.0026) return this.vector; // ~0.15° of stationary noise.
      this.vector = smoothVector(this.vector, next, 1 - Math.exp(-elapsed / 80));
    } else this.vector = next;
    return this.vector;
  }
}
