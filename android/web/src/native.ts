export type Capabilities = { android: boolean; compass: boolean; version: string };
declare global {
  interface Window {
    AstroSkyAndroid?: { postMessage: (json: string) => void };
    __astroskyResult?: (id: number, result: Record<string, unknown>) => void;
    __astroskyDirection?: (azimuth: number, altitude: number, accuracy: number) => void;
    __astroskyBack?: () => boolean;
  }
}
let sequence = 0;
const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
window.__astroskyResult = (id, value) => {
  const work = pending.get(id); if (!work) return;
  pending.delete(id); clearTimeout(work.timer);
  if (typeof value.error === 'string') work.reject(new Error(value.error)); else work.resolve(value);
};
export function native(action: string, payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (!window.AstroSkyAndroid) return Promise.reject(new Error('Android 연결이 없습니다.'));
  if (signal?.aborted) return Promise.reject(signal.reason);
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('연결 시간이 초과됐습니다.')); }, action === 'updateDownload' ? 30 * 60_000 : action === 'download' ? 180_000 : 90_000);
    pending.set(id, { resolve, reject, timer });
    signal?.addEventListener('abort', () => { const work = pending.get(id); if (!work) return; clearTimeout(work.timer); pending.delete(id); reject(signal.reason); }, { once: true });
    window.AstroSkyAndroid!.postMessage(JSON.stringify({ id, action, ...payload }));
  });
}
export async function remote(url: string, signal?: AbortSignal): Promise<Response> {
  const result = await native('request', { url }, signal);
  const bytes = Uint8Array.from(atob(result.body as string), c => c.charCodeAt(0));
  return new Response(bytes, { status: result.status as number, headers: result.headers as Record<string, string> });
}
export async function download(url: string, name: string, hash = '', bytes = 0) {
  const result = await native('download', { url, name, hash, bytes });
  return result.path as string;
}
