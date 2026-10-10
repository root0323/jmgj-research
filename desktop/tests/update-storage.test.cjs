const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { cleanupAfterSuccessfulStart } = require('../update-storage.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'astrosky-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const legacy = path.join(root, 'JMGJ Research'), current = path.join(legacy, 'AstroSky');
  const profile = path.join(root, 'user-data'), cache = path.join(root, 'jmgj-research-desktop-updater');
  const put = (file, contents) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, contents); };
  put(path.join(current, 'AstroSky.exe'), 'current app');
  put(path.join(current, 'resources/data/black-marble/tile.h5'), 'current bundled data');
  put(path.join(legacy, 'AstroSky.exe'), 'old app');
  put(path.join(legacy, 'resources/app.asar/package.json'), JSON.stringify({ name: 'jmgj-research-desktop', version: '0.6.0' }));
  put(path.join(legacy, 'resources/jmgj-installed.txt'), 'nsis');
  put(path.join(legacy, 'resources/data/black-marble/tile.h5'), 'old bundled data');
  put(path.join(legacy, 'resources/web/server.js'), 'old web');
  put(path.join(legacy, 'photos.txt'), 'user file');
  for (const file of ['equipment.json', 'dem/terrain.tif', 'weather/forecast.json', 'background/panorama.webp']) put(path.join(profile, file), 'keep '+file);
  const options = { installed: true, execPath: path.join(current, 'AstroSky.exe'), currentVersion: '0.7.2', cacheRoot: cache, protectedPaths: [profile] };
  function pending(ver = '0.7.2', contents = 'installer '+ver) {
    const name = `JMGJ-Research-${ver}-Windows-x64-Setup.exe`;
    put(path.join(cache, 'installer.exe'), contents);
    put(path.join(cache, 'current.blockmap'), 'blockmap '+ver);
    put(path.join(cache, 'pending', name), contents);
    put(path.join(cache, 'pending/current.blockmap'), 'blockmap '+ver);
    put(path.join(cache, 'pending/update-info.json'), JSON.stringify({ fileName: name, sha512: crypto.createHash('sha512').update(contents).digest('base64') }));
    return path.join(cache, 'pending', name);
  }
  return { root, legacy, current, profile, cache, put, options, pending };
}
function snapshot(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(e => e.isDirectory() ? snapshot(path.join(root, e.name)) : [{ file: path.join(root, e.name), bytes: fs.readFileSync(path.join(root, e.name)).toString('hex') }]);
}

test('successful upgrade reclaims only recognized old binaries and duplicate applied cache, preserving observations and active app', async t => {
  const f = fixture(t), active = snapshot(f.current), user = snapshot(f.profile);
  f.pending();
  const result = await cleanupAfterSuccessfulStart(f.options);
  assert.ok(result.legacyBytes > 0 && result.cacheBytes > 0);
  assert.equal(fs.existsSync(path.join(f.legacy, 'AstroSky.exe')), false);
  assert.equal(fs.existsSync(path.join(f.legacy, 'resources/data')), false);
  assert.deepEqual(snapshot(f.current), active);
  assert.deepEqual(snapshot(f.profile), user);
  assert.equal(fs.readFileSync(path.join(f.legacy, 'photos.txt'), 'utf8'), 'user file');
  assert.deepEqual(fs.readdirSync(f.cache).sort(), ['current.blockmap', 'installer.exe']);
  assert.deepEqual(await cleanupAfterSuccessfulStart(f.options), { legacyBytes: 0, cacheBytes: 0 });
});

test('four successful updates retain one reusable installer set rather than four version histories', async t => {
  const f = fixture(t), user = snapshot(f.profile);
  for (const ver of ['0.7.2', '0.7.3', '0.7.4', '0.7.5']) {
    f.pending(ver);
    await cleanupAfterSuccessfulStart({ ...f.options, currentVersion: ver });
    assert.deepEqual(fs.readdirSync(f.cache).sort(), ['current.blockmap', 'installer.exe']);
    assert.equal(fs.readFileSync(path.join(f.cache, 'installer.exe'), 'utf8'), 'installer '+ver);
  }
  assert.deepEqual(snapshot(f.profile), user);
});

