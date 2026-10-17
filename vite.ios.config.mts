// iOS（Capacitor）版的独立构建：入口在 src/mobile/index.html，产物给 cap sync 用
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/mobile',
  plugins: [react()],
  base: './',
  server: {
    port: 5299,
    strictPort: true,
    // 真机 / 模拟器热更新时要能从局域网访问
    host: true,
  },
  build: {
    outDir: '../../dist-ios',
    emptyOutDir: true,
  },
});
