/// <reference types="node" />
// 数据目录和文件名：和桌面版（electron/main.cjs、electron/agent.cjs）一致。
import os from 'node:os';
import path from 'node:path';

/** 跟桌面版一样：FOCUS_USER_DATA 优先，否则是系统的应用数据目录 */
export function userDataDir(): string {
  const env = process.env.FOCUS_USER_DATA;
  if (env) return path.resolve(env);
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'FOCUS');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'FOCUS');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'FOCUS');
}

export const files = (dir: string) => ({
  doc: path.join(dir, 'focus-doc.json'),
  docBak: path.join(dir, 'focus-doc.bak.json'),
  local: path.join(dir, 'focus-local.json'),
  /** 旧版本（迁移前）的数据：有它没有 focus-doc.json，说明还没打开过新版 */
  legacy: [path.join(dir, 'profiles.json'), path.join(dir, 'focus-data.json')],
  /** 桌面运行时写，退出时删：本地接口的端口和令牌 */
  endpoint: path.join(dir, 'agent-endpoint.json'),
  agentDir: path.join(dir, 'agent'),
  outbox: path.join(dir, 'agent', 'outbox.json'),
  state: path.join(dir, 'agent', 'state.json'),
  lock: path.join(dir, 'agent', 'lock'),
});

/** 测试时可以强制只走一种模式 */
export function forcedMode(): 'live' | 'offline' | null {
  const m = process.env.FOCUS_AGENT_MODE;
  return m === 'live' || m === 'offline' ? m : null;
}
