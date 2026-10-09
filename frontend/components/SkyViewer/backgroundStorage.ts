export type BackgroundSettings = { centerAzimuth: number; horizon: number; verticalFov: number };
export type SavedBackground = {
  id: string; revision: string; name: string; settings: BackgroundSettings;
  width: number; height: number; bytes: number; savedAt: string; source: Blob; mask: Blob;
};
export const BACKGROUND_CACHE = "jmgj-background-files-v1";
const DB_NAME = "jmgj-backgrounds-v1";
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("backgrounds", { keyPath: "id" });
      request.result.createObjectStore("settings");
    };
    request.onerror = () => reject(new Error("배경 저장 공간을 열지 못했습니다."));
    request.onsuccess = () => resolve(request.result);
  });
}
async function transact<T>(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode), request = run(tx);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(new Error("배경을 저장하지 못했습니다. 저장 공간을 확인해 주세요."));
      tx.onerror = () => reject(new Error("배경 저장 공간을 읽거나 쓰지 못했습니다."));
    });
  } finally { db.close(); }
}
export function readBackgrounds() { return transact<SavedBackground[]>(["backgrounds"], "readonly", tx => tx.objectStore("backgrounds").getAll()); }
export async function readSelectedBackground(): Promise<string | null> {
  return (await transact<string | undefined>(["settings"], "readonly", tx => tx.objectStore("settings").get("selected"))) ?? null;
}
export function selectBackground(id: string | null) {
  return transact(["settings"], "readwrite", tx => tx.objectStore("settings").put(id, "selected"));
}
export async function prepareBackgroundServiceWorker() {
  if (!navigator.serviceWorker || !window.isSecureContext || !window.caches) throw new Error("이 화면에서는 배경을 저장할 수 없습니다. 설치 앱이나 HTTPS 화면에서 이용해 주세요.");
  await navigator.serviceWorker.register("/background-sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve, reject) => {
      const changed = () => { if (navigator.serviceWorker.controller) { clearTimeout(timeout); navigator.serviceWorker.removeEventListener("controllerchange", changed); resolve(); } };
      const timeout = setTimeout(() => { navigator.serviceWorker.removeEventListener("controllerchange", changed); reject(new Error("배경 준비에 실패했습니다. 앱을 다시 열어 주세요.")); }, 10000);
      navigator.serviceWorker.addEventListener("controllerchange", changed); changed();
    });
  }
}
export function backgroundUrl(revision: string) { return `${location.origin}/user-backgrounds/${revision}`; }
async function deleteTileFiles(revision: string) {
  const cache = await caches.open(BACKGROUND_CACHE), base = backgroundUrl(revision) + "/";
  for (const key of await cache.keys()) if (key.url.startsWith(base)) await cache.delete(key);
}
export async function saveBackground(record: SavedBackground, tiles: Blob[], size: number) {
  await prepareBackgroundServiceWorker();
  if (tiles.length !== 12) throw new Error("배경 변환 결과가 완전하지 않습니다.");
  const cache = await caches.open(BACKGROUND_CACHE), base = backgroundUrl(record.revision);
  try {
    const properties = `hips_version = 1.4\nhips_order = 0\nhips_order_min = 0\nhips_tile_width = ${size}\nhips_tile_format = png\ndataproduct_type = image\nobs_title = User landscape\ntype = landscape\n`;
    await cache.put(`${base}/properties`, new Response(properties, { headers: { "Content-Type": "text/plain" } }));
    for (let i = 0; i < 12; i++) await cache.put(`${base}/Norder0/Dir0/Npix${i}.png`, new Response(tiles[i], { headers: { "Content-Type": "image/png" } }));
    await transact(["backgrounds", "settings"], "readwrite", tx => {
      tx.objectStore("backgrounds").put(record);
      return tx.objectStore("settings").put(record.id, "selected");
    });
  } catch (error) { await deleteTileFiles(record.revision).catch(() => {}); throw error; }
  // A denied persistence request leaves ordinary local storage usable.
  navigator.storage?.persist?.().catch(() => {});
}
export async function removeBackground(record: SavedBackground, isSelected: boolean) {
  await transact(["backgrounds", "settings"], "readwrite", tx => {
    if (isSelected) tx.objectStore("settings").put(null, "selected");
    return tx.objectStore("backgrounds").delete(record.id);
  });
  await deleteTileFiles(record.revision);
}
export function removeBackgroundTiles(record: SavedBackground) { return deleteTileFiles(record.revision); }
export function runBackgroundWorker<T>(message: object, onProgress: (text: string) => void, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker("/background/worker.js", { type: "module" });
    const cleanup = () => { worker.terminate(); signal.removeEventListener("abort", cancel); };
    const cancel = () => { cleanup(); reject(new DOMException("취소됨", "AbortError")); };
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener("abort", cancel, { once: true });
    worker.onerror = () => { cleanup(); reject(new Error("배경 처리가 중단됐습니다. 다시 시도해 주세요.")); };
    worker.onmessage = event => {
      if (event.data.progress) onProgress(event.data.progress);
      else if (event.data.error) { cleanup(); reject(new Error(event.data.error)); }
      else { cleanup(); resolve(event.data.result as T); }
    };
    worker.postMessage(message);
  });
}
