const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const EXTERNAL_HOSTS = ['meteoblue.com', 'github.com', 'openstreetmap.org', 'nominatim.org',
  '7timer.info', 'kakao.com', 'vworld.kr', 'nasa.gov', 'aws.amazon.com', 'opendata.aws',
  'copernicus.eu', 'esa.int', 'stellarium.org', 'unistra.fr', 'stsci.edu', 'doi.org',
  'creativecommons.org'];

function safeExternal(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      EXTERNAL_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith('.' + host));
  } catch { return false; }
}

function validConfig(value) {
  return value && Number.isInteger(value.port) && value.port >= 1024 && value.port <= 65535 &&
    typeof value.dataRoot === 'string' && path.isAbsolute(value.dataRoot) &&
    (value.assetRoot === undefined || (typeof value.assetRoot === 'string' && path.isAbsolute(value.assetRoot)));
}

async function freePort(port = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const allocated = server.address().port;
      server.close((error) => error ? reject(error) : resolve(allocated));
    });
  });
}

async function loadConfig(file, dataRoot) {
  if (fs.existsSync(file)) {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!validConfig(value)) throw new Error('앱 설정 파일을 확인해 주세요.');
    // Never silently change the origin: IndexedDB/localStorage are origin-scoped.
    await freePort(value.port);
    return value;
  }
  for (let port = 43127; port < 43148; port++) {
    try {
      await freePort(port);
      const value = { port, dataRoot };
      saveConfig(file, value);
      return value;
    } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  throw new Error('앱에서 사용할 로컬 포트가 없습니다.');
}

function saveConfig(file, config) {
  if (!validConfig(config)) throw new Error('Invalid desktop config');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(config, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
}

async function waitReady(url, headers, children, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (children.some((child) => child.exitCode !== null || child.signalCode !== null || child.startError)) {
      throw new Error('내장 서버 시작에 실패했습니다.');
    }
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(1500), redirect: 'error' });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch { /* Wait for this launch's private worker, never reuse an old server. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('내장 서버 시작 시간이 초과됐습니다.');
}

module.exports = { safeExternal, validConfig, freePort, loadConfig, saveConfig, waitReady };
