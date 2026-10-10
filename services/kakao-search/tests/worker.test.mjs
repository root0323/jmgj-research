import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleRequest } from '../src/worker.mjs';

const secret = 'test-operator-key';
function environment(success = true) {
  return { KAKAO_REST_API_KEY: secret, SEARCH_RATE_LIMITER: { async limit() { return { success }; } } };
}
function request(path, options) { return new Request('https://jmgj.example' + path, options); }

test('search sends only the operator key to the fixed Kakao endpoint', async () => {
  let calls = 0;
  const result = await handleRequest(request('/v2/local/search/keyword.json?query=제주과학고등학교&size=10',
    { headers: { Authorization: 'untrusted-client-key', 'CF-Connecting-IP': '192.0.2.1' } }), environment(), async (url, options) => {
      calls++;
      assert.equal(new URL(url).hostname, 'dapi.kakao.com');
      assert.equal(new URL(url).searchParams.get('query'), '제주과학고등학교');
      assert.equal(options.headers.Authorization, `KakaoAK ${secret}`);
      assert.equal(options.redirect, 'manual');
      return Response.json({ documents: [{ place_name: '제주과학고등학교', x: '126.53', y: '33.42' }], meta: { total_count: 1 }, ignored: secret },
        { headers: { Authorization: secret } });
    });
  assert.equal(calls, 1);
  assert.equal(result.status, 200);
  assert.equal((await result.clone().json()).documents[0].place_name, '제주과학고등학교');
  assert.ok(!(await result.text()).includes(secret));
  assert.equal(result.headers.get('authorization'), null);
  assert.equal(result.headers.get('cache-control'), 'no-store');
});

test('invalid routes, extra URLs, duplicate params and coordinates cannot call Kakao', async () => {
  for (const path of [
    '/v2/local/search/keyword.json?query=서울&url=https://evil.test',
    '/v2/local/search/keyword.json?query=서울&query=제주',
    '/v2/local/search/keyword.json?query=서울&size=999',
    '/v2/local/search/address.json?query=x',
    '/v2/local/geo/coord2address.json?x=181&y=33',
    '/v2/local/geo/coord2address.json?x=126&y=',
    '/v2/local/geo/coord2address.json?x=126&y=33&input_coord=WCONGNAMUL',
    '/https://evil.test',
  ]) {
    const response = await handleRequest(request(path), environment(), () => { assert.fail('Unexpected upstream request'); });
    assert.ok([400, 404].includes(response.status), path);
  }
  const response = await handleRequest(request('/v2/local/search/address.json?query=서울', { method: 'POST' }), environment());
  assert.equal(response.status, 405);
});

test('reverse uses WGS84 and account-free rate limiting blocks provider requests', async () => {
  const path = '/v2/local/geo/coord2address.json?x=126.978&y=37.5665';
  const response = await handleRequest(request(path), environment(), async (url) => {
    assert.equal(new URL(url).searchParams.get('input_coord'), 'WGS84');
    return Response.json({ documents: [{ address: { address_name: '서울특별시' } }] });
  });
  assert.equal(response.status, 200);
  const limited = await handleRequest(request(path), environment(false), () => assert.fail('Rate limit must run before provider'));
  assert.equal(limited.status, 429);
});

test('provider errors and redirects are sanitized; no missing-secret bypass', async () => {
  const input = request('/v2/local/search/address.json?query=서울');
  for (const status of [302, 403, 429, 500]) {
    const response = await handleRequest(input, environment(), async () => Response.json({ message: secret }, { status }));
    assert.equal(response.status, status === 429 ? 429 : 502);
    assert.ok(!(await response.text()).includes(secret));
  }
  const timeout = await handleRequest(input, environment(), async () => { throw new Error(secret); });
  assert.equal(timeout.status, 502);
  assert.ok(!(await timeout.text()).includes(secret));
  const missing = await handleRequest(input, {}, () => assert.fail('Missing operator key must fail'));
  assert.equal(missing.status, 503);
});

test('Cloudflare entrypoint accepts the runtime context without treating it as fetch', async () => {
  const response = await worker.fetch(request('/health'), environment(), { waitUntil() {} });
  assert.deepEqual(await response.json(), { ok: true, service: 'jmgj-kakao-search' });
  assert.equal((await worker.fetch(request('/health'), {}, {})).status, 503);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async function () {
      assert.equal(this, globalThis, 'Workers fetch requires the global receiver');
      return Response.json({ documents: [{ place_name: '서울' }] });
    };
    const search = await worker.fetch(request('/v2/local/search/keyword.json?query=서울'), environment(), { waitUntil() {} });
    assert.equal(search.status, 200);
    assert.equal((await search.json()).documents[0].place_name, '서울');
  } finally { globalThis.fetch = originalFetch; }
});
