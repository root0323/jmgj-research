/** Stellarium OBSERVED uses spherical azimuth: X north, Y east, Z up. */
export function directionVector(azimuth: number, altitude: number): [number, number, number] | null {
  if (!Number.isFinite(azimuth) || !Number.isFinite(altitude) || Math.abs(altitude) > 90) return null;
  const a = azimuth * Math.PI / 180, h = altitude * Math.PI / 180;
  return [Math.cos(h) * Math.cos(a), Math.cos(h) * Math.sin(a), Math.sin(h)];
}
export function smoothVector(previous: number[] | null, next: number[], blend = 0.25): [number, number, number] {
  const value = previous ? next.map((n, i) => previous[i] + (n - previous[i]) * blend) : next;
  const length = Math.hypot(...value);
  return (length < 1e-6 ? next : value.map(n => n / length)) as [number, number, number];
}
