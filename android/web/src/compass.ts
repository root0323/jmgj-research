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
  private displayed: [number, number, number] | null = null;
  private samples: [number, number, number][] = [];
  private time: number | null = null;
  reset() { this.vector = null; this.displayed = null; this.samples = []; this.time = null; }
  update(azimuth: number, altitude: number, time: number) {
    let next = directionVector(azimuth, altitude);
    if (!next || !Number.isFinite(time)) return null;
    if (this.time !== null && time <= this.time) return null;
    const elapsed = this.time === null ? Infinity : time - this.time;
    this.time = time;
    const previousSample = this.samples.at(-1);
    if (elapsed >= 1000 || (previousSample && Math.hypot(...next.map((n, i) => n - previousSample[i])) > 0.05235)) this.samples = [];
    this.samples.push(next);
    if (this.samples.length > 3) this.samples.shift();
    // Average nearby samples in 3D, including samples received between draw frames.
    // A large intentional turn bypasses this short noise window immediately.
    const average = [0, 1, 2].map(i => this.samples.reduce((sum, sample) => sum + sample[i], 0) / this.samples.length);
    const length = Math.hypot(...average);
    next = average.map(n => n / length) as [number, number, number];
    if (this.vector && elapsed < 1000) {
      const separation = Math.hypot(...next.map((n, i) => n - this.vector![i]));
      const degrees = 2 * Math.asin(Math.min(1, separation / 2)) * 180 / Math.PI;
      // Quiet near rest; a deliberate turn catches up without the same long delay.
      const movement = Math.max(0, Math.min(1, (degrees - 1) / 5));
      const responseMs = 220 - movement * 160;
      this.vector = smoothVector(this.vector, next, 1 - Math.exp(-elapsed / responseMs));
    } else { this.vector = next; this.displayed = null; }
    // Keep accumulating slow motion internally, while avoiding redundant WASM calls.
    if (this.displayed && Math.hypot(...this.vector.map((n, i) => n - this.displayed![i])) < 0.00436) return null;
    this.displayed = this.vector;
    return this.vector;
  }
}
