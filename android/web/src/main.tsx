import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SkyViewer from '@/components/SkyViewer/SkyViewer';
import type { StellariumEngine } from '@/components/SkyViewer/types';
import { trySetValue } from '@/components/SkyViewer/engineControls';
import '@/styles/globals.css';
import { installApi } from './api';
import { native, type Capabilities } from './native';
import { alignedAzimuth, CompassFilter, directionVector, NORTH_OFFSET_KEY, normalizeAzimuth, readNorthOffset } from './compass';
import './mobile.css';
import { UpdateWindow } from './UpdateWindow';

function MobileApp({ capabilities }: { capabilities: Capabilities }) {
  const [engine, setEngine] = useState<StellariumEngine | null>(null);
  const [following, setFollowing] = useState(false);
  const [alignmentOpen, setAlignmentOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [updateOpen, setUpdateOpen] = useState(false);
  const openUpdate = useCallback(() => setUpdateOpen(true), []);
  const [location, setLocation] = useState({ latitude: 37.5665, longitude: 126.978 });
  const filter = useRef(new CompassFilter());
  const generation = useRef(0);
  const rawDirection = useRef<{ azimuth: number; altitude: number; time: number } | null>(null);
  const [sensorReady, setSensorReady] = useState(false);
  const [accuracy, setAccuracy] = useState(3);
  const [northOffset, setNorthOffset] = useState<number | null>(() => readNorthOffset(localStorage));
  const offset = useRef(northOffset);
  const stopFollowing = useCallback(() => {
    generation.current += 1;
    rawDirection.current = null;
    filter.current.reset();
    setSensorReady(false);
    setFollowing(false);
    setAlignmentOpen(false);
  }, []);
  const toggleFollowing = useCallback(() => {
    if (!capabilities.compass) { setMessage('이 기기에는 나침반 센서가 없습니다. 화면을 손으로 움직여 주세요.'); return; }
    if (following) { stopFollowing(); return; }
    rawDirection.current = null;
    filter.current.reset();
    setSensorReady(false);
    setMessage('');
    setFollowing(true);
  }, [capabilities.compass, following, stopFollowing]);
  function setAlignment(value: number | null) {
    offset.current = value;
    setNorthOffset(value);
    filter.current.reset();
    try {
      if (value === null) localStorage.removeItem(NORTH_OFFSET_KEY);
      else localStorage.setItem(NORTH_OFFSET_KEY, String(value));
      setMessage('');
    } catch { setMessage('정렬은 적용했지만 저장하지 못했어요. 다음 실행에서 다시 정렬해 주세요.'); }
    const raw = rawDirection.current;
    if (engine && raw && performance.now() - raw.time < 2000) {
      const next = filter.current.update(alignedAzimuth(raw.azimuth, value), raw.altitude, performance.now());
      if (next) engine.lookAt?.(next, 0);
    }
    setAlignmentOpen(false);
  }
  function alignNorth() {
    const raw = rawDirection.current;
    if (!following || !raw || performance.now() - raw.time > 2000) {
      setMessage('새 방향값을 기다리는 중이에요. 기기를 조금 움직인 뒤 다시 눌러 주세요.'); return;
    }
    if (Math.abs(raw.altitude) > 85) { setMessage('천정 바로 위에서는 북쪽을 정렬하기 어려워요. 북극성 방향으로 기기를 기울여 주세요.'); return; }
    setAlignment(normalizeAzimuth(raw.azimuth));
  }
  const onLocation = useCallback((next: typeof location) => setLocation(next), []);
  useEffect(() => {
    const stream = ++generation.current;
    const directionFilter = filter.current;
    let frame = 0;
    let accuracyValue: number | null = null;
    let pendingDirection: [number, number, number] | null = null;
    let pendingOffset = offset.current;
    window.__astroskyDirection = (azimuth, altitude, sensorAccuracy, sensorGeneration) => {
      if (!following || !engine || stream !== generation.current || sensorGeneration !== stream || document.hidden) return;
      if (!directionVector(azimuth, altitude)) return;
      const first = rawDirection.current === null;
      rawDirection.current = { azimuth, altitude, time: performance.now() };
      if (first) setSensorReady(true);
      if (accuracyValue !== sensorAccuracy) { accuracyValue = sensorAccuracy; setAccuracy(sensorAccuracy); }
      const next = directionFilter.update(alignedAzimuth(azimuth, offset.current), altitude, rawDirection.current.time);
      if (!next) return;
      pendingDirection = next;
      pendingOffset = offset.current;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const direction = pendingDirection;
        pendingDirection = null;
        if (!direction || pendingOffset !== offset.current || stream !== generation.current || document.hidden) return;
        engine.lookAt?.(direction, 0);
      });
    };
    if (following && engine) trySetValue(engine, ['lock'], null);
    native('follow', { enabled: following, generation: stream, ...location }).catch(() => setMessage('방향 센서 연결을 확인해 주세요.'));
    const reset = () => { rawDirection.current = null; pendingDirection = null; directionFilter.reset(); setSensorReady(false); };
    document.addEventListener('visibilitychange', reset);
    const staleCheck = window.setInterval(() => {
      if (rawDirection.current && performance.now() - rawDirection.current.time > 2000) reset();
    }, 1000);
    return () => {
      window.__astroskyDirection = undefined;
      if (frame) cancelAnimationFrame(frame);
      clearInterval(staleCheck);
      document.removeEventListener('visibilitychange', reset);
      rawDirection.current = null;
      directionFilter.reset();
      native('follow', { enabled: false, generation: stream, ...location }).catch(() => {});
    };
  }, [following, engine, location]);
  useEffect(() => {
    window.__astroskyBack = () => {
      const dialog = document.querySelector<HTMLDialogElement>('.update-window[open], dialog[open]');
      if (dialog) { dialog.dispatchEvent(new Event('cancel', { cancelable: true })); return true; }
      if (alignmentOpen) { setAlignmentOpen(false); setMessage(''); return true; }
      if (following) { stopFollowing(); return true; }
      const panel = document.querySelector<HTMLButtonElement>('button[aria-label="관측 패널 닫기"]');
      if (panel) { panel.click(); return true; }
      return false;
    };
    return () => { window.__astroskyBack = undefined; };
  }, [alignmentOpen, following, stopFollowing]);
  useEffect(() => {
    if (!alignmentOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setAlignmentOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [alignmentOpen]);
  // Sensor status and the alignment panel need not rebuild the sky's React tree.
  const sky = useMemo(() => <SkyViewer mobile onEngineReady={setEngine} onLocationChange={onLocation} onAppUpdate={openUpdate} appVersion={capabilities.version} compassFollowing={following} onManualViewChange={stopFollowing} compassControl={
      <button type="button" className="compass-button" aria-label="나침반 따라가기" title="나침반 따라가기" aria-pressed={following} disabled={!engine} onClick={toggleFollowing}>
        <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M21 7l-2 12-12 6 6-12z" fill="currentColor"/><path d="M16 16l5-9-2 12z" fill="#071426"/></svg>
      </button>
    } />, [engine, following, capabilities.version, onLocation, openUpdate, stopFollowing, toggleFollowing]);
  return <main className="mobile-app">
    {sky}
    <aside className="compass-controls">
      {following && <button type="button" className="alignment-toggle" aria-expanded={alignmentOpen} aria-controls="north-alignment" onClick={() => { setAlignmentOpen(open => !open); setMessage(''); }}>
        북쪽 정렬 {northOffset !== null && <span aria-label="정렬 적용됨">✓</span>}
      </button>}
      {following && alignmentOpen && <section id="north-alignment" className="compass-alignment" aria-label="나침반 정렬">
        <header><strong>북쪽 정렬</strong><button type="button" aria-label="정렬 창 닫기" onClick={() => { setAlignmentOpen(false); setMessage(''); }}>×</button></header>
        <p>{sensorReady ? '후면 카메라를 북극성 쪽으로 향한 뒤 정렬하세요.' : '새 방향값을 기다리는 중…'}</p>
        <div><button type="button" disabled={!sensorReady} onClick={alignNorth}>현재 방향 정렬</button>
          <button type="button" disabled={northOffset === null} onClick={() => setAlignment(null)}>정렬 초기화</button></div>
        {northOffset !== null && <small>북쪽 정렬 적용됨</small>}
        {accuracy < 2 && <small role="status">센서 정확도 낮음 · 기기를 8자 모양으로 움직여 주세요.</small>}
        {message && <small role="status">{message}</small>}
      </section>}
      {message && !alignmentOpen && <p role="status">{message}<button aria-label="안내 닫기" onClick={() => setMessage('')}>×</button></p>}
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
