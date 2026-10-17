// 主屏小组件的接线（引入即生效，见 main.tsx）：
// - 数据一变（本地改动、同步合并、切换空间）就把快照（widgetData.ts）交给原生插件 FocusWidget，
//   由它写进 App Group 并刷新小组件。连续改动时节流，内容没变不写。
// - 点小组件打开的 focustodo://focus 链接：回到 FOCUS 页（选了空间的小组件还会切到那个空间）；
//   FOCUS 空了时小组件列的是 INBOX，链接是 focustodo://inbox，落在 INBOX 页。
import { App } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';
import { isNative } from './native';
import { useData } from './store';
import { useUi } from './ui';
import { widgetSnapshot } from './widgetData';

interface FocusWidgetPlugin {
  /** 写入快照并刷新小组件（ios/App/App/FocusWidgetPlugin.swift） */
  update(o: { json: string }): Promise<void>;
}

const Native = registerPlugin<FocusWidgetPlugin>('FocusWidget');

/** 连续改动时最多这么久写一次，也就是刷新小组件的最小间隔 */
const THROTTLE_MS = 800;

let written = '';
let timer: ReturnType<typeof setTimeout> | null = null;

export function flushWidget() {
  if (timer) clearTimeout(timer);
  timer = null;
  const s = useData.getState();
  if (!s.loaded || !isNative) return;
  const json = JSON.stringify(widgetSnapshot(s.profiles, s.activeId, Date.now()));
  if (json === written) return;
  written = json;
  Native.update({ json }).catch(() => {
    // 没写成：下次有改动时再试
    if (written === json) written = '';
  });
}

useData.subscribe((s, prev) => {
  if (!s.loaded) return;
  if (!prev.loaded) flushWidget();
  else if (s.profiles !== prev.profiles || s.activeId !== prev.activeId) timer ??= setTimeout(flushWidget, THROTTLE_MS);
});

// 改完马上回主屏时，等不到节流的那一下
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && timer) flushWidget();
});

// ---------- 点小组件打开 ----------

/** 小组件能打开的分区 */
const WIDGET_SECTIONS = ['focus', 'inbox'] as const;

/** focustodo://focus 或 focustodo://inbox，选了空间的小组件带 ?profile=<id> */
export function openWidgetUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const target = (u.hostname || u.pathname.replace(/^\/+/, '')) as (typeof WIDGET_SECTIONS)[number];
  if (u.protocol !== 'focustodo:' || !WIDGET_SECTIONS.includes(target)) return false;
  const s = useData.getState();
  const profile = u.searchParams.get('profile');
  if (profile && s.profiles.some((p) => p.id === profile)) s.switchProfile(profile);
  s.setSection(target);
  useUi.getState().set({ sheet: null, menu: null, more: null, swipedId: null });
  return true;
}

/** 冷启动时链接可能比数据先到：等数据载入后再处理，免得被恢复的分区盖掉 */
function whenLoaded(fn: () => void) {
  if (useData.getState().loaded) return fn();
  const off = useData.subscribe((s) => {
    if (!s.loaded) return;
    off();
    setTimeout(fn, 0);
  });
}

if (isNative) {
  void App.addListener('appUrlOpen', ({ url }) => whenLoaded(() => openWidgetUrl(url)));
  void App.getLaunchUrl()
    .then((r) => r?.url && whenLoaded(() => openWidgetUrl(r.url)))
    .catch(() => {});
}
