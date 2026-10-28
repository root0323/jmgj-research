import {
  isObject, WEATHER_PLANS,
  type PackageResult, type WeatherLocation, type WeatherPlan, type WeatherSnapshot,
} from "./meteoblue";

const BASE = "https://my.meteoblue.com";
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;

async function readJson(response: Response) {
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) throw new Error("response too large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function upstreamError(status: number) {
  if (status === 401 || status === 403) return "API 키 또는 이 패키지의 사용 권한을 확인하세요.";
  if (status === 429) return "요청 제한 또는 크레딧 한도에 도달했습니다. 계정에서 확인하세요.";
  return `Meteoblue 응답 오류 (HTTP ${status}).`;
}

function removeKey(value: unknown, key: string): unknown {
  if (typeof value === "string") return value.replaceAll(key, "[redacted]");
  if (Array.isArray(value)) return value.map((item) => removeKey(item, key));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).filter(([name]) => name.toLowerCase() !== "apikey").map(([name, item]) => [name, removeKey(item, key)]));
  return value;
}

async function fetchPackage(apiKey: string, location: WeatherLocation, name: string): Promise<PackageResult> {
  const url = new URL(`/packages/${name}`, BASE);
  url.search = new URLSearchParams({
    apikey: apiKey, lat: String(location.latitude), lon: String(location.longitude),
    // The existing research parser expects Korean civil time for weather values.
    tz: "Asia/Seoul", format: "json", history_days: "4", forecast_days: "7",
  }).toString();
  let credits = 0;
  let creditSource: PackageResult["creditSource"] = "unknown";
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(25_000), cache: "no-store", redirect: "error" });
    const raw = response.headers.get("MB-Credits-Accounted");
    const headerCredits = raw === null || raw.trim() === "" ? NaN : Number(raw);
    if (Number.isSafeInteger(headerCredits) && headerCredits >= 0) {
      credits = headerCredits;
      creditSource = "header";
    } else if (response.ok) {
      credits = name === "ensemble-1h" ? 16_000 : 8_000;
      creditSource = "estimate";
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { package: name, data: null, credits, creditSource, error: upstreamError(response.status) };
    }
    const data = await readJson(response);
    if (!isObject(data) || !["data_1h", "data_3h", "gfsensemble_1h"].some((key) => {
      const block = data[key];
      return isObject(block) && Array.isArray(block.time) && block.time.length > 0;
    })) {
      return { package: name, data: null, credits, creditSource, error: "사용 가능한 기상 자료가 응답에 없습니다." };
    }
    return { package: name, data: removeKey(data, apiKey) as typeof data, credits, creditSource, error: null };
  } catch {
    // Upstream error messages/URLs can contain the key. Never return or log them.
    return { package: name, data: null, credits, creditSource, error: "연결 실패 또는 응답 형식 오류입니다. 차감 여부는 계정에서 확인하세요." };
  }
}

export async function fetchWeather(apiKey: string, location: WeatherLocation, plan: WeatherPlan): Promise<WeatherSnapshot> {
  const results = await Promise.all(WEATHER_PLANS[plan].packages.map((name) => fetchPackage(apiKey, location, name)));
  return { id: crypto.randomUUID(), plan, location, fetchedAt: new Date().toISOString(), results };
}

export async function fetchAccountHistory(apiKey: string, start: string, end: string) {
  let credits = 0;
  let expectedTotal: number | null = null;
  let seen = 0;
  for (let page = 1; page <= 100; page++) {
    const url = new URL("/account/usage", BASE);
    url.search = new URLSearchParams({ apikey: apiKey, date_start: start, date_end: end, page: String(page), per: "100" }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store", redirect: "error" });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(upstreamError(response.status));
    }
    const payload = await readJson(response);
    if (!isObject(payload) || !Array.isArray(payload.items) || !isObject(payload.metadata)) throw new Error("계정 사용량 응답을 읽을 수 없습니다.");
    const total = payload.metadata.total;
    if (typeof total !== "number" || !Number.isInteger(total) || total < 0 || (expectedTotal !== null && total !== expectedTotal)) throw new Error("계정 사용량이 변경되었습니다. 다시 동기화하세요.");
    expectedTotal = total;
    for (const item of payload.items) {
      if (!isObject(item) || typeof item.request_credits !== "number" || !Number.isSafeInteger(item.request_credits) || item.request_credits < 0) throw new Error("계정 사용량 응답 형식 오류입니다.");
      credits += item.request_credits;
    }
    seen += payload.items.length;
    if (seen === total) return { credits, through: end };
    if (!payload.items.length || seen > total) throw new Error("계정 사용량 페이지가 불완전합니다.");
  }
  throw new Error("계정 사용 내역이 너무 많아 동기화를 완료하지 못했습니다.");
}
