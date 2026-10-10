import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SkyViewer from '@/components/SkyViewer/SkyViewer';
import type { StellariumEngine } from '@/components/SkyViewer/types';
import { trySetValue } from '@/components/SkyViewer/engineControls';
import '@/styles/globals.css';
import { installApi } from './api';
import { native, type Capabilities } from './native';
import { directionVector, smoothVector } from './compass';
import './mobile.css';
import { UpdateWindow } from './UpdateWindow';

function MobileApp({ capabilities }: { capabilities: Capabilities }) {
  const [engine, setEngine] = useState<StellariumEngine | null>(null);
  const [following, setFollowing] = useState(false);
  const [message, setMessage] = useState('');
  const [updateOpen, setUpdateOpen] = useState(false);
  const openUpdate = useCallback(() => setUpdateOpen(true), []);
  const [location, setLocation] = useState({ latitude: 37.5665, longitude: 126.978 });
  const vector = useRef<number[] | null>(null);
  const onLocation = useCallback((next: typeof location) => setLocation(next), []);
  useEffect(() => {
    native('follow', { enabled: following, ...location }).catch(() => setMessage('방향 센서 연결을 확인해 주세요.'));
    if (!following) vector.current = null;
    window.__astroskyDirection = (azimuth, altitude, accuracy) => {
      if (!following || !engine) return;
      const next = directionVector(azimuth, altitude); if (!next) return;
      vector.current = smoothVector(vector.current, next);
      trySetValue(engine, ['lock'], null);
      engine.lookAt?.(vector.current as [number, number, number], 0);
      setMessage(accuracy < 2 ? '나침반 보정 필요 · 기기를 8자 모양으로 움직여 주세요.' : '');
    };
    return () => { window.__astroskyDirection = undefined; native('follow', { enabled: false, ...location }).catch(() => {}); };
  }, [following, engine, location]);
  useEffect(() => {
    window.__astroskyBack = () => {
      const dialog = document.querySelector<HTMLDialogElement>('.update-window[open], dialog[open]');
      if (dialog) { dialog.dispatchEvent(new Event('cancel', { cancelable: true })); return true; }
      if (following) { setFollowing(false); return true; }
      const panel = document.querySelector<HTMLButtonElement>('button[aria-label="관측 패널 닫기"]');
      if (panel) { panel.click(); return true; }
      return false;
    };
    return () => { window.__astroskyBack = undefined; };
  }, [following]);
  return <main className="mobile-app">
    <SkyViewer mobile onEngineReady={setEngine} onLocationChange={onLocation} onAppUpdate={openUpdate} appVersion={capabilities.version} compassControl={
      <button type="button" className="compass-button" aria-label="나침반 따라가기" title="나침반 따라가기" aria-pressed={following} disabled={!engine} onClick={() => capabilities.compass ? setFollowing(v => !v) : setMessage('이 기기에는 나침반 센서가 없습니다. 화면을 손으로 움직여 주세요.')}>
        <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M21 7l-2 12-12 6 6-12z" fill="currentColor"/><path d="M16 16l5-9-2 12z" fill="#071426"/></svg>
      </button>
    } />
    <aside className="compass-controls">
      {message && <p role="status">{message}<button aria-label="안내 닫기" onClick={() => setMessage('')}>×</button></p>}
    </aside>
    {updateOpen && <UpdateWindow version={capabilities.version} onClose={() => setUpdateOpen(false)} />}
  </main>;
}
async function start() {
  try {
    const capabilities = await native('capabilities') as unknown as Capabilities;
    installApi();
    createRoot(document.getElementById('root')!).render(<MobileApp capabilities={capabilities} />);
  } catch {
    document.getElementById('root')!.textContent = 'Android 연결에 실패했습니다. 앱을 다시 열거나 Android System WebView를 업데이트해 주세요.';
  }
}
void start();
