const { app, BrowserWindow, Menu, dialog, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { safeExternal, freePort, loadConfig, saveConfig, waitReady, stopWorker } = require('./runtime.cjs');
const { createUpdateController, isInstalled } = require('./updates.cjs');
const publicServices = require('./public-services.json');

const localRoot = process.env.JMGJ_DESKTOP_PROFILE || path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'jmgj-research', 'desktop');
app.setPath('userData', localRoot);
app.setPath('sessionData', path.join(localRoot, 'browser'));
app.setAppUserModelId('io.github.root0323.jmgj-research');
const children = [];
let win;
let shuttingDown = false;
let shutdownPromise;
const startupAbort = new AbortController();
const timings = {};
const launchedAt = performance.now();
let config;
let updates;
let stage = 'initialize';
const configFile = path.join(localRoot, 'config.json');
const diagnostics = process.argv.includes('--diagnostics');

function log(message) {
  // A temporarily locked log must never prevent the app from opening/quitting.
  try {
    fs.mkdirSync(localRoot, { recursive: true });
    fs.appendFileSync(path.join(localRoot, 'startup.log'), `${new Date().toISOString()} ${message}\n`);
  } catch { /* No credentials or raw errors are written to alternative files. */ }
}

async function measure(name, operation) {
  const started = performance.now();
  log(`${name} starting`);
  try { return await operation(); }
  catch (error) { error.stage = name; throw error; }
  finally {
    timings[name] = Math.round(performance.now() - started);
    log(`${name} elapsed ${timings[name]}ms`);
  }
}

function worker(name, command, args, env, cwd) {
  startupAbort.signal.throwIfAborted();
  const child = spawn(command, args, { env, cwd, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  child.stdin.on('error', () => {}); // A worker may exit before shutdown closes its pipe.
  // Child stderr is intentionally not persisted: provider URLs may contain keys.
  child.stderr.on('data', () => {});
  child.once('error', () => { child.startError = true; log(`${name} spawn failed`); });
  child.once('exit', (code) => {
    log(`${name} exit ${code ?? 'signal'}`);
    if (stage === 'ready' && win && !shuttingDown) {
      dialog.showErrorBox('JMGJ Research', '내장 서버가 종료됐습니다. 앱을 다시 실행해 주세요.');
      app.quit();
    }
  });
  children.push(child);
  return child;
}

function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  startupAbort.abort();
  shutdownPromise = Promise.all(children.map(child => stopWorker(child)));
  return shutdownPromise;
}

async function createWindow() {
  win = new BrowserWindow({ title: 'JMGJ Research', width: 1360, height: 900, minWidth: 960, minHeight: 640,
    backgroundColor: '#060a12', show: false, webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false,
      allowRunningInsecureContent: false, spellcheck: false } });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (safeExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const origin = config ? `http://127.0.0.1:${config.port}` : null;
    if (!origin || new URL(url).origin !== origin) {
      event.preventDefault();
      if (safeExternal(url)) void shell.openExternal(url);
    }
  });
  win.on('closed', () => { win = undefined; });
  Menu.setApplicationMenu(null);
  await win.loadFile(path.join(__dirname, 'startup.html'));
  timings.loadingWindow = Math.round(performance.now() - launchedAt);
  if (!diagnostics) win.show();
}

function setupSession(origin, token) {
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler((contents, permission, requestingOrigin) =>
    permission === 'geolocation' && contents === win?.webContents && requestingOrigin === origin);
  ses.setPermissionRequestHandler(async (contents, permission, callback, details) => {
    if (permission !== 'geolocation' || contents !== win?.webContents || !details.isMainFrame ||
        new URL(contents.getURL()).origin !== origin) return callback(false);
    const result = await dialog.showMessageBox(win, { type: 'question', title: '현재 위치',
      message: '관측 장소를 설정하기 위해 현재 위치를 사용할까요?', buttons: ['허용', '취소'], defaultId: 1, cancelId: 1 });
    callback(result.response === 0);
  });
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith(origin + '/')) return callback({ responseHeaders: details.responseHeaders });
    callback({ responseHeaders: { ...details.responseHeaders,
      'Content-Security-Policy': ["default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https: http://stelladata.noctua-software.com; worker-src 'self' blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"],
      'X-Content-Type-Options': ['nosniff'], 'Referrer-Policy': ['no-referrer'] } });
  });
  return ses.cookies.set({ url: origin, name: 'jmgj-desktop-session', value: token,
    httpOnly: true, sameSite: 'strict', path: '/' });
}

