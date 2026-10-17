// iOS 端的同步接线：WebDAV 请求走 CapacitorHttp（原生 URLSession，不受网页跨域限制），
// 应用密码存钥匙串。打开 / 回到前台立即同步，前台每 15 秒轮询；切到后台申请一小段时间把改动传完。
import { App } from '@capacitor/app';
import { CapacitorHttp } from '@capacitor/core';
import { emptyDoc } from '../sync/doc';
import { SyncEngine, testConnection, type DeviceInfo, type EngineHost } from '../sync/engine';
import type { DavError, HttpRequest, HttpResult, Transport } from '../sync/webdav';
import { keychainDelete, keychainGet, keychainSet, withBackgroundTime } from './focusNative';
import { isNative } from './native';
import { loadSyncConfig, saveSyncConfig as storeConfig } from './storage';
import { persistNow, setLocalChangeListener, useData } from './store';

export interface MobileSyncConfig {
  baseUrl: string;
  user: string;
  folder: string;
  deviceName: string;
}

const DEFAULT_CONFIG: MobileSyncConfig = {
  baseUrl: 'https://dav.jianguoyun.com/dav/',
  user: '',
  folder: 'FOCUS',
  deviceName: 'iPhone',
};
const PASSWORD_KEY = 'webdav-password';
const POLL_MS = 15_000;

let config: MobileSyncConfig = DEFAULT_CONFIG;
let password: string | null = null;
let engine: SyncEngine | null = null;
let simOffline = false;

/** 只允许 https；明文 http 只给本机测试服务器用 */
function checkBaseUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u;
}

function encodePath(p: string) {
  const segs = p
    .split('/')
    .filter((s) => s && s !== '.' && s !== '..')
    .map((s) => encodeURIComponent(s));
  return segs.length ? segs.join('/') + (p.endsWith('/') ? '/' : '') : '';
}

const basicAuth = (user: string, pass: string) => {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `Basic ${btoa(bin)}`;
};

async function request(req: HttpRequest): Promise<HttpResult> {
  if (simOffline) return { ok: false, error: 'network', message: '模拟离线' };
  const base = checkBaseUrl(config.baseUrl);
  if (!base || !config.user || !password) return { ok: false, error: 'config', message: '同步设置不完整' };
  const url = new URL(encodePath(req.path), base).toString();
  try {
    const r = await CapacitorHttp.request({
      url,
      method: req.method,
      headers: {
        Authorization: basicAuth(config.user, password),
        'X-Focus-Device': useData.getState().clock.deviceId,
        ...(req.headers ?? {}),
      },
      data: req.body,
      responseType: 'text',
      connectTimeout: 20_000,
      readTimeout: 20_000,
    });
    // 有的服务器回 application/json，插件会自动解析成对象：还原成文本再交给解析器
    const body = typeof r.data === 'string' ? r.data : r.data == null ? '' : JSON.stringify(r.data);
    return { ok: true, status: r.status, body, headers: {} };
  } catch (e) {
    return { ok: false, error: 'network', message: String((e as Error)?.message ?? e) };
  }
}

const transport: Transport = { request };

function host(): EngineHost {
  return {
    transport,
    folder: () => config.folder || 'FOCUS',
    deviceId: () => useData.getState().clock.deviceId,
    nonce: () => useData.getState().local.nonce,
    deviceName: () => config.deviceName || 'iPhone',
    platform: 'ios',
    state: () => {
      const s = useData.getState();
      // 选了「以云端为准」还没读到云端时，不能把本机旧数据传上去
      return { doc: s.local.sync.replacePending ? emptyDoc() : s.doc, clock: s.clock };
    },
    merge: (doc, knowledge) => useData.getState().mergeRemote(doc, knowledge),
    meta: () => useData.getState().local.sync.meta,
    setMeta: (m) => useData.getState().setSyncMeta(m),
    identityClash: () => void useData.getState().regenerateDeviceId(),
    onStatus: (s) => useData.setState({ syncStatus: { ...s } }),
    now: () => Date.now(),
  };
}

const ensureEngine = () => (engine ??= new SyncEngine(host()));

export async function loadConfig() {
  const raw = (await loadSyncConfig()) as Partial<MobileSyncConfig> | null;
  config = { ...DEFAULT_CONFIG, ...(raw ?? {}) };
  password = await keychainGet(PASSWORD_KEY);
  return { ...config, hasPassword: !!password };
}

export async function saveConfig(input: Partial<MobileSyncConfig> & { password?: string }): Promise<{ ok: boolean; message?: string }> {
  const next: MobileSyncConfig = {
    baseUrl: (input.baseUrl ?? config.baseUrl).trim(),
    user: (input.user ?? config.user).trim(),
    folder: (input.folder ?? config.folder).trim().replace(/^\/+|\/+$/g, '') || 'FOCUS',
    deviceName: (input.deviceName ?? config.deviceName).trim().slice(0, 40) || 'iPhone',
  };
  if (!checkBaseUrl(next.baseUrl)) return { ok: false, message: '服务器地址必须是 https://' };
  if (typeof input.password === 'string') {
    if (input.password === '') await keychainDelete(PASSWORD_KEY);
    else if (!(await keychainSet(PASSWORD_KEY, input.password))) return { ok: false, message: '钥匙串保存失败' };
  }
  config = next;
  await storeConfig(next);
  password = await keychainGet(PASSWORD_KEY);
  return { ok: true };
}

export const checkConnection = (): Promise<{ ok: true } | { error: DavError }> => testConnection(transport);
export const probeCloud = (): Promise<{ devices: DeviceInfo[] } | { error: DavError }> => ensureEngine().probe();

export async function enableSync(mode: 'merge' | 'cloud' = 'merge') {
  if (mode === 'cloud') await useData.getState().resetForCloud();
  useData.getState().setSyncEnabled(true);
  ensureEngine().start(POLL_MS);
}

export function disableSync() {
  useData.getState().setSyncEnabled(false);
  engine?.stop();
}

export const syncNow = () => engine?.requestSync();
export const isSimulatedOffline = () => simOffline;
export function setSimulatedOffline(flag: boolean) {
  simOffline = flag;
  if (!flag) engine?.requestSync();
}

/** 应用启动后调用 */
export async function initSync() {
  await loadConfig();
  setLocalChangeListener(() => engine?.notifyLocalChange());
  if (useData.getState().local.sync.enabled && password) ensureEngine().start(POLL_MS);

  window.addEventListener('online', () => engine?.requestSync());
  if (!isNative) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') engine?.requestSync();
    });
    return;
  }
  void App.addListener('appStateChange', ({ isActive }) => {
    if (!engine?.enabled) return;
    if (isActive) {
      engine.setPolling(POLL_MS);
      engine.requestSync();
    } else {
      // 进后台：停掉轮询，先落盘，再用系统给的一小段时间把改动传完
      engine.setPolling(0);
      persistNow();
      void withBackgroundTime(() => engine!.flush());
    }
  });
}
