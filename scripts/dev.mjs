// 开发模式：启动 Vite 开发服务器，再用它的地址拉起 Electron
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electronPath from 'electron';

const server = await createServer();
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5199/';
console.log(`[dev] renderer: ${url}`);

const env = { ...process.env, VITE_DEV_SERVER_URL: url };
// 某些终端会带上这个变量，Electron 会被当成纯 Node 运行
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });
child.on('close', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
