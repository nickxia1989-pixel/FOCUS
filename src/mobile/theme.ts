// 外观：跟随系统 / 浅色 / 深色（本机偏好，不同步）。
// 网页按 <html data-theme> 切配色（index.html 里先按系统设一次，免得首屏闪）；
// 原生把 window 的 overrideUserInterfaceStyle 设成同一个值，页签栏、导航栏按钮、状态栏跟着变，
// WebView 的 prefers-color-scheme 也随之改变，所以「跟随系统」时直接看媒体查询。
import { useSyncExternalStore } from 'react';
import type { Appearance } from './data';
import { setNativeAppearance } from './focusNative';

const mq = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();
let pref: Appearance = 'system';
/** 原生那边按什么设的；第一次总要对一遍（原生启动时读的是它自己存的那份） */
let sent: Appearance | null = null;

function apply() {
  const next = pref === 'dark' || (pref === 'system' && mq.matches) ? 'dark' : 'light';
  const root = document.documentElement;
  if (root.dataset.theme === next) return;
  root.dataset.theme = next;
  for (const fn of listeners) fn();
}
mq.addEventListener('change', apply);

export function setAppearance(a: Appearance) {
  pref = a;
  if (sent !== a) {
    sent = a;
    void setNativeAppearance(a);
  }
  apply();
}

export const isDark = () => document.documentElement.dataset.theme === 'dark';

export function onThemeChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useDark() {
  return useSyncExternalStore(onThemeChange, isDark);
}
