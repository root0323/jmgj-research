import { useEffect, useId, useRef, useState } from 'react';
import { REGIONAL_CACHE } from './storage';
type OfflineState = { done: number; total: number; ready: boolean; error?: string };
export function UpdateWindow({ version, onClose }: { version: string; onClose: () => void }) {
  const title = useId(), dialog = useRef<HTMLDialogElement>(null);
  const [offline, setOffline] = useState<OfflineState>({ done: 0, total: 0, ready: false });
  const [busy, setBusy] = useState(false), [waiting, setWaiting] = useState(false), [message, setMessage] = useState('');
  const [usage, setUsage] = useState<{ usage?: number; quota?: number; persistent?: boolean }>({});
  useEffect(() => {
    const previous = document.activeElement; dialog.current?.showModal();
    const registration = window.__pwaRegistration;
    const update = () => setWaiting(Boolean(registration?.waiting));
    const updateFound = () => registration?.installing?.addEventListener('statechange', update);
    const receive = (event: MessageEvent) => { if (event.data?.type === 'OFFLINE_STATE') { setOffline(event.data); setBusy(Boolean(event.data.running)); } };
    navigator.serviceWorker.addEventListener('message', receive);
    registration?.addEventListener('updatefound', updateFound);
    update();
    navigator.serviceWorker.controller?.postMessage({ type: 'OFFLINE_STATE' });
    registration?.update().then(update).catch(() => setMessage('업데이트 서버에 연결하지 못했습니다. 저장한 자료로 계속 사용할 수 있습니다.'));
    navigator.storage?.estimate().then(value => setUsage(value));
    return () => { navigator.serviceWorker.removeEventListener('message', receive); registration?.removeEventListener('updatefound', updateFound); registration?.installing?.removeEventListener('statechange', update); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  async function prepare() {
    setBusy(true); setMessage('');
    try { const persistent = await navigator.storage?.persist?.(); const value = await navigator.storage?.estimate(); setUsage({ ...value, persistent }); } catch { /* The cache can still work without persistent mode. */ }
    navigator.serviceWorker.controller?.postMessage({ type: 'PREPARE_OFFLINE' });
  }
  function applyUpdate() {
    const registration = window.__pwaRegistration; if (!registration?.waiting) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    registration.waiting.postMessage({ type: 'APPLY_UPDATE' });
  }
  async function clearRegions() {
    await caches.delete(REGIONAL_CACHE);
    setMessage('지역 자료를 정리했습니다. 선택한 장소의 자료는 다시 받습니다. 장비·장소·개인 키는 유지됩니다.');
    setUsage(await navigator.storage.estimate());
  }
  return <dialog ref={dialog} className="update-window" aria-labelledby={title} onCancel={e => { e.preventDefault(); onClose(); }}>
    <header><h2 id={title}>앱 설치·업데이트·저장소</h2><button aria-label="업데이트 창 닫기" onClick={onClose}>×</button></header>
    <div className="update-content">
      <p>현재 버전 <strong>{version}</strong></p>
      <p className="pwa-instructions">아이폰·아이패드에서는 Safari의 공유 메뉴에서 <strong>홈 화면에 추가</strong>를 선택해 주세요. 홈 화면 아이콘으로 실행하면 앱처럼 사용할 수 있습니다.</p>
      <p role="status">{offline.error || (offline.ready ? '기본 화면·계산 엔진의 오프라인 준비가 완료되었습니다.' : busy ? `오프라인 준비 중… ${offline.done}/${offline.total}` : '오프라인 사용 준비를 누르면 화면과 계산 엔진을 기기에 저장합니다.')}</p>
      {busy && <progress aria-label="오프라인 자료 저장" max={offline.total || 1} value={offline.done} />}
      <p className="update-note">지역 지형·야간광은 장소를 선택할 때 저장합니다. 저장하지 않은 지역·사진과 새 기상·시상 조회에는 인터넷이 필요합니다. 자료 준비가 끝날 때까지 이 화면을 열어 두세요.</p>
      <p className="pwa-storage">저장 사용량 약 {Math.ceil((usage.usage ?? 0) / 1_000_000)}MB{usage.quota ? ` / 할당 한도 약 ${Math.floor(usage.quota / 1_000_000)}MB` : ''}{usage.persistent === true ? ' · 영구 저장 허용됨' : usage.persistent === false ? ' · 영구 저장이 허용되지 않았습니다.' : ''}</p>
      {message && <p role="status">{message}</p>}
      {waiting && <p>새 버전이 준비되었습니다. 업데이트 적용 후에도 저장한 설정·지역 자료는 유지됩니다.</p>}
      <div className="update-actions">
        <button disabled={busy} onClick={() => void prepare()}>오프라인 사용 준비</button>
        {waiting && <button onClick={applyUpdate}>업데이트 적용</button>}
        <button disabled={busy} onClick={() => void clearRegions()}>지역 자료 정리</button>
        <button onClick={onClose}>닫기</button>
      </div>
    </div>
  </dialog>;
}
