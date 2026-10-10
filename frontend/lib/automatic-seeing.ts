import { locationKey, validLocation, type WeatherLocation } from "./meteoblue";
import { seeingCacheKey, seeingFresh, validSeeing, type SeeingSnapshot } from "./seeing";

type Dependencies = {
  read: (key: string) => Promise<SeeingSnapshot | null>;
  save: (key: string, snapshot: SeeingSnapshot) => Promise<boolean>;
  request: (location: WeatherLocation) => Promise<unknown>;
  now?: () => number;
};

export type SeeingLoadResult = { snapshot: SeeingSnapshot; persisted: boolean };

export function createSeeingLoader({ read, save, request, now = Date.now }: Dependencies) {
  const pending = new Map<string, Promise<SeeingLoadResult>>();
  const memoryOnly = new Set<string>();

  async function resolve(location: WeatherLocation, key: string): Promise<SeeingLoadResult> {
    const cached = await read(key);
    if (cached && validSeeing(cached) && locationKey(cached.location) === locationKey(location) && seeingFresh(cached, now())) {
      return { snapshot: cached, persisted: !memoryOnly.has(key) };
    }
    const value = await request(location);
    if (!validSeeing(value) || locationKey(value.location) !== locationKey(location)) throw new Error("seeing unavailable");
    const persisted = await save(key, value);
    if (persisted) memoryOnly.delete(key); else memoryOnly.add(key);
    return { snapshot: value, persisted };
  }

  return function load(location: WeatherLocation, time: Date): Promise<SeeingLoadResult> {
    if (!validLocation(location)) return Promise.reject(new Error("invalid seeing location"));
    const key = seeingCacheKey(location, time);
    const existing = pending.get(key);
    if (existing) return existing;
    const work = resolve({ ...location }, key).finally(() => pending.delete(key));
    pending.set(key, work);
    return work;
  };
}
