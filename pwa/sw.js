/* Build substitutes the version and the shell asset list. Never cache /bridge,
 * weather keys, or external provider requests. Regional data lives in a separate
 * version-independent cache and survives application updates.
 */
const VERSION = '__VERSION__', APP_CACHE = 'astrosky-app-' + VERSION;
const REGIONAL_CACHE = 'astrosky-regional-v1', SHELL = __SHELL__;
let offline = { type: 'OFFLINE_STATE', done: 0, total: 0, ready: false, running: false };
let preparation;
function decodedHeaders(source) {
  const headers = new Headers(source);
  // fetch() exposes decoded bytes. Reconstructed cache responses must not
  // retain the HTTP compression/length of the original wire representation.
  for (const name of ['Content-Encoding', 'Content-Length', 'Transfer-Encoding']) headers.delete(name);
  return headers;
}
function documentResponse(response) { return new Response(response.body, { status: response.status, headers: decodedHeaders(response.headers) }); }
async function publish() { for (const client of await self.clients.matchAll({ includeUncontrolled: true })) client.postMessage(offline); }
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(APP_CACHE);
  for (const url of SHELL) {
    const response = await fetch(url, { cache: 'reload' });
    if (!response.ok) throw Error('Shell asset missing');
    // In particular, /index.html can redirect to /. Cache a fresh decoded
    // response so an offline navigation is not served a redirected response.
    await cache.put(url, new Response(response.body, { headers: decodedHeaders(response.headers) }));
  }
  // A first installation can claim the page; updates wait for user approval.
  if (!self.registration.active) await self.skipWaiting();
  else {
    // Stage a complete verified update before replacing a working offline app.
    // Unchanged large assets can be copied from the previous application cache.
    await prepare(); if (!offline.ready) throw Error('Incomplete offline update');
  }
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('astrosky-app-') && name !== APP_CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
async function prepare() {
  offline = { type: 'OFFLINE_STATE', done: 0, total: 0, ready: false, running: true }; await publish();
  try {
    const response = await fetch('/offline-assets.json', { cache: 'no-store' }); if (!response.ok) throw Error();
    const manifest = await response.json(); if (manifest.version !== VERSION) throw Error('새 업데이트를 먼저 적용해 주세요.');
    offline.total = manifest.files.length; const cache = await caches.open(APP_CACHE);
    const previous = (await caches.keys()).filter(name => name.startsWith('astrosky-app-') && name !== APP_CACHE);
    for (const file of manifest.files) {
      let saved = await cache.match(file.url);
      if (saved?.headers.has('Content-Encoding')) {
        const normalized = new Response(await saved.arrayBuffer(), { headers: decodedHeaders(saved.headers) });
        await cache.put(file.url, normalized.clone()); saved = normalized;
      }
      if (!saved || saved.headers.get('X-AstroSky-Sha256') !== file.hash) {
        for (const name of previous) {
          const old = await (await caches.open(name)).match(file.url);
          if (old?.headers.get('X-AstroSky-Sha256') === file.hash) { await cache.put(file.url, old.clone()); saved = old; break; }
        }
      }
      if (!saved || saved.headers.get('X-AstroSky-Sha256') !== file.hash) {
        const result = await fetch(file.url, { cache: 'no-store' }); if (!result.ok) throw Error();
        const bytes = await result.arrayBuffer();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
        if (hash !== file.hash || bytes.byteLength !== file.bytes) throw Error('오프라인 자료 검증에 실패했습니다. 다시 시도해 주세요.');
        const headers = decodedHeaders(result.headers); headers.set('X-AstroSky-Sha256', hash);
        await cache.put(file.url, new Response(bytes, { headers }));
      }
      offline.done++; await publish();
    }
    offline.ready = true;
    await cache.put('/offline-ready', Response.json({ version: VERSION, total: offline.total }));
  } catch (error) { offline.error = error.message || '자료 준비가 중단되었습니다. 네트워크와 저장 공간을 확인하고 다시 시도해 주세요.'; }
  offline.running = false; await publish();
}
self.addEventListener('message', event => {
  if (event.data?.type === 'CLAIM_CLIENT') event.waitUntil(self.clients.claim());
  if (event.data?.type === 'APPLY_UPDATE') event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'PREPARE_OFFLINE') {
    if (!preparation) preparation = prepare().finally(() => { preparation = null; });
    event.waitUntil(preparation);
  }
  if (event.data?.type === 'OFFLINE_STATE') event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE), saved = await cache.match('/offline-ready');
    if (saved && !offline.running) { const state = await saved.json(); offline = { ...offline, done: state.total, total: state.total, ready: true }; }
    event.source?.postMessage(offline);
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/bridge' || url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/regional-data/')) {
    event.respondWith((async () => (await caches.open(REGIONAL_CACHE)).match(event.request).then(value => value ?? new Response('Regional data missing', { status: 404 })))()); return;
  }
  if (/^\/user-backgrounds\/[a-f0-9-]{36}\/(properties|Norder0\/Dir0\/Npix\d{1,2}\.png)$/.test(url.pathname)) {
    event.respondWith(caches.open('jmgj-background-files-v1').then(cache => cache.match(url.origin + url.pathname)).then(value => value ?? new Response('Background file missing', { status: 404 }))); return;
  }
  if (['/sw.js', '/offline-assets.json', '/large-assets.json'].includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(APP_CACHE);
    if (event.request.mode === 'navigate' && ['/', '/index.html'].includes(url.pathname)) {
      const index = await cache.match('/index.html'); if (index) return documentResponse(index);
    }
    const saved = await cache.match(event.request); if (saved) return event.request.mode === 'navigate' ? documentResponse(saved) : saved;
    try {
      const response = await fetch(event.request);
      if (response.ok && response.type !== 'opaque') await cache.put(event.request, response.clone());
      return response;
    } catch {
      if (event.request.mode === 'navigate') { const index = await cache.match('/index.html'); return index ? documentResponse(index) : new Response('오프라인 사용 준비가 필요합니다.', { status: 503 }); }
      return new Response('Offline asset missing', { status: 503 });
    }
  })());
});