async function connectData() {
  const result = await dialog.showOpenDialog(win, { title: 'dem·black-marble 폴더가 들어 있는 데이터 폴더 선택',
    defaultPath: config.dataRoot, properties: ['openDirectory'] });
  if (result.canceled) return;
  const selected = result.filePaths[0];
  if (!['dem/Copernicus-GLO-90', 'black-marble/VJ146A4-2025'].some((name) => fs.existsSync(path.join(selected, name)))) {
    await dialog.showMessageBox(win, { type: 'info', message: '선택한 폴더에서 DEM 또는 Black Marble 자료를 찾지 못했습니다.' });
    return;
  }
  config.dataRoot = selected;
  delete config.assetRoot;
  saveConfig(configFile, config);
  await dialog.showMessageBox(win, { message: '기존 자료를 연결했습니다. 앱을 다시 실행하면 적용됩니다.' });
}

function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '앱', submenu: [{ label: '다시 불러오기', role: 'reload' }, { role: 'togglefullscreen', label: '전체 화면' },
      { type: 'separator' }, { label: '종료', role: 'quit' }] },
    { label: '데이터', submenu: [
      { label: '데이터 폴더 열기', click: () => shell.openPath(config.dataRoot) },
      { label: '기존 데이터 폴더 연결…', click: connectData },
      { label: '앱 설정·캐시 폴더 열기', click: () => shell.openPath(localRoot) } ] },
    { label: '도움말', submenu: [
      { id: 'check-for-updates', label: '업데이트 확인…', click: () => void updates?.check() },
      { label: '연구 GitHub', click: () => shell.openExternal('https://github.com/root0323/jmgj-research') },
      { label: '앱 정보', click: () => dialog.showMessageBox(win, { title: 'JMGJ Research',
        message: `JMGJ Research ${app.getVersion()}`, detail: '개인 연구용 Windows 미리보기\n기상·천체 사진·장소 검색은 인터넷이 필요합니다.\n개인 기상 API 키는 앱 화면의 메모리에만 유지됩니다.' }) } ] },
  ]));
}

