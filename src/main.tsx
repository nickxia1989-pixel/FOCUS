import { createRoot } from 'react-dom/client';
// 品牌字 Bricolage Grotesque（OFL，随应用打包）：只用于英文标签、列表名和数字
import '@fontsource/bricolage-grotesque/latin-700.css';
import '@fontsource/bricolage-grotesque/latin-800.css';
import App from './App';
import { initAgentBridge } from './agent/bridge';
import { ErrorBoundary } from './components/ErrorBoundary';
import { os } from './platform';
import './styles.css';

// Mac / Windows 两套标题栏和字体
document.documentElement.classList.add(`os-${os}`);

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

// AI agent 本地接口（实时模式）和离线 outbox 的并入
initAgentBridge();

// 开发调试：控制台 / 联调脚本里用 window.__focus 直接拿 store 和带动效的操作（打包后不含）
if (import.meta.env.DEV) {
  void Promise.all([import('./store'), import('./actions'), import('./sync/ops')]).then(([store, actions, ops]) =>
    Object.assign(window, { __focus: { ...store, actions, ops } }),
  );
}
