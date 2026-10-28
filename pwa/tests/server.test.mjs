import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { handle } from '../server/worker.mjs';
import { permitted } from '../server/policy.mjs';
const origin = 'https://astrosky.example';
const request = url => new Request(origin + '/bridge', { method:'POST', headers:{Origin:origin,'Content-Type':'application/json'}, body:JSON.stringify({url}) });
const env = { BRIDGE_LIMITER:{limit:async()=>({success:true})} };
test('allows only known providers and exact supported routes', () => {
  for (const url of ['https://my.meteoblue.com/packages/air-3h?apikey=synthetic','https://www.7timer.info/bin/api.pl?lat=33','https://photon.komoot.io/api/?q=Jeju','https://copernicus-dem-90m.s3.amazonaws.com/tileList.txt']) assert.equal(permitted(url),true);
  for (const url of ['http://my.meteoblue.com/packages/air-3h','https://my.meteoblue.com.evil.test/packages/air-3h','https://x:y@my.meteoblue.com/packages/air-3h','https://my.meteoblue.com/packages/seeing-1h','https://127.0.0.1/','https://my.meteoblue.com:444/packages/air-3h','https://photon.komoot.io/private']) assert.equal(permitted(url),false);
});
test('does not forward redirects, errors or arbitrary headers', async () => {
  const url='https://my.meteoblue.com/packages/air-3h?apikey=synthetic';
  let r=await handle(request(url),env,async()=>new Response('synthetic',{status:302,headers:{Location:'https://evil.test'}})); assert.equal(r.status,502); assert.ok(!(await r.text()).includes('synthetic'));
  r=await handle(request(url),env,async()=>new Response('key=synthetic',{status:403})); assert.equal(r.status,403); assert.equal(await r.text(),'{}');
  r=await handle(request(url),env,async()=>new Response('{"value":1}',{headers:{'MB-Credits-Accounted':'8000','Set-Cookie':'secret'}})); assert.equal(r.headers.get('MB-Credits-Accounted'),'8000'); assert.equal(r.headers.get('Set-Cookie'),null); assert.equal(r.headers.get('Cache-Control'),'no-store');
});
test('rejects cross-origin requests, blocked destinations and abuse limits',async()=>{
  assert.equal((await handle(new Request(origin+'/bridge',{method:'POST',body:'{}'}),env)).status,403);
  assert.equal((await handle(request('https://evil.test/'),env)).status,400);
  assert.equal((await handle(request('https://photon.komoot.io/api/'),{BRIDGE_LIMITER:{limit:async()=>({success:false})}})).status,429);
});
test('Cloudflare execution context is not mistaken for an upstream fetch function',async()=>{
  const response=await worker.fetch(new Request(origin+'/'),{ASSETS:{fetch:async()=>new Response('app')}},{waitUntil(){}});assert.equal(await response.text(),'app');
});
test('split background model streams the exact original bytes',async()=>{
  const chunks={'/chunks/0.bin':'first','/chunks/1.bin':'second'};
  const assets={fetch:async input=>{const path=new URL(typeof input==='string'?input:input.url??input.href).pathname;return path==='/large-assets.json'?Response.json({'/background-model/ffnet_40s.data':{parts:Object.keys(chunks),bytes:11}}):new Response(chunks[path],{status:chunks[path]?200:404});}};
  const response=await handle(new Request(origin+'/background-model/ffnet_40s.data'),{ASSETS:assets});assert.equal(response.headers.get('Content-Length'),'11');assert.equal(await response.text(),'firstsecond');
});
test('uses the existing Kakao service binding without copying its secret',async()=>{
  let calls=0;const e={...env,KAKAO:{fetch:async()=>{calls++;return Response.json({documents:[]});}}};
  const response=await handle(request('https://jmgj-kakao-search.jmgj-kakao-search.workers.dev/v2/local/search/keyword.json?query=Jeju'),e,()=>{throw Error('Global fetch must not be used');});assert.equal(response.status,200);assert.equal(calls,1);
});
