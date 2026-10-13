import { browserCredentials } from '@/lib/personal-settings';
import { BrowserOrientation, type OrientationSample } from './orientation';
import { downloadRegion } from './storage';
const transport = window.fetch.bind(window);
const credentials = browserCredentials();
const orientation = new BrowserOrientation();
let following = false, generation = 0, lastSample = 0;
function sensor(event: DeviceOrientationEvent) {
  if (!following || document.hidden) return;
  const now = performance.now(); if (now - lastSample < 1000 / 30) return;
  const value = orientation.sample(event as OrientationSample); if (!value) return;
  lastSample = now;
  window.__astroskyDirection?.(value.azimuth, value.altitude, value.accuracy, generation);
}
function reset() { orientation.reset(); lastSample = 0; }
export async function requestRemote(url: string) {
  return transport('/bridge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), cache: 'no-store', redirect: 'error' });
}
export async function initializeBrowser() {
  if (!isSecureContext || !('serviceWorker' in navigator)) throw Error('HTTPS와 최신 Safari가 필요합니다.');
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  window.AstroSkyPWA = true;
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('저장소 준비에 실패했습니다. 화면을 다시 열어 주세요.')), 20_000);
    navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  document.addEventListener('visibilitychange', reset);
  window.addEventListener('deviceorientation', sensor);
  window.addEventListener('deviceorientationabsolute', sensor);
  window.AstroSkyAndroid = {
    postMessage(json) {
      const payload = JSON.parse(json) as Record<string, unknown>;
      const respond = (value: Record<string, unknown>) => window.__astroskyResult?.(payload.id as number, value);
      // Run permission synchronously in the initiating click, before any await.
      let permission: Promise<string> | undefined;
      if (payload.action === 'permission') {
        const api = DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };
        permission = api.requestPermission ? api.requestPermission() : Promise.resolve('granted');
      }
      (async () => {
        switch (payload.action) {
          case 'capabilities': return { android: false, pwa: true, compass: typeof DeviceOrientationEvent !== 'undefined', version: __APP_VERSION__ };
          case 'permission': if (await permission !== 'granted') throw Error('방향 센서 권한이 필요합니다.'); return {};
          case 'follow': following = Boolean(payload.enabled); generation = Number(payload.generation); reset(); return {};
          case 'credential': {
            switch (payload.operation) {
              case 'read': return { key: await credentials.read() };
              case 'save': await credentials.save(String(payload.key)); return {};
              case 'clear': await credentials.clear(); return {};
              default: throw Error('지원하지 않는 저장 요청입니다.');
            }
          }
          case 'request': {
            const response = await requestRemote(String(payload.url));
            const data = new Uint8Array(await response.arrayBuffer());
            if (data.byteLength > 12 * 1024 * 1024) throw Error('응답 용량이 너무 큽니다.');
            let binary = ''; for (let offset = 0; offset < data.length; offset += 8192) binary += String.fromCharCode(...data.subarray(offset, offset + 8192));
            return { body: btoa(binary), status: response.status, headers: Object.fromEntries(response.headers) };
          }
          case 'download': return { path: await downloadRegion(String(payload.url), String(payload.name), String(payload.hash ?? ''), Number(payload.bytes ?? 0), requestRemote) };
          default: throw Error('지원하지 않는 앱 요청입니다.');
        }
      })().then(respond).catch(() => respond({ error: payload.action === 'credential' ? '개인 키 저장소를 확인해 주세요.' : '연결 또는 저장에 실패했습니다. 네트워크와 저장 공간을 확인해 주세요.' }));
    },
  };
  // Same update origin forever: updates preserve keys, gear and regional caches.
  window.__pwaRegistration = registration;
}
declare global { const __APP_VERSION__: string; interface Window { __pwaRegistration?: ServiceWorkerRegistration } }
