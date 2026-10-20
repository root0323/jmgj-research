import type { SelectedTarget, StellariumEngine, SweObj } from "./types";
import type { ScreenPoint } from "./skyProjection";
export { projectViewVector } from "./skyProjection";
export type { ScreenPoint } from "./skyProjection";

export type TrajectoryPoint = { time: number; vector: number[] };

// Use the viewer's local civil clock, not sidereal time or a moving daily time.
// Construct each day independently so a DST transition cannot shift later days.
export function annualSampleDates(anchor: Date) {
  if (!Number.isFinite(anchor.getTime())) return [];
  const year = anchor.getFullYear();
  const dates: Date[] = [];
  for (let day = 1; day <= 367; day++) {
    const date = new Date(anchor);
    date.setFullYear(year, 0, day);
    dates.push(date);
    if (date.getFullYear() !== year) break;
  }
  return dates;
}

function validVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length >= 3 &&
    value.every(item => typeof item === "number" && Number.isFinite(item)) &&
    Math.hypot(...value.slice(0, 3)) > 0;
}

export function observedTargetVector(engine: StellariumEngine, target: SelectedTarget, observer: SweObj) {
  // In particular, retain the fourth, homogeneous component for nearby objects.
  // getTargetVector's three-component shortcut would lose lunar parallax.
  const raw = target.obj.getInfo?.("radec", observer);
  const vector = validVector(raw) ? raw : target.vector;
  if (!validVector(vector) || !engine.convertFrame) return null;
  const observed = engine.convertFrame(observer, "ICRF", "OBSERVED", vector.slice(0, 4));
  if (!validVector(observed)) return null;
  const length = Math.hypot(...observed.slice(0, 3));
  return observed.slice(0, 3).map(value => value / length);
}

export async function sampleAnnualTrajectory(
  engine: StellariumEngine, target: SelectedTarget, anchor: Date, signal?: AbortSignal,
): Promise<TrajectoryPoint[]> {
  if (!engine.date2MJD || !engine.convertFrame) return [];
  const original = engine.observer ?? engine.core?.observer as SweObj | undefined;
  const observer = original?.clone?.();
  if (!observer) return [];
  const points: TrajectoryPoint[] = [];
  try {
    const dates = annualSampleDates(anchor);
    for (let i = 0; i < dates.length; i++) {
      if (signal?.aborted) return [];
      observer.utc = engine.date2MJD(dates[i].getTime());
      engine._observer_update?.(observer.v, false);
      const vector = observedTargetVector(engine, target, observer);
      if (!vector) return [];
      points.push({ time: dates[i].getTime(), vector });
      // Yield between small batches, including on mobile. Never change the live
      // observer, camera, selection, or the application's running simulation.
      if (i % 16 === 15) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return signal?.aborted ? [] : points;
  } finally { observer.destroy?.(); }
}

export function trajectoryCacheKey(target: SelectedTarget, anchor: Date, observer: SweObj) {
  return [target.obj.v, target.vector?.join(","), anchor.getFullYear(), anchor.getHours(),
    anchor.getMinutes(), anchor.getSeconds(), anchor.getTimezoneOffset(),
    observer.latitude, observer.longitude].join("|");
}

// Invalid/hidden samples break the path instead of joining across the back of
// the sky, the ground, or a failed sample. Do not force planets' years closed.
export function trajectorySvgPath(points: Array<ScreenPoint | null>) {
  let connected = false;
  return points.map(point => {
    if (!point) { connected = false; return ""; }
    const command = connected ? "L" : "M";
    connected = true;
    return `${command}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).join(" ");
}
