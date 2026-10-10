import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { readBackgrounds, readSelectedBackground, removeBackground, saveBackground, selectBackground } from "./backgroundStorage";
import type { SavedBackground } from "./backgroundStorage";
let files: Map<string, Response>;
let fail: boolean;
const record = (id: string): SavedBackground => ({id,revision:crypto.randomUUID(),name:id,settings:{centerAzimuth:0,horizon:50,verticalFov:180},width:1024,height:512,bytes:30,savedAt:new Date().toISOString(),source:new Blob(["source"]),mask:new Blob(["mask"])});
const tiles = Array.from({length:12},()=>new Blob(["tile"],{type:"image/png"}));
beforeEach(() => {
  files = new Map(); fail = false;
  const cache = {
    put: async (url: string, response: Response) => { if(fail && url.includes("Npix4")) throw new Error("QuotaExceededError"); files.set(url,response); },
    keys: async () => [...files.keys()].map(url=>new Request(url)),
    delete: async (request: Request) => files.delete(request.url),
  };
  vi.stubGlobal("indexedDB",new IDBFactory());
  vi.stubGlobal("location",{origin:"http://localhost:3001"});
  vi.stubGlobal("caches",{open:async()=>cache});
  vi.stubGlobal("window",{isSecureContext:true,caches:{}});
  vi.stubGlobal("navigator",{serviceWorker:{register:async()=>{},ready:Promise.resolve(),controller:{}},storage:{persist:async()=>false}});
});
afterEach(()=>vi.unstubAllGlobals());
it("restores the active background and original source after reopening storage", async () => {
  const item=record("one"); await saveBackground(item,tiles,512);
  const saved=await readBackgrounds(); expect(saved[0].settings).toEqual(item.settings);
  expect(await saved[0].source.text()).toBe("source"); expect(await saved[0].mask.text()).toBe("mask");
  expect(await readSelectedBackground()).toBe("one"); expect(files.size).toBe(13);
});
it("rolls back partial tiles after quota failure and preserves the previous selection",async()=>{
  const old=record("old"), next=record("next"); await saveBackground(old,tiles,512);
  fail=true; await expect(saveBackground(next,tiles,512)).rejects.toThrow();
  expect((await readBackgrounds()).map(x=>x.id)).toEqual(["old"]);
  expect(await readSelectedBackground()).toBe("old"); expect(files.size).toBe(13);
});
it("can select the default and delete an active custom background without orphaned tiles",async()=>{
  const item=record("test"); await saveBackground(item,tiles,512);
  await selectBackground(null); expect(await readSelectedBackground()).toBeNull();
  await selectBackground(item.id); await removeBackground(item,true);
  expect(await readSelectedBackground()).toBeNull(); expect(await readBackgrounds()).toEqual([]); expect(files.size).toBe(0);
});
