import { permitted, privateProvider } from './policy.mjs';
// Same-origin transport only. Personal API keys are forwarded in POST bodies,
// never stored, cached or logged here. The Kakao operator key remains in its
// existing separate Worker secret. No arbitrary proxy or redirects are allowed.
const json = (error, status) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export async function handle(request, env, upstreamFetch = fetch) {
  const url = new URL(request.url);
  if (url.pathname === '/bridge') {
    if (request.method !== 'POST') return json('method_not_allowed', 405);
    if (request.headers.get('Origin') !== url.origin || !request.headers.get('Content-Type')?.startsWith('application/json')) return json('origin_required', 403);
    if (Number(request.headers.get('Content-Length')) > 8192) return json('request_too_large', 413);
    if (!env.BRIDGE_LIMITER || !(await env.BRIDGE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' })).success) return json('rate_limited', 429);
    try {
      const text = await request.text(); if (text.length > 8192) return json('request_too_large', 413);
      const address = JSON.parse(text)?.url;
      if (typeof address !== 'string' || !permitted(address)) return json('provider_not_allowed', 400);
      const host = new URL(address).hostname;
      // Existing Workers on this account must be called through service bindings;
      // global fetch to their workers.dev addresses can bypass their route.
      const service = host === 'jmgj-kakao-search.jmgj-kakao-search.workers.dev' ? env.KAKAO
        : host === 'astrosky-black-marble.jmgj-kakao-search.workers.dev' ? env.BLACK_MARBLE : null;
      const send = service ? service.fetch.bind(service) : upstreamFetch;
      const upstreamHeaders = { Accept: '*/*', 'User-Agent': 'AstroSky-PWA (https://github.com/root0323/jmgj-research)' };
      if (service && request.headers.has('CF-Connecting-IP')) upstreamHeaders['CF-Connecting-IP'] = request.headers.get('CF-Connecting-IP');
      const response = await send(address, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(90_000), headers: upstreamHeaders });
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); return json('redirect_not_allowed', 502); }
      const headers = new Headers({ 'Content-Type': response.headers.get('Content-Type') ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      const credits = response.headers.get('MB-Credits-Accounted'); if (credits && /^\d+$/.test(credits)) headers.set('MB-Credits-Accounted', credits);
      // Avoid reflecting provider error pages (which can contain URLs/keys).
      if (!response.ok) { await response.body?.cancel(); return new Response('{}', { status: response.status, headers }); }
      if (privateProvider(address)) {
        // Successful weather payloads are sanitized by the shared weather parser.
        headers.set('Pragma', 'no-cache');
      }
      return new Response(response.body, { status: response.status, headers });
    } catch { return json('provider_unavailable', 502); }
  }
  if (url.pathname === '/background-model/ffnet_40s.data') {
    const manifest = await (await env.ASSETS.fetch(new URL('/large-assets.json', url))).json();
    const item = manifest[url.pathname]; if (!item) return json('not_found', 404);
    let index = 0, reader;
    const stream = new ReadableStream({ async pull(controller) {
      try {
        while (true) {
          if (!reader) {
            if (index >= item.parts.length) { controller.close(); return; }
            const response = await env.ASSETS.fetch(new URL(item.parts[index++], url)); if (!response.ok) throw Error('Missing part');
            reader = response.body.getReader();
          }
          const { done, value } = await reader.read();
          if (done) { reader.releaseLock(); reader = undefined; continue; }
          controller.enqueue(value); return;
        }
      } catch (error) { controller.error(error); }
    }, cancel() { return reader?.cancel(); } });
    return new Response(stream, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(item.bytes), 'Cache-Control': 'public,max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
  }
  return env.ASSETS.fetch(request);
}
export default { fetch: (request, env) => handle(request, env) };
