import { getCoreNumber } from "./coordinates";
import { loadWesternConstellationGeoJson, sphericalToVector } from "./skyCatalog";
import { projectViewVector } from "./skyProjection";
import type { ScreenPoint } from "./skyProjection";
import type { StellariumEngine, SweObj } from "./types";

export type ConstellationLabel = { id: string; title: string; vector: number[] };

export async function loadConstellationLabels(): Promise<ConstellationLabel[]> {
  const data = await loadWesternConstellationGeoJson();
  const labels = new Map<string, ConstellationLabel>();
  for (const feature of data.features) {
    const id = feature.properties["constellation-id"], title = feature.properties.title;
    if (feature.geometry.type !== "Point" || !id || !title) continue;
    labels.set(id, { id, title, vector: sphericalToVector(feature.geometry.coordinates) });
  }
  return [...labels.values()];
}

export function projectConstellationLabels(
  engine: StellariumEngine, labels: ConstellationLabel[], width: number, height: number, showGround: boolean,
): Map<string, ScreenPoint> {
  const points = new Map<string, ScreenPoint>();
  const observer = engine.observer ?? engine.core?.observer as SweObj | undefined;
  if (!observer || !engine.convertFrame) return points;
  const rawFov = getCoreNumber(engine, "fov", Math.PI / 3);
  const fov = rawFov > Math.PI ? rawFov * Math.PI / 180 : rawFov;
  const projection = getCoreNumber(engine, "projection", 1);
  for (const label of labels) {
    const observed = engine.convertFrame(observer, "ICRF", "OBSERVED", [...label.vector, 0]);
    if (observed.length < 3 || !observed.every(Number.isFinite) || (showGround && observed[2] < 0)) continue;
    const view = engine.convertFrame(observer, "OBSERVED", "VIEW", observed);
    // A perspective divide alone puts the opposite hemisphere at the same
    // screen position. Reject it before projecting, including with ground off.
    const point = projectViewVector(view, width, height, fov, projection);
    if (point && point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height) points.set(label.id, point);
  }
  return points;
}
