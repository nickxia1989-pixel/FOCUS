import { createRoot } from 'react-dom/client';
import App from './App';
import { initAgentBridge } from './agent/bridge';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

// AI agent 本地接口（实时模式）和离线 outbox 的并入
initAgentBridge();
