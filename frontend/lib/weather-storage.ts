import { isObject, newLedger, type CreditLedger, type WeatherSnapshot } from "./meteoblue";

const memory = new Map<string, WeatherSnapshot>();
const ledgerMemory = new Map<string, CreditLedger>();
const LEDGER_PREFIX = "jmgj-weather-credits-v1:";

async function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("jmgj-personal-weather", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("forecasts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("cache blocked"));
  });
}

export async function readWeather(key: string): Promise<WeatherSnapshot | null> {
  if (memory.has(key)) return memory.get(key)!;
  let db: IDBDatabase | undefined;
  try {
    db = await openCache();
    const snapshot = await new Promise<WeatherSnapshot | undefined>((resolve, reject) => {
      const request = db!.transaction("forecasts", "readonly").objectStore("forecasts").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (snapshot && Array.isArray(snapshot.results) && Number.isFinite(Date.parse(snapshot.fetchedAt))) {
      memory.set(key, snapshot);
      return snapshot;
    }
  } catch { /* Cache failure must not trigger a paid request automatically. */ }
  finally { db?.close(); }
  return null;
}

export async function saveWeather(key: string, snapshot: WeatherSnapshot): Promise<boolean> {
  memory.set(key, snapshot);
  let db: IDBDatabase | undefined;
  try {
    db = await openCache();
    await new Promise<void>((resolve, reject) => {
      const transaction = db!.transaction("forecasts", "readwrite");
      transaction.objectStore("forecasts").put(snapshot, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return true;
  } catch { return false; }
  finally { db?.close(); }
}

export function readLedger(fingerprint: string): CreditLedger {
  const fallback = ledgerMemory.get(fingerprint) ?? newLedger();
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LEDGER_PREFIX + fingerprint) ?? "null");
    if (!isObject(value) || typeof value.budget !== "number" || !Number.isSafeInteger(value.budget) || value.budget < 0 ||
      typeof value.usedBeforeApp !== "number" || !Number.isSafeInteger(value.usedBeforeApp) || value.usedBeforeApp < 0 ||
      typeof value.activationDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.activationDate) || !Array.isArray(value.entries)) return fallback;
    const entries = value.entries.filter((entry) => isObject(entry) && typeof entry.id === "string" &&
      typeof entry.at === "string" && Number.isFinite(Date.parse(entry.at)) &&
      typeof entry.credits === "number" && Number.isFinite(entry.credits) && entry.credits >= 0);
    if (entries.length !== value.entries.length) return fallback;
    const history = value.history;
    if (history !== null && (!isObject(history) || typeof history.credits !== "number" || !Number.isSafeInteger(history.credits) || history.credits < 0 ||
      typeof history.through !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(history.through))) return fallback;
    ledgerMemory.set(fingerprint, value as CreditLedger);
    return value as CreditLedger;
  } catch { return fallback; }
}

export function saveLedger(fingerprint: string, ledger: CreditLedger): boolean {
  ledgerMemory.set(fingerprint, ledger);
  try { localStorage.setItem(LEDGER_PREFIX + fingerprint, JSON.stringify(ledger)); return true; }
  catch { return false; }
}

export async function keyFingerprint(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
