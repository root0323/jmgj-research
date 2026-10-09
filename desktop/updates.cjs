const fs = require('node:fs');
const path = require('node:path');

function isInstalled(resources, packaged) {
  if (!packaged) return false;
  try { return fs.readFileSync(path.join(resources, 'jmgj-installed.txt'), 'utf8') === 'nsis'; }
  catch { return false; }
}

function createUpdateController({ updater, installed, getWindow, dialog, shutdown, log = () => {}, onState = () => {} }) {
  let state = { phase: 'idle', version: '', percent: 0 };
  let active;
  let ignoredVersion = '';
  const timers = [];
  const listeners = [];
  const window = () => { const value = getWindow(); return value && !value.isDestroyed() ? value : undefined; };
  function change(values) {
    state = { ...state, ...values };
    onState({ ...state });
  }
  function show(options) {
    const owner = window();
    return owner ? dialog.showMessageBox(owner, { title: 'AstroSky 업데이트', ...options }) : Promise.resolve({ response: 1 });
  }
  function listen(event, handler) { updater.on(event, handler); listeners.push([event, handler]); }
  // Only this controller can initiate downloads or installation. Ordinary app
  // exit must never silently install a previously downloaded version.
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  updater.allowPrerelease = false;
  updater.disableDifferentialDownload = false;
  updater.disableWebInstaller = true;
  updater.logger = { info() {}, warn() {}, error() {}, debug() {} };
  listen('error', () => log('update operation failed'));
  listen('update-available', (info) => change({ phase: 'available', version: String(info.version).slice(0, 80) }));
  listen('download-progress', (progress) => {
    const percent = Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : 0;
    change({ phase: 'downloading', percent });
    window()?.setProgressBar(percent / 100);
  });
  listen('update-downloaded', (info) => {
    change({ phase: 'downloaded', version: String(info.version).slice(0, 80), percent: 100 });
    window()?.setProgressBar(-1);
  });

  async function offerInstall() {
    const answer = await show({ type: 'info', message: `${state.version} 업데이트 준비가 끝났습니다.`,
      detail: '앱을 다시 시작하면 적용됩니다. 저장된 설정·기상 캐시·DEM은 유지됩니다.',
      buttons: ['지금 재시작', '나중에'], defaultId: 1, cancelId: 1 });
    if (answer.response !== 0 || !window()) return;
    change({ phase: 'installing' });
    await shutdown(); // Stop Next and Python before NSIS replaces their files.
    updater.quitAndInstall(false, true);
  }

  async function run(manual) {
    let downloading = false;
    try {
      if (!installed) {
        if (manual) await show({ type: 'info', message: '설치한 앱에서 업데이트할 수 있습니다.',
          detail: 'Setup.exe로 설치한 앱을 실행해 주세요. 폴더에서 바로 실행한 미리보기에는 업데이트를 설치하지 않습니다.', buttons: ['확인'] });
        return;
      }
      if (state.phase === 'downloaded') return await offerInstall();
      change({ phase: 'checking' });
      const result = await updater.checkForUpdates();
      if (!result?.isUpdateAvailable) {
        change({ phase: 'idle', version: '' });
        if (manual) await show({ type: 'info', message: '현재 최신 버전입니다.', buttons: ['확인'] });
        return;
      }
      change({ phase: 'available', version: String(result.updateInfo.version).slice(0, 80) });
      if (!manual && ignoredVersion === state.version) return;
      const answer = await show({ type: 'info', message: `새 버전 ${state.version}이 있습니다.`,
        detail: '앱 안에서 업데이트를 다운로드합니다. 설치 시점은 다운로드 후 선택할 수 있습니다.',
        buttons: ['다운로드', '나중에'], defaultId: 1, cancelId: 1 });
      if (answer.response !== 0 || !window()) { ignoredVersion = state.version; return; }
      downloading = true;
      change({ phase: 'downloading', percent: 0 });
      await updater.downloadUpdate(); // Library verifies the release SHA-512.
      change({ phase: 'downloaded', percent: 100 });
      window()?.setProgressBar(-1);
      await offerInstall();
    } catch (error) {
      change({ phase: 'idle', version: '', percent: 0 });
      window()?.setProgressBar(-1);
      log('update failed; current app retained');
      if (manual || downloading) await show({ type: 'info',
        message: ['ERR_UPDATER_LATEST_VERSION_NOT_FOUND', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS'].includes(error.code)
          ? '공개된 업데이트가 아직 없습니다.' : '업데이트를 완료하지 못했습니다.',
        detail: '현재 앱은 계속 사용할 수 있습니다. 인터넷 연결과 공개 릴리스 상태를 확인하고 다시 시도해 주세요.', buttons: ['확인'] });
    }
  }

  function check(manual = true) {
    if (active || state.phase === 'installing') return active ?? Promise.resolve();
    active = run(manual).finally(() => { active = undefined; });
    return active;
  }
  return {
    check,
    getState: () => ({ ...state }),
    start() {
      if (!installed || timers.length) return;
      timers.push(setTimeout(() => void check(false), 20_000));
      timers.push(setInterval(() => void check(false), 6 * 60 * 60 * 1000));
      timers.forEach((timer) => timer.unref?.());
    },
    dispose() {
      timers.forEach((timer) => { clearTimeout(timer); clearInterval(timer); });
      listeners.forEach(([event, handler]) => updater.removeListener(event, handler));
    },
  };
}

module.exports = { createUpdateController, isInstalled };
