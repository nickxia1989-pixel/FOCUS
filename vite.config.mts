/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// 仅在打包产物里加 CSP：开发时 react-refresh 需要内联脚本
const csp: Plugin = {
  name: 'focus-csp',
  apply: 'build',
  transformIndexHtml(html) {
    return html.replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:" />`,
    );
  },
};

export default defineConfig({
  plugins: [react(), csp],
  // Electron 打包后用 file:// 加载，资源路径必须是相对的
  base: './',
  server: {
    port: 5199,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
