import type { HttpRequest, HttpResult } from './sync/webdav';

export interface SyncConfigView {
  baseUrl: string;
  user: string;
  folder: string;
  deviceName: string;
  hasPassword: boolean;
  encryptionAvailable: boolean;
}

export interface SyncConfigInput {
  baseUrl?: string;
  user?: string;
  folder?: string;
  deviceName?: string;
  /** 不传 = 保持原样；空字符串 = 清除 */
  password?: string;
}

interface FocusApi {
  platform: string;
  loadLegacyProfiles(): Promise<unknown>;
  loadLegacyData(profileId: string): Promise<unknown>;
  loadStore(name: 'doc' | 'local'): Promise<unknown>;
  saveStore(name: 'doc' | 'local', data: unknown): Promise<boolean>;
  saveStoreSync(name: 'doc' | 'local', data: unknown): boolean;
  backupStore(data: unknown): Promise<string>;
  getSyncConfig(): Promise<SyncConfigView>;
  setSyncConfig(input: SyncConfigInput): Promise<{ ok: boolean; message?: string }>;
  syncRequest(req: HttpRequest & { deviceId?: string }): Promise<HttpResult>;
  setSimOffline(flag: boolean): Promise<boolean>;
  appPlatform(): Promise<{ platform: string; deviceName: string }>;
  syncIdentity(): Promise<{ deviceId: string; nonce: string } | null>;
  resetSyncIdentity(): Promise<{ deviceId: string; nonce: string } | null>;
  onSyncFlush(cb: (info: { quitting?: boolean }) => void): () => void;
  onSyncWake(cb: () => void): () => void;
  syncFlushed(): void;
  minimize(): Promise<void>;
  close(): Promise<void>;
  getAlwaysOnTop(): Promise<boolean>;
  setAlwaysOnTop(flag: boolean): Promise<boolean>;
  onAlwaysOnTop(cb: (flag: boolean) => void): () => void;
  /** AI agent 本地接口：渲染进程挂好处理函数后报到 */
  agentReady(): void;
  onAgentRequest(cb: (req: { id: number; method: string; params: unknown }) => void): () => void;
  agentRespond(msg: { id: number; ok: boolean; value?: unknown; error?: string }): void;
  /** 离线模式下 agent 写的 outbox（设备文件格式的文本），没有就是 null */
  readAgentOutbox(): Promise<string | null>;
  onAgentOutbox(cb: () => void): () => void;
  openDataDir(): Promise<string>;
  version(): Promise<string>;
}

declare global {
  interface Window {
    focusApi?: FocusApi;
  }
}

/** 在 Electron 外（浏览器调试）时为 undefined，存储退回 localStorage，同步不可用 */
export const api: FocusApi | undefined = window.focusApi;
export const isElectron = !!api;
export const platform = api?.platform ?? 'web';
export const isMac = platform === 'darwin' || (!api && /Mac/.test(navigator.platform));

// ---------- 浏览器调试时的 localStorage 退路 ----------

function lsRead(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function lsWrite(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const lsLegacyKey = (profileId: string) => (profileId === 'default' ? 'focus-data' : `focus-data:${profileId}`);

// ---------- v1 数据（只读，供迁移） ----------

export async function loadLegacyProfiles(): Promise<unknown> {
  return api ? api.loadLegacyProfiles() : lsRead('focus-profiles');
}

export async function loadLegacyData(profileId: string): Promise<unknown> {
  return api ? api.loadLegacyData(profileId) : lsRead(lsLegacyKey(profileId));
}

// ---------- v2 数据 ----------

export async function loadStore(name: 'doc' | 'local'): Promise<unknown> {
  return api ? api.loadStore(name) : lsRead(`focus-v2-${name}`);
}

export async function saveStore(name: 'doc' | 'local', data: unknown): Promise<void> {
  if (api) await api.saveStore(name, data);
  else lsWrite(`focus-v2-${name}`, data);
}

export function saveStoreSync(name: 'doc' | 'local', data: unknown): void {
  if (api) api.saveStoreSync(name, data);
  else lsWrite(`focus-v2-${name}`, data);
}

export async function backupStore(data: unknown): Promise<void> {
  if (api) await api.backupStore(data);
  else lsWrite(`focus-v2-backup-${Date.now()}`, data);
}
