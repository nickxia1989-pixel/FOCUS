/// <reference types="node" />
// 实时模式：桌面开着时，经 127.0.0.1 上的本地接口（令牌鉴权）交给桌面的 store 执行。
import fs from 'node:fs';
import { AGENT_API } from '../core';
import { files } from './paths';

interface Endpoint {
  api: number;
  port: number;
  token: string;
  pid: number;
}

function readEndpoint(dir: string): Endpoint | null {
  try {
    const e = JSON.parse(fs.readFileSync(files(dir).endpoint, 'utf8')) as Partial<Endpoint>;
    if (typeof e.port === 'number' && typeof e.token === 'string' && typeof e.pid === 'number') return { api: e.api ?? 0, port: e.port, token: e.token, pid: e.pid };
  } catch {}
  return null;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export type LiveResult<T> =
  /** 桌面执行了，value 是它的回复 */
  | { kind: 'ok'; value: T }
  /** 请求没送到桌面的界面（桌面没开、没有窗口、正在重载）：可以放心改走离线模式 */
  | { kind: 'unavailable'; reason: string }
  /** 请求已经发出、但没等到回复：桌面可能已经执行了 */
  | { kind: 'unknown'; reason: string }
  /** 桌面拒绝（令牌不对、版本不一致） */
  | { kind: 'refused'; reason: string };

export async function liveCall<T>(dir: string, method: 'read' | 'apply', params: unknown, timeoutMs: number): Promise<LiveResult<T>> {
  const ep = readEndpoint(dir);
  if (!ep) return { kind: 'unavailable', reason: '桌面没开' };
  if (!pidAlive(ep.pid)) return { kind: 'unavailable', reason: '桌面没开（上次没正常退出，留下了旧的连接信息）' };
  if (ep.api !== AGENT_API) return { kind: 'refused', reason: `桌面版的接口版本是 ${ep.api}，这个 MCP 是 ${AGENT_API}：两边用同一份代码重新构建` };
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${ep.port}/v1/rpc`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ep.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ api: AGENT_API, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    if (err.cause?.code === 'ECONNREFUSED') return { kind: 'unavailable', reason: '桌面没开（连接被拒绝）' };
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return { kind: 'unknown', reason: '桌面没有及时回应' };
    return { kind: 'unknown', reason: `和桌面的连接出错：${err.cause?.code ?? err.message}` };
  }
  let body: { ok?: boolean; value?: T; error?: string; reason?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {}
  if (res.status === 200 && body.ok) return { kind: 'ok', value: body.value as T };
  if (res.status === 503) return { kind: 'unavailable', reason: body.reason ?? '桌面界面还没就绪' };
  if (res.status === 504) return { kind: 'unknown', reason: body.reason ?? '桌面没有及时回应' };
  // 4xx 是转给界面之前就拒绝了；5xx 是界面执行时出错，不能确定有没有生效
  if (res.status >= 400 && res.status < 500) return { kind: 'refused', reason: body.error ?? body.reason ?? `桌面返回 ${res.status}` };
  return { kind: 'unknown', reason: body.error ?? body.reason ?? `桌面返回 ${res.status}` };
}
