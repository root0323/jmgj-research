import { initializeBrowser } from './bridge';
import './pwa.css';
initializeBrowser().then(() => import('../../android/web/src/main')).catch(error => {
  const root = document.getElementById('root')!;
  root.textContent = error instanceof Error ? error.message : '앱을 준비하지 못했습니다. 최신 Safari에서 다시 접속해 주세요.';
});
