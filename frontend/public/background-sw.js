// Only user-generated landscape tiles are handled. Application and API requests are untouched.
const CACHE = 'jmgj-background-files-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
 const url = new URL(event.request.url);
 if (event.request.method !== 'GET' || url.origin !== self.location.origin ||
     !/^\/user-backgrounds\/[a-f0-9-]{36}\/(properties|Norder0\/Dir0\/Npix\d{1,2}\.png)$/.test(url.pathname)) return;
 event.respondWith(caches.open(CACHE).then(cache => cache.match(url.origin + url.pathname))
  .then(response => response || new Response('Background file missing', { status: 404 })));
});
