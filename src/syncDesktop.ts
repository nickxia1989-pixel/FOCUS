// 桌面端的同步接线：用 Electron 主进程转发 WebDAV 请求（凭证只在主进程），
// 窗口获得焦点、联网、电脑唤醒时立即同步，睡眠 / 锁屏 / 退出前先把改动传完。
import { api, type SyncConfigInput, type SyncConfigView } from './platform';
import { setLocalChangeListener, useData } from './store';
import { emptyDoc } from './sync/doc';
import { SyncEngine, testConnection, type DeviceInfo, type EngineHost } from './sync/engine';
import type { DavError, Transport } from './sync/webdav';

let engine: SyncEngine | null = null;
let config: SyncConfigView | null = null;

const transport: Transport = {
  request: (req) =>
    api ? api.syncRequest({ ...req, deviceId: useData.getState().clock.deviceId }) : Promise.resolve({ ok: false, error: 'config', message: '只有桌面版能同步' }),
};

function host(): EngineHost {
  return {
    transport,
    folder: () => config?.folder ?? 'FOCUS',
    deviceId: () => useData.getState().clock.deviceId,
    nonce: () => useData.getState().local.nonce,
    deviceName: () => config?.deviceName ?? 'Mac',
    platform: api?.platform ?? 'web',
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

function ensureEngine() {
  engine ??= new SyncEngine(host());
  return engine;
}

export async function loadSyncConfig(): Promise<SyncConfigView | null> {
  if (!api) return null;
  config = await api.getSyncConfig();
  return config;
}

export async function saveSyncConfig(input: SyncConfigInput) {
  if (!api) return { ok: false, message: '只有桌面版能同步' };
  const r = await api.setSyncConfig(input);
  await loadSyncConfig();
  return r;
}

export async function checkConnection(): Promise<{ ok: true } | { error: DavError }> {
  return testConnection(transport);
}

/** 加入前看看云端有没有别的设备的数据 */
export async function probeCloud(): Promise<{ devices: DeviceInfo[] } | { error: DavError }> {
  return ensureEngine().probe();
}

/**
 * 开启同步。mode：
 * - merge：本机数据与云端合并
 * - cloud：以云端为准（本机文档先备份再清空）
 */
export async function enableSync(mode: 'merge' | 'cloud' = 'merge') {
  await loadSyncConfig();
  if (mode === 'cloud') await useData.getState().resetForCloud();
  useData.getState().setSyncEnabled(true);
  ensureEngine().start();
}

export function disableSync() {
  useData.getState().setSyncEnabled(false);
  engine?.stop();
}

export function syncNow() {
  engine?.requestSync();
}

let simOffline = false;
export const isSimulatedOffline = () => simOffline;

export async function setSimulatedOffline(flag: boolean) {
  simOffline = flag;
  await api?.setSimOffline(flag);
  if (!flag) engine?.requestSync();
}

/** 应用启动后调用：之前开着同步就接着开，并挂上各种触发时机 */
export async function initSync() {
  if (!api) return;
  await loadSyncConfig();
  setLocalChangeListener(() => engine?.notifyLocalChange());
  if (useData.getState().local.sync.enabled && config?.hasPassword) ensureEngine().start();

  window.addEventListener('focus', () => engine?.requestSync());
  window.addEventListener('online', () => engine?.requestSync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') engine?.requestSync();
  });
  api.onSyncWake(() => engine?.requestSync());
  api.onSyncFlush(async (info) => {
    try {
      if (engine?.enabled) await engine.flush();
    } finally {
      if (info.quitting) api!.syncFlushed();
    }
  });
}
