// 原生能力的薄封装：触感反馈、键盘高度。浏览器里调试时安静地退化。
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Keyboard } from '@capacitor/keyboard';

export const isNative = Capacitor.isNativePlatform();

let hapticsOn = true;
export function setHapticsEnabled(on: boolean) {
  hapticsOn = on;
}

const safe = (p: Promise<unknown>) => void p.catch(() => {});

export const haptic = {
  /** 轻触：切换、添加 */
  light() {
    if (isNative && hapticsOn) safe(Haptics.impact({ style: ImpactStyle.Light }));
  },
  /** 中等：长按菜单、滑动越过阈值、删除 */
  medium() {
    if (isNative && hapticsOn) safe(Haptics.impact({ style: ImpactStyle.Medium }));
  },
  /** 完成 */
  success() {
    if (isNative && hapticsOn) safe(Haptics.notification({ type: NotificationType.Success }));
  },
  warning() {
    if (isNative && hapticsOn) safe(Haptics.notification({ type: NotificationType.Warning }));
  },
  selection() {
    if (isNative && hapticsOn) safe(Haptics.selectionChanged());
  },
};

/** 把软键盘高度写到 CSS 变量 --kb，底部的输入卡片跟着上移 */
export function trackKeyboard() {
  const root = document.documentElement;
  const setKb = (h: number) => root.style.setProperty('--kb', `${Math.max(0, Math.round(h))}px`);
  if (isNative) {
    safe(Keyboard.setAccessoryBarVisible({ isVisible: false }));
    safe(Keyboard.addListener('keyboardWillShow', (info) => setKb(info.keyboardHeight)));
    safe(Keyboard.addListener('keyboardWillHide', () => setKb(0)));
    return;
  }
  // 浏览器调试：用 visualViewport 估算
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => setKb(window.innerHeight - vv.height - vv.offsetTop);
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
}
