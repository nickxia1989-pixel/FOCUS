// 临时界面状态：正在编辑的标题草稿、新建卡片里没发出去的字、列表滚到哪一行。
// 折叠 / 展开时如果系统重建了 WebView，重新打开后两分钟内还能接着来；正常情况下页面不会重载，用不到这里。
import type { ListId } from '../types';
import type { Section } from './data';

export interface Transient {
  at: number;
  editing?: { id: string; text: string };
  composer?: { list: ListId; parentId: string | null; text: string };
  anchor?: { section: Section; key: string; offset: number };
}

const KEY = 'focus-transient';
const FRESH_MS = 2 * 60 * 1000;

let state: Transient = { at: 0 };
let timer: ReturnType<typeof setTimeout> | null = null;

function write() {
  timer = null;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...state, at: Date.now() }));
  } catch {}
}

/** 合并一部分临时状态，稍后写入；传 undefined 表示清掉那一项 */
export function saveTransient(patch: Partial<Omit<Transient, 'at'>>) {
  state = { ...state, ...patch };
  if (!timer) timer = setTimeout(write, 200);
}

export function flushTransient() {
  if (!timer) return;
  clearTimeout(timer);
  write();
}

/** 启动时取一次：只认两分钟内的，取完就清掉 */
export function takeTransient(): Transient | null {
  try {
    const raw = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as Transient;
    return typeof t.at === 'number' && Date.now() - t.at < FRESH_MS ? t : null;
  } catch {
    return null;
  }
}

/** 恢复出来、等对应组件挂载时取用的草稿 */
export const restored: Omit<Transient, 'at'> = {};

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushTransient();
});
window.addEventListener('pagehide', flushTransient);
