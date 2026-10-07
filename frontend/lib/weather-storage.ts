import { isObject, newLedger, locationKey, type CreditLedger, type WeatherLocation, type WeatherSnapshot } from "./meteoblue";
import { validSeeing, type SeeingSnapshot } from "./seeing";

const memory = new Map<string, WeatherSnapshot>();
const seeingMemory = new Map<string, SeeingSnapshot>();
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

/** Local research replay only: latest saved free3h snapshot at an explicit site.
 * Never reads an API key, changes a ledger, or falls back to a network request.
 */
export async function readLatestWeather(location: WeatherLocation): Promise<WeatherSnapshot | null> {
  let db: IDBDatabase | undefined;
  const candidates = [...memory.values()];
  try {
    db = await openCache();
    const values = await new Promise<unknown[]>((resolve, reject) => {
      const request = db!.transaction("forecasts", "readonly").objectStore("forecasts").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    for (const value of values) {
      if (isObject(value) && value.plan === "free3h" && isObject(value.location) &&
          typeof value.location.latitude === "number" && typeof value.location.longitude === "number" &&
          typeof value.fetchedAt === "string" && typeof value.id === "string" && Array.isArray(value.results)) {
        candidates.push(value as WeatherSnapshot);
      }
    }
  } catch { /* Memory cache remains available. Never issue a weather request here. */ }
  finally { db?.close(); }
  return candidates.filter((item) => item.plan === "free3h" && locationKey(item.location) === locationKey(location) &&
    Number.isFinite(Date.parse(item.fetchedAt))).sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt))[0] ?? null;
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

export async function readSeeing(key: string): Promise<SeeingSnapshot | null> {
  if (seeingMemory.has(key)) return seeingMemory.get(key)!;
  let db: IDBDatabase | undefined;
  try {
    db = await openCache();
    const value: unknown = await new Promise((resolve, reject) => {
      const request = db!.transaction("forecasts", "readonly").objectStore("forecasts").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (validSeeing(value)) { seeingMemory.set(key, value); return value; }
  } catch { /* A cache read never starts an external request. */ }
  finally { db?.close(); }
  return null;
}

export async function saveSeeing(key: string, value: SeeingSnapshot): Promise<boolean> {
  seeingMemory.set(key, value);
  let db: IDBDatabase | undefined;
  try {
    db = await openCache();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction("forecasts", "readwrite");
      tx.objectStore("forecasts").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
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
