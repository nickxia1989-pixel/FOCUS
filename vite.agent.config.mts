// 把 MCP 服务端打包成一个不依赖 node_modules 的单文件：dist-agent/focus-mcp.mjs
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'src/agent/node/main.ts',
    outDir: 'dist-agent',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rolldownOptions: {
      output: { entryFileNames: 'focus-mcp.mjs', format: 'es', banner: '#!/usr/bin/env node' },
    },
  },
  ssr: { noExternal: true, target: 'node' },
});
