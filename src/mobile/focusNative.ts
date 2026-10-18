// App 自带的原生插件（ios/App/App/SceneDelegate.swift 里的 FocusNativePlugin）：钥匙串、后台时间、外观。
// 浏览器里调试时退回 localStorage——只用于对着本机测试服务器调界面，别在浏览器里填真实密码。
import { registerPlugin } from '@capacitor/core';
import { isNative } from './native';

interface FocusNativePlugin {
  keychainGet(o: { key: string }): Promise<{ value: string | null }>;
  keychainSet(o: { key: string; value: string }): Promise<void>;
  keychainDelete(o: { key: string }): Promise<void>;
  beginBackgroundTask(): Promise<{ id: number }>;
  endBackgroundTask(o: { id: number }): Promise<void>;
  setAppearance(o: { style: 'system' | 'light' | 'dark' }): Promise<void>;
}

const Native = registerPlugin<FocusNativePlugin>('FocusNative');
const DEV_PREFIX = 'focus-dev-keychain:';

export async function keychainGet(key: string): Promise<string | null> {
  try {
    if (isNative) return (await Native.keychainGet({ key })).value;
    return localStorage.getItem(DEV_PREFIX + key);
  } catch {
    return null;
  }
}

export async function keychainSet(key: string, value: string): Promise<boolean> {
  try {
    if (isNative) await Native.keychainSet({ key, value });
    else localStorage.setItem(DEV_PREFIX + key, value);
    return true;
  } catch {
    return false;
  }
}

export async function keychainDelete(key: string): Promise<void> {
  try {
    if (isNative) await Native.keychainDelete({ key });
    else localStorage.removeItem(DEV_PREFIX + key);
  } catch {}
}

/** 切到后台时申请一段时间做完 fn（iOS 最多约 30 秒） */
export async function withBackgroundTime(fn: () => Promise<void>): Promise<void> {
  let id: number | null = null;
  try {
    if (isNative) id = (await Native.beginBackgroundTask()).id;
  } catch {}
  try {
    await fn();
  } finally {
    if (id !== null) await Native.endBackgroundTask({ id }).catch(() => {});
  }
}

/** 外观（跟随系统 / 浅色 / 深色）交给原生：设在 window 上，原生栏、状态栏和 WebView 的 prefers-color-scheme 一起变 */
export async function setNativeAppearance(style: 'system' | 'light' | 'dark'): Promise<void> {
  try {
    if (isNative) await Native.setAppearance({ style });
  } catch {}
}
