const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { NsisUpdater } = require('electron-updater');
const { HttpExecutor } = require('builder-util-runtime');
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor');

// Exercise the library's real metadata/download/hash/cache pipeline with a
// loopback-only Node transport. No Electron window or installer is executed.
class LocalHttpExecutor extends HttpExecutor {
  createRequest(options, callback) {
    assert.equal(options.hostname, '127.0.0.1');
    return http.request(options, callback);
  }
}
LocalHttpExecutor.prototype.download = ElectronHttpExecutor.prototype.download;

test('real updater checks metadata, verifies SHA-512, reuses cached bytes and rejects corrupt installers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jmgj-updater-download-'));
  const payload = crypto.randomBytes(128 * 1024);
  const hash = crypto.createHash('sha512').update(payload).digest('base64');
  let downloads = 0, corrupt = false, quit = 0;
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, undefined);
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (pathname === '/latest.yml') {
      res.setHeader('Content-Type', 'text/yaml');
      res.end(JSON.stringify({ version: '0.4.0', files: [{ url: 'JMGJ-test-0.4.0.exe', sha512: hash, size: payload.length }],
        path: 'JMGJ-test-0.4.0.exe', sha512: hash, releaseDate: '2026-10-08T00:00:00.000Z' }));
    } else if (pathname === '/JMGJ-test-0.4.0.exe') {
      downloads++;
      res.setHeader('Content-Length', payload.length);
      res.end(corrupt ? Buffer.alloc(payload.length) : payload);
    } else { res.statusCode = 404; res.end(); }
  });
  function updater(name) {
    const user = path.join(root, name);
    fs.mkdirSync(user, { recursive: true });
    const config = path.join(user, 'app-update.yml');
    const url = `http://127.0.0.1:${server.address().port}/`;
    fs.writeFileSync(config, JSON.stringify({ provider: 'generic', url, updaterCacheDirName: 'jmgj-test-updater' }));
    const app = { version: '0.3.0', name: 'jmgj-test', isPackaged: true, appUpdateConfigPath: config,
      userDataPath: user, baseCachePath: path.join(user, 'cache'), whenReady: async () => {},
      quit: () => { quit++; }, relaunch: () => { quit++; }, onQuit: () => {} };
    const value = new NsisUpdater(null, app);
    value.httpExecutor = new LocalHttpExecutor();
    value.setFeedURL({ provider: 'generic', url });
    value.autoDownload = false;
    value.autoInstallOnAppQuit = false;
    value.disableDifferentialDownload = true;
    value.logger = { info() {}, debug() {}, warn() {}, error() {} };
    value.on('error', () => {});
    return value;
  }
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const first = updater('good');
    assert.equal((await first.checkForUpdates()).isUpdateAvailable, true);
    assert.equal(downloads, 0);
    const [file] = await first.downloadUpdate();
    assert.deepEqual(fs.readFileSync(file), payload);
    assert.equal(downloads, 1);
    const modified = fs.statSync(file).mtimeMs;
    const second = updater('good');
    await second.checkForUpdates();
    await second.downloadUpdate();
    assert.equal(downloads, 1);
    assert.equal(fs.statSync(file).mtimeMs, modified);
    corrupt = true;
    const bad = updater('bad');
    await bad.checkForUpdates();
    await assert.rejects(bad.downloadUpdate(), { code: 'ERR_CHECKSUM_MISMATCH' });
    assert.equal(quit, 0);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('jmgj-updater-download-'));
    fs.rmSync(root, { recursive: true });
  }
});