test('future or corrupt downloads remain untouched for installation or recovery', async t => {
  const f = fixture(t), future = f.pending('0.7.3');
  await cleanupAfterSuccessfulStart(f.options);
  assert.equal(fs.existsSync(future), true);
  const installed = f.pending();
  f.put(path.join(f.cache, 'installer.exe'), 'different cached installer');
  const before = snapshot(f.cache);
  await cleanupAfterSuccessfulStart(f.options);
  assert.deepEqual(snapshot(f.cache), before);
  assert.equal(fs.existsSync(installed), true);
});

test('both verified installer and matching reusable blockmap are required before pending files are removed', async t => {
  const f = fixture(t); f.pending();
  fs.unlinkSync(path.join(f.cache, 'current.blockmap'));
  const before = snapshot(f.cache);
  await cleanupAfterSuccessfulStart(f.options);
  assert.deepEqual(snapshot(f.cache), before);
});

test('custom data inside old managed resources and unknown files are preserved', async t => {
  const f = fixture(t), data = path.join(f.legacy, 'resources/data');
  f.put(path.join(f.legacy, 'resources/notes.txt'), 'keep notes');
  const before = snapshot(data);
  await cleanupAfterSuccessfulStart({ ...f.options, protectedPaths: [f.profile, data] });
  assert.deepEqual(snapshot(data), before);
  assert.equal(fs.readFileSync(path.join(f.legacy, 'resources/notes.txt'), 'utf8'), 'keep notes');
});

test('a junction to user files in old resources is not traversed or removed', async t => {
  const f = fixture(t), backend = path.join(f.legacy, 'resources/backend');
  fs.symlinkSync(f.profile, backend, 'junction');
  const before = snapshot(f.profile);
  await cleanupAfterSuccessfulStart(f.options);
  assert.equal(fs.lstatSync(backend).isSymbolicLink(), true);
  assert.deepEqual(snapshot(f.profile), before);
});

test('unpacked, unrecognized or newer installations are not treated as obsolete', async t => {
  const f = fixture(t); f.pending();
  const before = snapshot(f.root);
  await cleanupAfterSuccessfulStart({ ...f.options, installed: false });
  assert.deepEqual(snapshot(f.root), before);
  f.put(path.join(f.legacy, 'resources/app.asar/package.json'), JSON.stringify({ name: 'another-program', version: '0.1.0' }));
  const old = snapshot(path.join(f.legacy, 'resources'));
  await cleanupAfterSuccessfulStart(f.options);
  assert.deepEqual(snapshot(path.join(f.legacy, 'resources')), old);
  assert.equal(fs.existsSync(path.join(f.legacy, 'AstroSky.exe')), true);
  f.put(path.join(f.legacy, 'resources/app.asar/package.json'), JSON.stringify({ name: 'jmgj-research-desktop', version: '0.9.0' }));
  await cleanupAfterSuccessfulStart(f.options);
  assert.equal(fs.existsSync(path.join(f.legacy, 'AstroSky.exe')), true);
});

test('aborted startup performs no destructive maintenance', async t => {
  const f = fixture(t); f.pending();
  const before = snapshot(f.root), controller = new AbortController(); controller.abort();
  await cleanupAfterSuccessfulStart({ ...f.options, signal: controller.signal });
  assert.deepEqual(snapshot(f.root), before);
});

test('the actual Electron runtime removes a physical ASAR archive without touching the live app or user data', async t => {
  const f = fixture(t), archive = path.join(f.legacy, 'resources/app.asar');
  const asar = require('@electron/asar');
  const temporaryArchive = path.join(f.root, 'legacy.asar');
  await asar.createPackage(archive, temporaryArchive);
  fs.rmSync(archive, { recursive: true }); fs.renameSync(temporaryArchive, archive);
  const active = snapshot(f.current), user = snapshot(f.profile), script = path.join(f.root, 'electron-cleanup.cjs');
  fs.writeFileSync(script, `const {app}=require('electron');app.whenReady().then(async()=>{const {cleanupAfterSuccessfulStart}=require(${JSON.stringify(path.resolve(__dirname, '../update-storage.cjs'))});console.log(JSON.stringify(await cleanupAfterSuccessfulStart({...${JSON.stringify(f.options)},log:message=>console.error(message)})));app.exit(0);}).catch(()=>app.exit(1));`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = await promisify(execFile)(require('electron'), [script], { env, windowsHide: true, timeout: 20000 });
  assert.ok(JSON.parse(child.stdout.trim()).legacyBytes > 0, child.stderr);
  assert.equal(fs.existsSync(archive), false);
  assert.deepEqual(snapshot(f.current), active);
  assert.deepEqual(snapshot(f.profile), user);
});
