import { getFallbackSkyBrightness, type SkyBrightnessDirection } from "@/components/SkyViewer/difficulty";
import { isObject, modelResponses, type JsonObject, type WeatherSnapshot } from "./meteoblue";

function parseTime(value: unknown): number {
  if (typeof value === "number") return value * 1000;
  if (typeof value !== "string") return NaN;
  const iso = value.replace(" ", "T");
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}+09:00`);
}

function interpolate(block: JsonObject | null, variable: string, target: number): number | null {
  if (!block || !Array.isArray(block.time) || !Array.isArray(block[variable])) return null;
  const times = block.time.map(parseTime);
  const values = block[variable] as unknown[];
  if (target < times[0] || target > times[times.length - 1]) return null;
  const valueAt = (i: number) => {
    const value = values[i];
    return typeof value === "number" && Number.isFinite(value) && value > -900 ? value : null;
  };
  for (let i = 0; i < times.length; i++) {
    if (target === times[i]) return valueAt(i);
    if (i > 0 && target < times[i]) {
      const a = valueAt(i - 1), b = valueAt(i);
      if (a === null || b === null || times[i] <= times[i - 1]) return null;
      return a + (b - a) * (target - times[i - 1]) / (times[i] - times[i - 1]);
    }
  }
  return null;
}

function blockFrom(data: unknown, ...names: string[]): JsonObject | null {
  if (!isObject(data)) return null;
  for (const name of names) if (isObject(data[name])) return data[name];
  return null;
}

export function weatherAt(snapshot: WeatherSnapshot, time: Date) {
  const responses = modelResponses(snapshot);
  const seeing = interpolate(blockFrom(responses.p1, "data_1h"), "seeing_arcsec", time.getTime());
  const aod = interpolate(blockFrom(responses.p2, "data_1h", "data_3h"), "aod550", time.getTime());
  const cloudBlock = blockFrom(responses.p3, "gfsensemble_1h", "data_1h", "data_3h");
  const clouds = cloudBlock?.totalcloudcover;
  let cloud: number | null = null;
  if (Array.isArray(clouds) && Array.isArray(clouds[0])) {
    const values = clouds.map((member) => interpolate({ ...cloudBlock, totalcloudcover: member }, "totalcloudcover", time.getTime()));
    const valid = values.filter((value): value is number => value !== null);
    if (valid.length) cloud = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  } else cloud = interpolate(cloudBlock, "totalcloudcover", time.getTime());
  const pressure = interpolate(blockFrom(responses.p4, "data_1h", "data_3h"), "convectivecloudbase_pressure", time.getTime());
  return { seeingArcsec: seeing !== null && seeing > 0 ? seeing : null, aod: aod !== null && aod >= 0 ? aod : null,
    cloudCover: cloud !== null && cloud >= 0 && cloud <= 100 ? cloud : null, cloudBasePressure: pressure };
}

export async function evaluateWeather(snapshot: WeatherSnapshot, time: Date, direction: SkyBrightnessDirection | null, signal: AbortSignal) {
  const values = weatherAt(snapshot, time);
  const base = getFallbackSkyBrightness(snapshot.location.latitude, snapshot.location.longitude);
  const cloudFraction = (values.cloudCover ?? 0) / 100;
  const fallback = {
    sqm: Math.max(14, Math.min(23, base + (base < 20 ? -1.2 : 0.35) * cloudFraction)),
    seeingArcsec: values.seeingArcsec,
    source: values.cloudCover === null ? "간이 추정 · 해당 시각 기상 자료 없음" : "간이 추정 · 저장 기상 자료 사용",
  };
  // Missing fields must not silently become clear sky in the scientific model.
  if (values.aod === null || values.cloudCover === null) return fallback;
  try {
    const response = await fetch("/api/research/evaluate", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ location: snapshot.location, datetime: time.toISOString(),
        altitude: direction?.altitude, azimuth: direction?.azimuth, responses: modelResponses(snapshot) }),
    });
    if (response.ok) {
      const data = await response.json();
      if (typeof data.sqm === "number" && Number.isFinite(data.sqm)) return {
        sqm: data.sqm,
        seeingArcsec: values.seeingArcsec,
        source: data.source === "black-marble-dem" ? "Black Marble·DEM 연구 모델 · 저장 자료 사용" : "간이 추정 · 저장 기상 자료 사용",
      };
    }
  } catch { /* This route never fetches paid weather; local estimates remain available. */ }
  return fallback;
}
