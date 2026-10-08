const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { safeExternal, loadConfig, freePort, waitReady } = require('../runtime.cjs');

test('external login/source links cannot open local files, credentials or hostile schemes', () => {
  assert.equal(safeExternal('https://my.meteoblue.com/'), true);
  assert.equal(safeExternal('https://github.com/root0323/jmgj-research'), true);
  for (const url of ['file:///C:/Windows/a.exe', 'javascript:alert(1)', 'http://github.com',
    'https://github.com.evil.test', 'https://user:pass@github.com', 'https://127.0.0.1', 'https://github.com:8000']) {
    assert.equal(safeExternal(url), false, url);
  }
});

test('restart retains origin; occupied saved port fails without losing the cache origin', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jmgj-config-'));
  const file = path.join(directory, 'config.json');
  const first = await loadConfig(file, directory);
  assert.deepEqual(await loadConfig(file, directory), first);
  const server = net.createServer();
  await new Promise((resolve) => server.listen(first.port, '127.0.0.1', resolve));
  try { await assert.rejects(loadConfig(file, directory), { code: 'EADDRINUSE' }); }
  finally { await new Promise((resolve) => server.close(resolve)); }
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), first);
  fs.rmSync(directory, { recursive: true });
});

test('readiness does not reuse an unrelated worker or hide an exited child', async () => {
  const port = await freePort();
  assert.ok(port > 0);
  await assert.rejects(waitReady(`http://127.0.0.1:${port}`, {}, [{ exitCode: 1 }]), /내장 서버/);
});
