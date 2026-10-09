import { fetchWeather, fetchAccountHistory } from '@/lib/meteoblue-server';
import { validKey, validLocation } from '@/lib/meteoblue';
import { parseSeeing } from '@/lib/seeing';
import { completePlaceQuery } from '@/components/SkyViewer/geo';
import { remote } from './native';
import { terrainState, evaluateModel } from './model';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const kakao = 'https://jmgj-kakao-search.jmgj-kakao-search.workers.dev/v2/local';
async function placeSearch(query: string) {
  if (/\p{Script=Hangul}/u.test(query)) {
    const term = completePlaceQuery(query) ?? query;
    const response = await remote(`${kakao}/search/keyword.json?${new URLSearchParams({ query: term, size: '10' })}`);
    if (response.ok) {
      const data = await response.json();
      const results = (data.documents ?? []).map((p: Record<string, string>) => ({ lat: p.y, lon: p.x, display_name: [p.place_name, p.road_address_name || p.address_name].filter(Boolean).join(', '), source: 'kakao-keyword' }));
      if (results.length) return results;
    }
  }
  const response = await remote(`https://photon.komoot.io/api/?${new URLSearchParams({ q: query, limit: '10', lang: 'en' })}`);
  if (!response.ok) throw new Error('장소 검색에 실패했습니다.');
  const data = await response.json();
  return data.features.map((p: { properties: Record<string, string>; geometry: { coordinates: number[] } }) => ({ lat: p.geometry.coordinates[1], lon: p.geometry.coordinates[0], display_name: [p.properties.name, p.properties.city, p.properties.country].filter(Boolean).join(', '), source: 'photon' }));
}
export function installApi() {
  const original = window.fetch.bind(window);
  window.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.hostname === 'my.meteoblue.com') return remote(url.href, options?.signal ?? undefined);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return original(input, options);
    try {
      const body = options?.body ? JSON.parse(String(options.body)) : {};
      switch (url.pathname) {
        case '/api/seeing': {
          if (!validLocation(body.location)) return json({ error: '관측 위치를 확인하세요.' }, 400);
          const response = await remote(`https://www.7timer.info/bin/api.pl?${new URLSearchParams({ lat: String(body.location.latitude), lon: String(body.location.longitude), product: 'astro', output: 'json' })}`, options?.signal ?? undefined);
          if (!response.ok) throw new Error('시상 자료 연결 실패');
          return json(parseSeeing(await response.json(), body.location));
        }
        case '/api/meteoblue/weather':
          if (!validKey(body.apiKey) || !validLocation(body.location) || body.plan !== 'free3h') return json({ error: '키와 관측 위치를 확인하세요.' }, 400);
          return json(await fetchWeather(body.apiKey, body.location, 'free3h'));
        case '/api/meteoblue/usage': {
          if (!validKey(body.apiKey) || !/^\d{4}-\d{2}-\d{2}$/.test(body.start)) return json({ error: '키와 시작일을 확인하세요.' }, 400);
          const end = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
          return json(body.start > end ? { credits: 0, through: end } : await fetchAccountHistory(body.apiKey, body.start, end));
        }
        case '/api/location/search': case '/api/location/suggest': {
          const query = url.searchParams.get('query')?.trim() ?? '';
          if (query.length < 2 || query.length > 160) return json({ error: '검색어를 확인하세요.' }, 400);
          return json(await placeSearch(query));
        }
        case '/api/location/reverse': {
          const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
          if (!validLocation({ latitude: lat, longitude: lon })) return json({}, 400);
          const response = await remote(`https://photon.komoot.io/reverse?${new URLSearchParams({ lat: String(lat), lon: String(lon), limit: '1' })}`);
          if (!response.ok) throw new Error('주소 연결 실패');
          const p = (await response.json()).features[0]?.properties;
          return json({ display_name: p ? [p.name, p.city, p.country].filter(Boolean).join(', ') : `${lat.toFixed(4)}, ${lon.toFixed(4)}`, source: 'photon' });
        }
        case '/api/research/assets': return json(terrainState(body.location, body.retry));
        case '/api/research/evaluate': return json(await evaluateModel(body, options?.signal ?? undefined));
        case '/api/difficulty/sky-brightness': {
          const latitude = Number(url.searchParams.get('latitude')), longitude = Number(url.searchParams.get('longitude'));
          return json({ sqm: Math.abs(latitude - 37.5665) < 0.8 && Math.abs(longitude - 126.978) < 0.9 ? 18 : 21.3, seeingArcsec: null, source: 'bortle-fallback' });
        }
        default: return json({ error: '지원하지 않는 요청입니다.' }, 404);
      }
    } catch (e) {
      if (options?.signal?.aborted) throw options.signal.reason;
      return json({ error: e instanceof Error ? e.message : '자료 연결 실패' }, 502);
    }
  };
}
