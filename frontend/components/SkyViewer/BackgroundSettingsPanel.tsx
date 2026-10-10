import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { BackgroundController } from "./useBackgrounds";
import { removeBackground, removeBackgroundTiles, runBackgroundWorker, saveBackground, selectBackground } from "./backgroundStorage";
import type { BackgroundSettings, SavedBackground } from "./backgroundStorage";
import styles from "./BackgroundSettingsPanel.module.css";

type Draft = { id?: string; source: Blob; name: string; settings: BackgroundSettings; original: HTMLCanvasElement; mask: HTMLCanvasElement };
type Analysis = { mask: Blob; width: number; height: number; skyFraction: number };
type Tiles = { tiles: Blob[]; size: number; width: number; height: number };
function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("배경 이미지를 만들지 못했습니다.")), "image/png"));
}
function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; return canvas;
}
export function BackgroundSettingsPanel({ backgrounds, onShowGround }: { backgrounds: BackgroundController; onShowGround: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState("");
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const [tool, setTool] = useState<"erase" | "restore">("erase"), [brush, setBrush] = useState(40);
  const [showOriginal, setShowOriginal] = useState(false), [undoCount, setUndoCount] = useState(0);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null), abortRef = useRef<AbortController | null>(null);
  const undoRef = useRef<ImageData[]>([]), pointerRef = useRef<{x: number; y: number; id: number} | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; abortRef.current?.abort(); }; }, []);
  function repaint(value = draft, original = showOriginal) {
    const canvas = previewRef.current;
    if (!canvas || !value) return;
    canvas.width = value.original.width; canvas.height = value.original.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(value.original, 0, 0);
    if (!original) { context.globalCompositeOperation = "destination-in"; context.drawImage(value.mask, 0, 0); context.globalCompositeOperation = "source-over"; }
  }
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !draft) return;
    canvas.width = draft.original.width; canvas.height = draft.original.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(draft.original, 0, 0);
    if (!showOriginal) { context.globalCompositeOperation = "destination-in"; context.drawImage(draft.mask, 0, 0); context.globalCompositeOperation = "source-over"; }
  }, [draft, showOriginal]);
  function snapshot(value: Draft) {
    const maxUndo = Math.max(1, Math.min(5, Math.floor(32_000_000 / (value.mask.width * value.mask.height * 4))));
    undoRef.current.push(value.mask.getContext("2d")!.getImageData(0, 0, value.mask.width, value.mask.height));
    while (undoRef.current.length > maxUndo) undoRef.current.shift();
    setUndoCount(undoRef.current.length);
  }
  async function analyse(value: Draft) {
    if (!mountedRef.current) return;
    abortRef.current?.abort();
    const controller = new AbortController(); abortRef.current = controller;
    setBusy(true); setError(""); setMessage(""); setProgress("하늘 자동 제거 준비 중…");
    try {
      const result = await runBackgroundWorker<Analysis>({action: "analyse", source: value.source, settings: value.settings}, setProgress, controller.signal);
      const bitmap = await createImageBitmap(result.mask);
      if (controller.signal.aborted) { bitmap.close(); return; }
      snapshot(value);
      const context = value.mask.getContext("2d")!;
      context.clearRect(0, 0, value.mask.width, value.mask.height); context.drawImage(bitmap, 0, 0, value.mask.width, value.mask.height); bitmap.close();
      setShowOriginal(false); repaint(value, false);
      setMessage(result.skyFraction < 0.01 ? "하늘을 거의 찾지 못했습니다. 지우기 브러시로 하늘을 보정해 주세요." : result.skyFraction > 0.98 ? "사진 대부분을 하늘로 인식했습니다. 복원 브러시로 지면과 구조물을 확인해 주세요." : "하늘을 제거했습니다. 경계를 확인하고 필요하면 보정해 주세요.");
    } catch (reason) {
      if (!controller.signal.aborted) setError(`하늘 자동 제거에 실패했습니다. 다시 시도하거나 브러시로 보정해 주세요. ${reason instanceof Error ? reason.message : ""}`);
    } finally { if (!controller.signal.aborted) { setBusy(false); setProgress(""); } }
  }
  async function loadSource(source: Blob, name: string, saved?: SavedBackground) {
    if (busy) return;
    setError(""); setMessage("");
    try {
      if (source.size > 50 * 1024 * 1024) throw new Error("50MB 이하의 JPG·PNG 이미지를 선택해 주세요.");
      const bitmap = await createImageBitmap(source);
      if (!mountedRef.current) { bitmap.close(); return; }
      if (bitmap.width < 512 || bitmap.height < 128 || bitmap.width * bitmap.height > 40_000_000) { bitmap.close(); throw new Error("가로 512px 이상, 세로 128px 이상, 4천만 픽셀 이하의 파노라마를 선택해 주세요."); }
      const scale = Math.min(1, 4096 / bitmap.width, 2048 / bitmap.height);
      const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
      const original = makeCanvas(width, height), mask = makeCanvas(width, height);
      original.getContext("2d")!.drawImage(bitmap, 0, 0, width, height); bitmap.close();
      const context = mask.getContext("2d")!;
      context.fillStyle = "white"; context.fillRect(0, 0, width, height);
      if (saved) {
        const savedMask = await createImageBitmap(saved.mask); context.clearRect(0, 0, width, height); context.drawImage(savedMask, 0, 0, width, height); savedMask.close();
      }
      if (!mountedRef.current) return;
      const value: Draft = { id: saved?.id, source, name: name.slice(0, 80), original, mask, settings: saved?.settings ?? {centerAzimuth: 0, horizon: 50, verticalFov: Math.abs(width / height - 2) < 0.05 ? 180 : 90} };
      undoRef.current = []; setUndoCount(0); setDraft(value); setShowOriginal(false);
      if (scale < 1) setMessage("원본을 보관하며, 표시용 배경은 최대 4096×2048 범위로 처리합니다.");
      if (!saved) await analyse(value);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "이미지를 읽지 못했습니다."); }
  }
  function paint(event: PointerEvent<HTMLCanvasElement>, start: boolean) {
    if (!draft || busy || showOriginal || (!start && !pointerRef.current)) return;
    if (start && event.button !== 0) return;
    if (!start && pointerRef.current?.id !== event.pointerId) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * draft.mask.width;
    const y = (event.clientY - bounds.top) / bounds.height * draft.mask.height;
    if (start) { snapshot(draft); event.currentTarget.setPointerCapture(event.pointerId); }
    const previous = pointerRef.current ?? {x, y, id: event.pointerId};
    const context = draft.mask.getContext("2d")!;
    context.globalCompositeOperation = tool === "erase" ? "destination-out" : "source-over";
    context.strokeStyle = "white"; context.lineCap = "round"; context.lineJoin = "round"; context.lineWidth = brush;
    for (const offset of [-draft.mask.width, 0, draft.mask.width]) {
      context.beginPath(); context.moveTo(previous.x + offset, previous.y); context.lineTo(x + offset + 0.001, y); context.stroke();
    }
    context.globalCompositeOperation = "source-over"; pointerRef.current = {x, y, id: event.pointerId}; repaint();
  }
  async function apply() {
    if (!draft || busy || !draft.name.trim()) return;
    const value = draft, previous = backgrounds.records.find(record => record.id === value.id);
    const controller = new AbortController(); abortRef.current = controller;
    setBusy(true); setError(""); setMessage("");
    try {
      const mask = await canvasBlob(value.mask);
      const result = await runBackgroundWorker<Tiles>({action: "tiles", source: value.source, mask, settings: value.settings}, setProgress, controller.signal);
      if (controller.signal.aborted) return;
      setProgress("앱에 배경 저장 중…");
      const record: SavedBackground = {id: value.id ?? crypto.randomUUID(), revision: crypto.randomUUID(), name: value.name.trim(), settings: {...value.settings}, width: result.width, height: result.height, savedAt: new Date().toISOString(), source: value.source, mask, bytes: value.source.size + mask.size + result.tiles.reduce((sum, tile) => sum + tile.size, 0)};
      await saveBackground(record, result.tiles, result.size);
      await backgrounds.refresh(); onShowGround();
      setDraft({...value, id: record.id}); setMessage("배경을 저장하고 적용했습니다. 앱을 다시 열어도 유지됩니다.");
      if (previous) await removeBackgroundTiles(previous).catch(() => {});
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "배경 저장에 실패했습니다."); }
    finally { if (!controller.signal.aborted) { setBusy(false); setProgress(""); } }
  }
  async function choose(id: string | null) {
    try { await selectBackground(id); await backgrounds.refresh(); onShowGround(); setError(""); }
    catch { setError("배경 선택을 저장하지 못했습니다."); }
  }
  async function remove(record: SavedBackground) {
    try {
      await removeBackground(record, record.id === backgrounds.selected); await backgrounds.refresh(); setDeleteId(null);
      if (draft?.id === record.id) { setDraft(null); undoRef.current = []; setUndoCount(0); }
    } catch { setError("배경을 삭제하지 못했습니다. 다시 시도해 주세요."); }
  }
  return <div className={styles.panel}>
    <p>360° 파노라마를 추가하면 하늘을 자동으로 지웁니다. 사진과 배경은 이 앱에 저장됩니다.</p>
    <label className={styles.upload}>파노라마 추가<input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" disabled={busy}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void loadSource(file, file.name.replace(/\.[^.]+$/, "")); }} /></label>
    <small>JPG·PNG · 50MB 이하 · 360° 촬영 사진. 표시용 최대 4096×2048px, 원본은 별도 보관.</small>
    {draft && <section className={styles.editor} aria-label="배경 편집">
      <label>배경 이름<input maxLength={80} value={draft.name} disabled={busy} onChange={event => setDraft({...draft, name: event.target.value})} /></label>
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => void analyse(draft)}>하늘 자동 제거</button>
        <button type="button" aria-pressed={showOriginal} disabled={busy} onClick={() => setShowOriginal(!showOriginal)}>{showOriginal ? "제거 결과 보기" : "원본 보기"}</button>
      </div>
      <canvas ref={previewRef} className={styles.preview} aria-label="배경 미리보기·브러시 보정" onPointerDown={event => paint(event, true)} onPointerMove={event => paint(event, false)}
        onPointerUp={event => { pointerRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { pointerRef.current = null; }} />
      <div className={styles.actions}>
        <button type="button" aria-pressed={tool === "erase"} disabled={busy || showOriginal} onClick={() => setTool("erase")}>지우기</button>
        <button type="button" aria-pressed={tool === "restore"} disabled={busy || showOriginal} onClick={() => setTool("restore")}>복원</button>
        <button type="button" disabled={busy || !undoCount} onClick={() => { const image = undoRef.current.pop(); if (image) draft.mask.getContext("2d")!.putImageData(image, 0, 0); setUndoCount(undoRef.current.length); repaint(); }}>되돌리기</button>
      </div>
      <label className={styles.range}>브러시 크기 <input type="range" min={4} max={160} value={brush} onChange={event => setBrush(Number(event.target.value))} disabled={busy} /><span>{brush}px</span></label>
      <p>체크 무늬는 투명한 하늘입니다. 나뭇가지나 건물 경계가 잘못 지워졌다면 복원해 주세요.</p>
      <div className={styles.fields}>
        <label>사진 가운데 방위각(°)<input type="number" min={0} max={360} step={1} disabled={busy} value={draft.settings.centerAzimuth} onChange={event => setDraft({...draft, settings: {...draft.settings, centerAzimuth: Math.max(0, Math.min(360, Number(event.target.value) || 0))}})} /></label>
        <label>사진의 세로 범위(°)<input type="number" min={10} max={180} step={1} disabled={busy} value={draft.settings.verticalFov} onChange={event => setDraft({...draft, settings: {...draft.settings, verticalFov: Math.max(10, Math.min(180, Number(event.target.value) || 10))}})} /></label>
      </div>
      <label className={styles.range}>수평선 위치 <input type="range" min={0} max={100} step={0.1} disabled={busy} value={draft.settings.horizon} onChange={event => setDraft({...draft, settings: {...draft.settings, horizon: Number(event.target.value)}})} /><span>{draft.settings.horizon}%</span></label>
      <small>방위각: 북쪽 0° · 동쪽 90° · 남쪽 180° · 서쪽 270°. 전체 구면 사진은 세로 180°, 수평선 50%입니다. 가로 파노라마는 실제 촬영 범위에 맞춰 조정하세요.</small>
      <div className={styles.actions}>
        <button type="button" disabled={busy || !draft.name.trim() || backgrounds.loading} onClick={() => void apply()}>저장하고 적용</button>
        <button type="button" disabled={busy} onClick={() => { setDraft(null); undoRef.current = []; setUndoCount(0); }}>편집 닫기</button>
      </div>
    </section>}
    {busy && <div className={styles.progress} role="status"><span>{progress}</span><button type="button" disabled={progress === "앱에 배경 저장 중…"} onClick={() => { abortRef.current?.abort(); setBusy(false); setProgress(""); setMessage("처리를 취소했습니다."); }}>취소</button></div>}
    {message && <p role="status">{message}</p>}
    {(error || backgrounds.error) && <p className={styles.error} role="alert">{error || backgrounds.error}</p>}
    <section className={styles.saved} aria-label="저장한 배경">
      <h4>저장한 배경</h4>
      <div className={styles.savedRow}><div><strong>기본 자연 배경</strong><small>Guéreins</small></div><button type="button" disabled={busy || backgrounds.loading} aria-pressed={!backgrounds.selected} onClick={() => void choose(null)}>{!backgrounds.selected ? "적용 중" : "적용"}</button></div>
      {backgrounds.records.map(record => <div key={record.id} className={styles.savedRow}>
        <div><strong>{record.name}</strong><small>{record.width}×{record.height} · {(record.bytes / 1024 / 1024).toFixed(1)}MB</small></div>
        <button type="button" disabled={busy} aria-pressed={record.id === backgrounds.selected} onClick={() => void choose(record.id)}>{record.id === backgrounds.selected ? "적용 중" : "적용"}</button>
        <button type="button" disabled={busy} onClick={() => void loadSource(record.source, record.name, record)}>편집</button>
        <button type="button" disabled={busy} onClick={() => deleteId === record.id ? void remove(record) : setDeleteId(record.id)}>{deleteId === record.id ? "삭제 확인" : "삭제"}</button>
        {deleteId === record.id && <button type="button" onClick={() => setDeleteId(null)}>취소</button>}
      </div>)}
    </section>
  </div>;
}
