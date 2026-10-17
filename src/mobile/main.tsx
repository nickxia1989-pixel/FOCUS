import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { MobileApp } from './MobileApp';
import { isNative, trackKeyboard } from './native';
import './widget';
// 设计里的 Display 字体（英文标签、列表名、数字），随网页包打进 App，不往 iOS 工程里加字体文件
import '@fontsource/bricolage-grotesque/latin-700.css';
import '@fontsource/bricolage-grotesque/latin-800.css';
import './mobile.css';

if (isNative) document.documentElement.classList.add('is-native');
trackKeyboard();

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <MobileApp />
  </ErrorBoundary>,
);

// 联调测试包才有：VITE_FOCUS_E2E=1 npm run ios:build（正式构建时这一段会被整个去掉）
if (import.meta.env.VITE_FOCUS_E2E === '1') void import('./e2e');
