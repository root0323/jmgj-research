import { download } from './native';
import { validLocation } from '@/lib/meteoblue';

type State = { enabled: true; state: string; message: string; dem?: boolean; blackMarble?: boolean };
const states = new Map<string, State>();
const retries = new Map<string, number>();
let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
function modelWorker() {
  if (worker) return worker;
  worker = new Worker('/mobile-model/worker.js');
  worker.onmessage = async ({ data }) => {
    if (data.download) {
      try { const path = await download(data.url, data.name, data.hash ?? '', data.bytes ?? 0); worker!.postMessage({ downloadResult: data.id, path }); }
      catch (e) { worker!.postMessage({ downloadResult: data.id, error: e instanceof Error ? e.message : '자료 다운로드 실패' }); }
      return;
    }
    if (data.progress) { const state = states.get(data.key); if (state) state.message = data.progress; return; }
    const work = pending.get(data.id); if (!work) return;
    pending.delete(data.id); if (data.error) work.reject(new Error(data.error)); else work.resolve(data.value);
  };
  worker.onerror = () => {
    for (const work of pending.values()) work.reject(new Error('계산 준비에 실패했습니다. 앱을 다시 열어 주세요.'));
    pending.clear(); worker?.terminate(); worker = null;
  };
  return worker;
}
function call(action: string, payload: unknown): Promise<unknown> {
  const id = ++sequence;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); modelWorker().postMessage({ id, action, payload }); });
}
export function terrainState(location: unknown, retry = 0): State {
  if (!validLocation(location)) return { enabled: true, state: 'error', message: '관측 위치를 확인하세요.' };
  const key = `${location.latitude.toFixed(6)},${location.longitude.toFixed(6)}`;
  if (retries.get(key) !== retry && states.get(key)?.state === 'error') states.delete(key);
  retries.set(key, retry);
  const current = states.get(key); if (current) return current;
  if ([...states.values()].some(value => value.state === 'running')) return { enabled: true, state: 'waiting', message: '이전 장소의 자료를 저장한 뒤 준비합니다…' };
  const state: State = { enabled: true, state: 'running', message: '기기 내 계산·지역 자료 준비 중…' }; states.set(key, state);
  call('prepare', { ...location, key }).then(value => {
    for (const old of (value as { evicted?: string[] }).evicted ?? []) states.delete(old);
    states.set(key, { enabled: true, state: 'ready', message: '지형·야간광 자료 준비됨', dem: true, blackMarble: true });
  })
    .catch(e => states.set(key, { enabled: true, state: 'error', message: e.message }));
  return state;
}
export async function evaluateModel(payload: unknown, signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason;
  const value = await call('evaluate', payload);
  if (signal?.aborted) throw signal.reason;
  return value;
}
