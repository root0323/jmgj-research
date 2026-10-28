import { useEffect, useId, useRef, useState } from 'react';
import { native } from './native';
type UpdateState = { status: string; version: string; targetVersion?: string; bytes?: number; progress: number; message: string; installAllowed?: boolean };
export function UpdateWindow({ version, onClose }: { version: string; onClose: () => void }) {
  const title = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<UpdateState>({ status: 'checking', version, progress: 0, message: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const previous = document.activeElement;
    dialog.current?.showModal();
    const apply = (value: Record<string, unknown>) => { if (active) setState(value as unknown as UpdateState); };
    native('updateCheck').then(apply).catch(() => { if (active) setState({ status: 'error', version, progress: 0, message: '업데이트 서버에 연결하지 못했습니다. 다시 확인해 주세요.' }); });
    const interval = setInterval(() => native('updateState').then(apply).catch(() => {}), 800);
    return () => { active = false; clearInterval(interval); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [version]);
  async function act(action: string) {
    setBusy(true);
    try { setState(await native(action) as unknown as UpdateState); }
    catch { setState(current => ({ ...current, status: 'error', message: '연결이 중단되었습니다. 다시 확인해 주세요.' })); }
    finally { setBusy(false); }
  }
  const downloading = state.status === 'downloading';
  const checking = state.status === 'checking';
  const ready = state.status === 'ready' || state.status === 'permission';
  return <dialog ref={dialog} className="update-window" aria-labelledby={title} onCancel={e => { e.preventDefault(); onClose(); }}>
    <header><h2 id={title}>앱 업데이트</h2><button aria-label="업데이트 창 닫기" onClick={onClose}>×</button></header>
    <div className="update-content">
      <p>현재 버전 <strong>{state.version}</strong></p>
      {state.targetVersion && <p>새 버전 <strong>{state.targetVersion}</strong>{state.bytes ? ` · 약 ${Math.ceil(state.bytes / 1_000_000)}MB` : ''}</p>}
      <p role="status" aria-live="polite">{checking ? '새 버전을 확인하고 있습니다…' : downloading ? `다운로드 중… ${state.progress}%` : ready ? state.message || '다운로드가 완료됐습니다. 설치 버튼을 눌러 주세요.' : state.status === 'available' ? '새 업데이트가 있습니다.' : state.message}</p>
      {downloading && <progress aria-label="업데이트 다운로드" max={100} value={state.progress} />}
      <p className="update-note">업데이트 후에도 장비 설정과 저장한 지역 자료는 유지됩니다. 설치는 Android 확인 화면에서 직접 진행합니다.</p>
      <div className="update-actions">
        <button disabled={busy || checking || downloading} onClick={() => void act(ready ? 'updateInstall' : state.status === 'available' ? 'updateDownload' : 'updateCheck')}>
          {ready ? '업데이트 설치' : state.status === 'available' ? '다운로드' : '다시 확인'}
        </button>
        <button onClick={onClose}>{downloading ? '백그라운드로 받기' : '닫기'}</button>
      </div>
    </div>
  </dialog>;
}
