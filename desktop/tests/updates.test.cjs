const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createUpdateController, isInstalled } = require('../updates.cjs');

function fixture({ installed = true, answers = [], available = true, cleanup } = {}) {
  const updater = new EventEmitter();
  const calls = [], messages = [], progress = [];
  updater.checkForUpdates = async () => {
    calls.push('check');
    if (available) updater.emit('update-available', { version: '0.4.0' });
    return { isUpdateAvailable: available, updateInfo: { version: '0.4.0' } };
  };
  updater.downloadUpdate = async () => {
    calls.push('download');
    updater.emit('download-progress', { percent: 42 });
    updater.emit('update-downloaded', { version: '0.4.0' });
  };
  updater.quitAndInstall = (...args) => calls.push(['install', ...args]);
  const window = { isDestroyed: () => false, setProgressBar: (value) => progress.push(value) };
  const controller = createUpdateController({ updater, installed, getWindow: () => window,
    dialog: { showMessageBox: async (_, options) => { messages.push(options); return { response: answers.shift() ?? 1 }; } },
    shutdown: async () => calls.push('shutdown'), cleanup });
  return { updater, calls, messages, progress, controller };
}

test('unpacked previews never contact the provider or install over the real app', async () => {
  const f = fixture({ installed: false });
  f.controller.start();
  await f.controller.check();
  assert.deepEqual(f.calls, []);
  assert.match(f.messages[0].message, /설치한 앱/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jmgj-installed-'));
  try {
    assert.equal(isInstalled(directory, true), false);
    fs.writeFileSync(path.join(directory, 'jmgj-installed.txt'), 'nsis');
    assert.equal(isInstalled(directory, true), true);
    assert.equal(isInstalled(directory, false), false);
  } finally { fs.rmSync(directory, { recursive: true }); f.controller.dispose(); }
});

test('a current version check never downloads or quits', async () => {
  const f = fixture({ available: false });
  await f.controller.check();
  assert.deepEqual(f.calls, ['check']);
  assert.match(f.messages[0].message, /최신 버전/);
  assert.equal(f.updater.autoDownload, false);
  assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal(f.updater.allowDowngrade, false);
});

test('declined background offers stay quiet for the same version until a manual check', async () => {
  const f = fixture({ answers: [1, 1] });
  await f.controller.check(false);
  await f.controller.check(false);
  assert.equal(f.messages.length, 1);
  assert.equal(f.calls.filter((value) => value === 'download').length, 0);
  await f.controller.check(true);
  assert.equal(f.messages.length, 2);
});

test('download progress is shown, deferred installation does not close the app, and later install stops workers first', async () => {
  const f = fixture({ answers: [0, 1, 0] });
  await f.controller.check();
  assert.deepEqual(f.calls, ['check', 'download']);
  assert.ok(f.progress.includes(.42));
  assert.equal(f.controller.getState().phase, 'downloaded');
  await f.controller.check();
  assert.deepEqual(f.calls, ['check', 'download', 'shutdown', ['install', false, true]]);
  assert.equal(f.controller.getState().phase, 'installing');
});

test('repeated checks share the in-flight operation and never duplicate a download', async () => {
  const f = fixture({ answers: [0, 1] });
  let finish;
  const download = f.updater.downloadUpdate;
  f.updater.downloadUpdate = async () => { await new Promise((resolve) => { finish = resolve; }); await download(); };
  const first = f.controller.check();
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.controller.check(), first);
  finish();
  await first;
  assert.deepEqual(f.calls, ['check', 'download']);
});

test('a checksum/download failure retains the current app and permits retry without exposing raw errors', async () => {
  const f = fixture({ answers: [0] });
  f.updater.downloadUpdate = async () => { f.calls.push('download'); throw new Error('private upstream diagnostics'); };
  await f.controller.check();
  assert.deepEqual(f.calls, ['check', 'download']);
  assert.equal(f.controller.getState().phase, 'idle');
  assert.match(f.messages.at(-1).message, /완료하지 못/);
  assert.ok(!JSON.stringify(f.messages).includes('private upstream diagnostics'));
  assert.equal(f.progress.at(-1), -1);
});

test('offline background checks remain silent while manual checks explain the failure', async () => {
  const f = fixture();
  f.updater.checkForUpdates = async () => { throw new Error('offline'); };
  await f.controller.check(false);
  assert.equal(f.messages.length, 0);
  await f.controller.check(true);
  assert.equal(f.messages.length, 1);
  assert.equal(f.controller.getState().phase, 'idle');
});

test('checks wait for startup maintenance once and a cleanup failure never disables updates', async () => {
  let finish, count = 0;
  const f = fixture({ available: false, cleanup: () => { count++; return new Promise(resolve => { finish = resolve; }); } });
  const checking = f.controller.check();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls, []);
  finish(); await checking; await f.controller.check();
  assert.equal(count, 1);
  assert.deepEqual(f.calls, ['check', 'check']);
  const broken = fixture({ available: false, cleanup: async () => { throw Error('locked file'); } });
  await broken.controller.check();
  assert.deepEqual(broken.calls, ['check']);
});
