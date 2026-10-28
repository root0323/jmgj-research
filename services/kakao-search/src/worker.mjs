// Public place-search service. The operator key exists only in a Worker secret.
const SEARCH_PATHS = new Set([
  '/v2/local/search/address.json',
  '/v2/local/search/keyword.json',
]);
const REVERSE_PATH = '/v2/local/geo/coord2address.json';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  } });
}

function parameters(url) {
  const search = SEARCH_PATHS.has(url.pathname);
  const allowed = search ? ['query', 'size'] : ['x', 'y', 'input_coord'];
  if ([...url.searchParams.keys()].some((key) => !allowed.includes(key) || url.searchParams.getAll(key).length !== 1)) return null;
  const params = new URLSearchParams();
  if (search) {
    const query = (url.searchParams.get('query') || '').trim();
    const size = url.searchParams.get('size') || '10';
    if (query.length < 2 || query.length > 160 || /[\x00-\x1f\x7f]/.test(query) || !/^(?:[1-9]|1[0-5])$/.test(size)) return null;
    params.set('query', query);
    params.set('size', size);
  } else {
    for (const [name, bound] of [['x', 180], ['y', 90]]) {
      const value = url.searchParams.get(name);
      if (!value || !value.trim() || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > bound) return null;
      params.set(name, String(Number(value)));
    }
    const coordinates = url.searchParams.get('input_coord');
    if (coordinates && coordinates !== 'WGS84') return null;
    params.set('input_coord', 'WGS84');
  }
  return params;
}

export async function handleRequest(request, env, fetchUpstream = (...args) => globalThis.fetch(...args)) {
  const url = new URL(request.url);
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  if (url.pathname === '/health') {
    const ready = Boolean(env.KAKAO_REST_API_KEY && env.SEARCH_RATE_LIMITER);
    return json({ ok: ready, service: 'jmgj-kakao-search' }, ready ? 200 : 503);
  }
  if (!SEARCH_PATHS.has(url.pathname) && url.pathname !== REVERSE_PATH) return json({ error: 'not_found' }, 404);
  const params = parameters(url);
  if (!params) return json({ error: 'invalid_query' }, 400);
  const key = env.KAKAO_REST_API_KEY;
  if (typeof key !== 'string' || !key || /\s/.test(key) || !env.SEARCH_RATE_LIMITER) return json({ error: 'service_unavailable' }, 503);
  let stage = 'limiter';
  try {
    // No user accounts: shared networks can share this abuse-prevention limit.
    // Cloudflare supplies this header at its edge; callers cannot choose it there.
    const client = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.SEARCH_RATE_LIMITER.limit({ key: client });
    if (!success) return json({ error: 'rate_limited' }, 429);
    stage = 'network';
    // Destination and paths are fixed. Never proxy arbitrary URLs or redirects.
    const upstream = await fetchUpstream(`https://dapi.kakao.com${url.pathname}?${params}`, {
      // workerd supports manual/follow; manual keeps the secret off redirects.
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(2500),
      headers: { Authorization: `KakaoAK ${key}`, Accept: 'application/json' },
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      const error = upstream.status === 429 ? 'rate_limited'
        : [401, 403].includes(upstream.status) ? 'provider_auth_rejected' : 'provider_unavailable';
      return json({ error }, upstream.status === 429 ? 429 : 502);
    }
    stage = 'response';
    const body = await upstream.json();
    if (!body || !Array.isArray(body.documents) || body.documents.length > 30) return json({ error: 'invalid_response' }, 502);
    // Error text and upstream headers can contain credentials: never forward them.
    return json({ documents: body.documents, meta: body.meta || {} });
  } catch {
    // Only fixed categories leave the service, never exceptions or provider text.
    return json({ error: stage === 'limiter' ? 'service_unavailable'
      : stage === 'response' ? 'invalid_response' : 'provider_network_error' }, stage === 'limiter' ? 503 : 502);
  }
}

export default { fetch(request, env) { return handleRequest(request, env); } };
