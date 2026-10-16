import type { AppData } from './types';

interface FocusApi {
  platform: string;
  load(): Promise<{ data: unknown; path: string }>;
  save(data: AppData): Promise<boolean>;
  saveSync(data: AppData): boolean;
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

const LS_KEY = 'focus-data';

export async function loadData(): Promise<unknown> {
  if (api) return (await api.load()).data;
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveData(data: AppData): Promise<void> {
  if (api) {
    await api.save(data);
    return;
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {}
}

export function saveDataSync(data: AppData): void {
  if (api) {
    api.saveSync(data);
    return;
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {}
}
