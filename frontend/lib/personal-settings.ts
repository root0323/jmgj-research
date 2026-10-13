import { validKey, validLocation, type WeatherLocation } from "./meteoblue";

export type CredentialStore = {
  read: () => Promise<string | null>;
  save: (key: string) => Promise<void>;
  clear: () => Promise<void>;
};
declare global { interface Window { AstroSkyCredentials?: CredentialStore } }
export const OBSERVER_STORAGE_KEY = "astrosky.observer.v1";
export type SavedObserver = WeatherLocation & { name: string };

export function readObserver(storage: Pick<Storage, "getItem">): SavedObserver | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(OBSERVER_STORAGE_KEY) ?? "null");
    if (!validLocation(value) || !("name" in value) || typeof value.name !== "string" ||
        !value.name.trim() || value.name.length > 200) return null;
    return { latitude: value.latitude, longitude: value.longitude, name: value.name };
  } catch { return null; }
}
export function saveObserver(storage: Pick<Storage, "setItem">, value: SavedObserver): boolean {
  if (!validLocation(value) || !value.name.trim() || value.name.length > 200) return false;
  try { storage.setItem(OBSERVER_STORAGE_KEY, JSON.stringify(value)); return true; }
  catch { return false; }
}

// Browser-only fallback: persist a non-extractable AES key and ciphertext in
// IndexedDB. Native apps instead use OS-protected credentials, never plaintext.
export function browserCredentials(): CredentialStore {
  async function database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open("astrosky-credentials", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("settings");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(new Error("Credential storage unavailable"));
      r.onblocked = () => reject(new Error("Credential storage blocked"));
    });
  }
  async function readEntry(db: IDBDatabase, name: string) {
    return new Promise<unknown>((resolve, reject) => {
      const r = db.transaction("settings").objectStore("settings").get(name);
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(new Error("Credential read failed"));
    });
  }
  async function write(db: IDBDatabase, key: CryptoKey | null, value: { iv: Uint8Array; bytes: ArrayBuffer } | null) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("settings", "readwrite"), store = tx.objectStore("settings");
      if (key && value) { store.put(key, "encryption"); store.put(value, "weather"); }
      else { store.delete("weather"); store.delete("encryption"); }
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(new Error("Credential write failed"));
    });
  }
  return {
    async read() {
      const db = await database();
      try {
        const key = await readEntry(db, "encryption") as CryptoKey | undefined;
        const value = await readEntry(db, "weather") as { iv: Uint8Array<ArrayBuffer>; bytes: ArrayBuffer } | undefined;
        if (!value) return null;
        if (!key) throw new Error("Credential encryption key missing");
        const result = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: value.iv }, key, value.bytes));
        if (!validKey(result)) throw new Error("Invalid saved credential");
        return result;
      } finally { db.close(); }
    },
    async save(value) {
      if (!validKey(value)) throw new Error("Invalid credential");
      const db = await database();
      try {
        const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const bytes = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
        await write(db, key, { iv, bytes });
      } finally { db.close(); }
    },
    async clear() { const db = await database(); try { await write(db, null, null); } finally { db.close(); } },
  };
}
export function credentials(): CredentialStore { return window.AstroSkyCredentials ?? browserCredentials(); }
