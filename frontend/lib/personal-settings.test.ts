import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { webcrypto } from "node:crypto";
import { browserCredentials, OBSERVER_STORAGE_KEY, readObserver, saveObserver } from "./personal-settings";

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("crypto", webcrypto); });
afterEach(() => vi.unstubAllGlobals());
const key = "QA_ONLY_WEATHER_KEY_085";
describe("personal settings", () => {
  it("restores ciphertext from a newly created store and replaces and removes the saved key", async () => {
    await browserCredentials().save(key);
    expect(await browserCredentials().read()).toBe(key);
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("astrosky-credentials", 1); r.onsuccess = () => resolve(r.result); });
    const get = (name: string) => new Promise<unknown>(resolve => { const r = db.transaction("settings").objectStore("settings").get(name); r.onsuccess = () => resolve(r.result); });
    const encryption = await get("encryption") as CryptoKey;
    const stored = await get("weather") as { bytes: ArrayBuffer };
    expect(encryption.extractable).toBe(false);
    expect(new TextDecoder().decode(stored.bytes)).not.toContain(key);
    db.close();
    await browserCredentials().save("QA_ONLY_REPLACEMENT_KEY_085");
    expect(await browserCredentials().read()).toBe("QA_ONLY_REPLACEMENT_KEY_085");
    await browserCredentials().clear();
    expect(await browserCredentials().read()).toBeNull();
  });
  it("rejects ciphertext tampering and invalid key input", async () => {
    await expect(browserCredentials().save("name@example.com")).rejects.toThrow();
    await browserCredentials().save(key);
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("astrosky-credentials", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => { const tx = db.transaction("settings", "readwrite"); const store = tx.objectStore("settings"); const r = store.get("weather"); r.onsuccess = () => { const value = r.result; new Uint8Array(value.bytes)[0] ^= 1; store.put(value, "weather"); }; tx.oncomplete = () => resolve(); });
    db.close();
    await expect(browserCredentials().read()).rejects.toThrow();
  });
  it("keeps the selected place name and exact coordinates across restarts", () => {
    const entries = new Map<string, string>(); const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
    const place = { name: "제주과학고등학교", latitude: 33.4262, longitude: 126.5293 };
    expect(saveObserver(storage, place)).toBe(true); expect(readObserver(storage)).toEqual(place);
    for (const value of [{ ...place, latitude: 91 }, { ...place, name: "" }, { ...place, longitude: null }]) {
      entries.set(OBSERVER_STORAGE_KEY, JSON.stringify(value)); expect(readObserver(storage)).toBeNull();
    }
    expect(saveObserver({ setItem: () => { throw Error("blocked"); } }, place)).toBe(false);
    expect(readObserver({ getItem: () => { throw Error("blocked"); } })).toBeNull();
  });
});
