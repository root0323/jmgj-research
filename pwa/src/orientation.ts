/** W3C intrinsic Z-X-Y rotation; transform the rear camera's -Z axis to ENU.
 * Screen rotation does not change this physical axis. Never reuse old samples.
 */
export function rearDirection(alpha: number, beta: number, gamma: number, correction = 0) {
  if (![alpha, beta, gamma, correction].every(Number.isFinite)) return null;
  const r = Math.PI / 180, a = alpha * r, b = beta * r, g = gamma * r;
  const east = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g);
  const north = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g);
  const up = -Math.cos(b) * Math.cos(g);
  const azimuth = ((Math.atan2(east, north) / r + correction) % 360 + 360) % 360;
  return { azimuth, altitude: Math.asin(Math.max(-1, Math.min(1, up))) / r };
}
export type OrientationSample = { alpha: number | null; beta: number | null; gamma: number | null; absolute: boolean; webkitCompassHeading?: number; webkitCompassAccuracy?: number };
export class BrowserOrientation {
  private correction: number | null = null;
  reset() { this.correction = null; }
  sample(event: OrientationSample) {
    const { alpha, beta, gamma } = event;
    if (alpha === null || beta === null || gamma === null) return null;
    if (event.absolute) this.correction = 0;
    else if (Number.isFinite(event.webkitCompassHeading) && (event.webkitCompassAccuracy ?? 0) >= 0) {
      // Safari's heading is the bearing of the device's upper edge. Calibrate
      // the relative alpha frame when that edge has a usable horizontal component.
      if (Math.abs(Math.cos(beta * Math.PI / 180)) > 0.12) {
        const upperBearing = -alpha + (Math.cos(beta * Math.PI / 180) < 0 ? 180 : 0);
        this.correction = event.webkitCompassHeading! - upperBearing;
      } else if (this.correction === null) {
        // At a vertical start the upper-edge projection is singular. Require
        // a slightly tilted fresh sample rather than presenting a false north.
        return null;
      }
    }
    if (this.correction === null) return null;
    const direction = rearDirection(alpha, beta, gamma, this.correction);
    return direction ? { ...direction, accuracy: (event.webkitCompassAccuracy ?? 0) > 20 ? 1 : 3 } : null;
  }
}
