// 存储适配层：界面和状态只通过这里读写整份快照，以后接同步时换掉实现即可。
// 现在用 Capacitor Preferences：iOS 上落在 UserDefaults，浏览器里调试时退回 localStorage。
import { Preferences } from '@capacitor/preferences';
import type { MobileSnapshot } from './data';

export interface SnapshotStorage {
  load(): Promise<unknown>;
  save(snapshot: MobileSnapshot): Promise<void>;
}

const KEY = 'focus-mobile-v1';

export const preferencesStorage: SnapshotStorage = {
  async load() {
    try {
      const { value } = await Preferences.get({ key: KEY });
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  },
  async save(snapshot) {
    try {
      await Preferences.set({ key: KEY, value: JSON.stringify(snapshot) });
    } catch {}
  },
};

/** 当前使用的存储实现 */
export const storage: SnapshotStorage = preferencesStorage;