async function start() {
  await createWindow();
  startupAbort.signal.throwIfAborted();
  stage = 'configuration';
  config = await loadConfig(configFile, path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'jmgj-research'));
  fs.mkdirSync(config.dataRoot, { recursive: true });
  const origin = `http://127.0.0.1:${config.port}`;
  const token = crypto.randomBytes(32).toString('hex');
  const backendPort = await freePort();
  const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'build');
  const backend = app.isPackaged ? path.join(resources, 'backend') : path.join(resources, 'backend', 'jmgj-backend');
  const web = path.join(resources, 'web');
  const env = { ...process.env, JMGJ_DESKTOP_TOKEN: token, JMGJ_DESKTOP_ORIGIN: origin,
    JMGJ_BACKEND_PORT: String(backendPort), PYTHONUTF8: '1',
    JMGJ_SETTINGS_FILE: path.join(localRoot, 'operator.env'),
    KAKAO_PROXY_URL: publicServices.kakaoProxyUrl || process.env.KAKAO_PROXY_URL || '',
    RESEARCH_ASSET_DIR: config.assetRoot || path.join(config.dataRoot, 'assets'),
    BLACK_MARBLE_GLOBAL_DIR: path.join(config.dataRoot, 'black-marble', 'VJ146A4-2025'),
    BLACK_MARBLE_BUNDLED_DIR: path.join(resources, 'data', 'black-marble', 'VJ146A4-2025'),
    DEM_GLOBAL_DIR: path.join(config.dataRoot, 'dem', 'Copernicus-GLO-90'),
    FRONTEND_ORIGINS: origin, RESEARCH_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
    GEOCODE_BACKEND_URL: `http://127.0.0.1:${backendPort}`, NODE_ENV: 'production',
    HOSTNAME: '127.0.0.1', PORT: String(config.port), ELECTRON_RUN_AS_NODE: '1', NEXT_TELEMETRY_DISABLED: '1' };
  stage = 'services';
  const readiness = { signal: startupAbort.signal };
  // Independent workers prepare together. A failed/cancelled launch is always
  // cleaned up before a retry; no previous private server is reused.
  worker('backend', path.join(backend, 'jmgj-backend.exe'), [], env, backend);
  worker('frontend', process.execPath, [path.join(web, 'desktop-server.cjs')], env, web);
  await Promise.all([
    measure('backend', () => waitReady(`http://127.0.0.1:${backendPort}/api/health/ready`,
      { 'x-jmgj-desktop-token': token }, children, readiness)),
    measure('frontend', () => waitReady(`${origin}/api/desktop-ready`,
      { Cookie: `jmgj-desktop-session=${token}` }, children, readiness)),
    measure('session', () => setupSession(origin, token)),
  ]);
  startupAbort.signal.throwIfAborted();
  stage = 'window';
  menu();
  if (!diagnostics) {
    const { autoUpdater } = await measure('updater', async () => require('electron-updater'));
    updates = createUpdateController({ updater: autoUpdater,
      installed: isInstalled(resources, app.isPackaged), getWindow: () => win, dialog, shutdown, log,
      onState: ({ phase, percent }) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById('check-for-updates');
        if (item) item.label = phase === 'checking' ? '업데이트 확인 중…'
          : phase === 'downloading' ? `업데이트 다운로드 중 · ${Math.floor(percent)}%`
          : phase === 'downloaded' ? '업데이트 설치·재시작…' : '업데이트 확인…';
      } });
  }
  await measure('page', () => win.loadURL(origin));
  startupAbort.signal.throwIfAborted();
  stage = 'ready';
  timings.total = Math.round(performance.now() - launchedAt);
  log(`ready elapsed ${timings.total}ms`);
  if (diagnostics) {
    // Health checks only; no weather/API calls and no user credentials.
    const unauthed = await fetch(origin);
    const backendDenied = await fetch(`http://127.0.0.1:${backendPort}/api/health`);
    fs.writeFileSync(path.join(localRoot, 'diagnostics.json'), JSON.stringify({
      ready: true, version: app.getVersion(), frontendPort: config.port, backendPort,
      timings,
      frontendDenied: unauthed.status, backendDenied: backendDenied.status,
      packaged: app.isPackaged,
      updateFeedConfigured: fs.existsSync(path.join(resources, 'app-update.yml')),
      installed: isInstalled(resources, app.isPackaged),
      blackMarbleBundled: fs.existsSync(path.join(env.BLACK_MARBLE_BUNDLED_DIR, 'index.json')),
      dataConnected: ['dem/Copernicus-GLO-90/index.sqlite', 'black-marble/VJ146A4-2025/index.json']
        .map((name) => fs.existsSync(path.join(config.dataRoot, name))) }, null, 2));
    app.quit();
  } else { win.show(); updates.start(); }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    updates?.dispose();
    if (!shuttingDown) { event.preventDefault(); void shutdown().then(() => app.quit()); }
  });
  app.whenReady().then(start).catch(async (error) => {
    if (shuttingDown) return;
    const failedStage = error.stage || stage;
    const reason = ['EADDRINUSE', 'WORKER_EXIT', 'STARTUP_TIMEOUT'].includes(error.code) ? error.code : 'STARTUP_FAILED';
    log(`startup failed at ${failedStage} (${reason})`);
    await shutdown();
    if (!diagnostics) dialog.showErrorBox('JMGJ Research 시작 실패',
      `${reason === 'EADDRINUSE' ? '앱의 로컬 포트가 사용 중입니다. 다른 실행 창을 닫고 다시 실행해 주세요.'
        : reason === 'STARTUP_TIMEOUT' ? '앱 준비 시간이 초과됐습니다. 잠시 뒤 다시 실행해 주세요.'
        : '내장 서버를 실행하지 못했습니다. 앱을 다시 실행해 주세요.'}\n설정·로그 폴더: ${localRoot}`);
    app.exit(1);
  });
}
