export const REGIONAL_CACHE = 'astrosky-regional-v1';
export const DATA_PREFIX = '/regional-data/';
const inFlight = new Map<string, Promise<string>>();
const FILE = /^(?:tileList\.txt|[A-Za-z0-9_.-]+\.(?:tif|h5))$/;
export async function validData(response: Response, hash: string, size: number) {
  if (!response.ok || response.type === 'opaque') return false;
  const data = await response.arrayBuffer();
  if (!data.byteLength || data.byteLength > 128 * 1024 * 1024 || (size && data.byteLength !== size)) return false;
  if (hash) {
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') === hash;
  }
  // Reject login/error pages even when the upstream returns HTTP 200.
  const b = new Uint8Array(data);
  return b[0] !== 60 && b[0] !== 123;
}
export function downloadRegion(url: string, name: string, hash: string, size: number, request: (url: string) => Promise<Response>) {
  if (!FILE.test(name) || !/^(?:[a-f0-9]{64})?$/.test(hash) || !Number.isSafeInteger(size) || size < 0) return Promise.reject(Error('자료 정보가 올바르지 않습니다.'));
  const key = new URL(DATA_PREFIX + name, location.origin).href;
  const pending = inFlight.get(key); if (pending) return pending;
  const work = (async () => {
    const cache = await caches.open(REGIONAL_CACHE), saved = await cache.match(key);
    if (saved && await validData(saved.clone(), hash, size)) return DATA_PREFIX + name;
    if (saved) await cache.delete(key);
    const response = await request(url);
    if (!await validData(response.clone(), hash, size)) throw Error('지역 자료 검증에 실패했습니다. 다시 시도해 주세요.');
    const headers = new Headers(response.headers);
    headers.set('X-AstroSky-Source', new URL(url).origin);
    await cache.put(key, new Response(response.body, { status: 200, headers }));
    return DATA_PREFIX + name;
  })().catch(error => {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') throw Error('저장 공간이 부족합니다. 설정의 앱 업데이트·저장소에서 지역 자료를 정리해 주세요.');
    throw error;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, work); return work;
}
