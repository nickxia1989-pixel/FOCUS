// 存储适配层。可同步的文档存成 App 私有目录里的文件（可能有几百 KB，不适合放 UserDefaults），
// 只属于本机的小状态放 Capacitor Preferences。浏览器里调试时都退回 localStorage。
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { isNative } from './native';

const DOC_FILE = 'focus-doc.json';
const LOCAL_KEY = 'focus-local-v2';
/** 同步改造前的整份快照，只在第一次迁移时读 */
const LEGACY_KEY = 'focus-mobile-v1';

async function prefGet(key: string): Promise<unknown> {
  try {
    const { value } = await Preferences.get({ key });
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

async function prefSet(key: string, value: unknown) {
  try {
    await Preferences.set({ key, value: JSON.stringify(value) });
  } catch {}
}

export const loadLegacy = () => prefGet(LEGACY_KEY);
export const loadLocal = () => prefGet(LOCAL_KEY);
export const saveLocal = (v: unknown) => prefSet(LOCAL_KEY, v);
export const loadSyncConfig = () => prefGet('focus-sync-config');
export const saveSyncConfig = (v: unknown) => prefSet('focus-sync-config', v);

export async function loadDoc(): Promise<unknown> {
  if (!isNative) return prefGet(DOC_FILE);
  try {
    const r = await Filesystem.readFile({ path: DOC_FILE, directory: Directory.Library, encoding: Encoding.UTF8 });
    return JSON.parse(String(r.data));
  } catch {
    // 主文件坏了或不存在：试试上次写的临时文件
    try {
      const r = await Filesystem.readFile({ path: `${DOC_FILE}.tmp`, directory: Directory.Library, encoding: Encoding.UTF8 });
      return JSON.parse(String(r.data));
    } catch {
      return null;
    }
  }
}

/** 先写临时文件再改名，写到一半被杀掉也不会把数据文件写坏 */
export async function saveDoc(doc: unknown): Promise<void> {
  if (!isNative) return prefSet(DOC_FILE, doc);
  const data = JSON.stringify(doc);
  try {
    await Filesystem.writeFile({ path: `${DOC_FILE}.tmp`, directory: Directory.Library, data, encoding: Encoding.UTF8 });
    await Filesystem.rename({ from: `${DOC_FILE}.tmp`, to: DOC_FILE, directory: Directory.Library, toDirectory: Directory.Library });
  } catch {
    try {
      await Filesystem.writeFile({ path: DOC_FILE, directory: Directory.Library, data, encoding: Encoding.UTF8 });
    } catch {}
  }
}

/** 加入云端时选了「以云端为准」：本机文档先另存一份 */
export async function backupDoc(doc: unknown): Promise<void> {
  const path = `focus-doc.backup-${Date.now()}.json`;
  if (!isNative) return prefSet(path, doc);
  try {
    await Filesystem.writeFile({ path, directory: Directory.Library, data: JSON.stringify(doc), encoding: Encoding.UTF8 });
  } catch {}
}
