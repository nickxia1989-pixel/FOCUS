import { DEFAULT_PROFILE_ID, type AppData, type ProfilesData } from './types';

interface FocusApi {
  platform: string;
  loadProfiles(): Promise<unknown>;
  saveProfiles(data: ProfilesData): Promise<boolean>;
  archiveProfile(profileId: string): Promise<boolean>;
  load(profileId: string): Promise<{ data: unknown; path: string }>;
  save(profileId: string, data: AppData): Promise<boolean>;
  saveSync(profileId: string, data: AppData): boolean;
  minimize(): Promise<void>;
  close(): Promise<void>;
  getAlwaysOnTop(): Promise<boolean>;
  setAlwaysOnTop(flag: boolean): Promise<boolean>;
  onAlwaysOnTop(cb: (flag: boolean) => void): () => void;
  openDataDir(): Promise<string>;
  version(): Promise<string>;
}

declare global {
  interface Window {
    focusApi?: FocusApi;
  }
}

/** 在 Electron 外（浏览器调试）时为 undefined，存储退回 localStorage */
export const api: FocusApi | undefined = window.focusApi;
export const isElectron = !!api;
export const platform = api?.platform ?? 'web';
export const isMac = platform === 'darwin' || (!api && /Mac/.test(navigator.platform));

// ---------- 浏览器调试时的 localStorage 退路 ----------

const LS_PROFILES = 'focus-profiles';
const lsDataKey = (profileId: string) => (profileId === DEFAULT_PROFILE_ID ? 'focus-data' : `focus-data:${profileId}`);

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

// ---------- profile 列表 ----------

export async function loadProfiles(): Promise<unknown> {
  return api ? api.loadProfiles() : lsRead(LS_PROFILES);
}

export async function saveProfiles(data: ProfilesData): Promise<void> {
  if (api) await api.saveProfiles(data);
  else lsWrite(LS_PROFILES, data);
}

/** 删除 profile：数据挪走存档，不真删 */
export async function archiveProfile(profileId: string): Promise<void> {
  if (api) {
    await api.archiveProfile(profileId);
    return;
  }
  const data = lsRead(lsDataKey(profileId));
  if (data) lsWrite(`focus-data-deleted:${profileId}:${Date.now()}`, data);
  try {
    localStorage.removeItem(lsDataKey(profileId));
  } catch {}
}

// ---------- 单个 profile 的数据 ----------

export async function loadData(profileId: string): Promise<unknown> {
  return api ? (await api.load(profileId)).data : lsRead(lsDataKey(profileId));
}

export async function saveData(profileId: string, data: AppData): Promise<void> {
  if (api) await api.save(profileId, data);
  else lsWrite(lsDataKey(profileId), data);
}

export function saveDataSync(profileId: string, data: AppData): void {
  if (api) api.saveSync(profileId, data);
  else lsWrite(lsDataKey(profileId), data);
}
