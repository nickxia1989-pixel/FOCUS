import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { MobileApp } from './MobileApp';
import { isNative, trackKeyboard } from './native';
import './widget';
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
