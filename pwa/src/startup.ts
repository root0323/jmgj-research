/** Reuse an installed worker offline; update checks do not block startup. */
export async function prepareStorage(workers: ServiceWorkerContainer, origin: string, timeout = 20_000) {
  let registration = await workers.getRegistration('/');
  if (registration?.active?.scriptURL !== new URL('/sw.js', origin).href) {
    registration = await workers.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  } else {
    void registration.update().catch(() => {});
  }
  if (!workers.controller) await new Promise<void>((resolve, reject) => {
    const finish = () => { if (!workers.controller) return; clearTimeout(timer); workers.removeEventListener('controllerchange', finish); resolve(); };
    const timer = setTimeout(() => { workers.removeEventListener('controllerchange', finish); reject(Error('저장소 준비에 실패했습니다. 화면을 다시 열어 주세요.')); }, timeout);
    workers.addEventListener('controllerchange', finish);
    registration!.active?.postMessage({ type: 'CLAIM_CLIENT' });
    finish();
  });
  return registration;
}
