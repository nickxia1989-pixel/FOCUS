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
  /** 选择变化（切页签、拖动经过新位置）。iOS 的选择反馈要先 start 才会响，拖动期间用 selectionBegin / End 包住 */
  selection() {
    if (!isNative || !hapticsOn) return;
    if (!selecting) safe(Haptics.selectionStart());
    safe(Haptics.selectionChanged());
    if (!selecting) safe(Haptics.selectionEnd());
  },
  selectionBegin() {
    selecting = true;
    if (isNative && hapticsOn) safe(Haptics.selectionStart());
  },
  selectionEnd() {
    selecting = false;
    if (isNative) safe(Haptics.selectionEnd());
  },
};

let selecting = false;

/** 软键盘起落：shown 时带高度（接硬件键盘时只有一条很矮的快捷栏，高度很小） */
type KeyboardListener = (shown: boolean, height: number) => void;
const keyboardListeners = new Set<KeyboardListener>();

export function onKeyboard(fn: KeyboardListener) {
  keyboardListeners.add(fn);
  return () => {
    keyboardListeners.delete(fn);
  };
}

/** 把软键盘高度写到 CSS 变量 --kb，底部的输入卡片跟着上移；起落时通知 onKeyboard 的监听 */
export function trackKeyboard() {
  const root = document.documentElement;
  const setKb = (h: number) => {
    root.style.setProperty('--kb', `${Math.max(0, Math.round(h))}px`);
    for (const fn of keyboardListeners) fn(h > 0, h);
  };
  if (isNative) {
    safe(Keyboard.setAccessoryBarVisible({ isVisible: false }));
    safe(Keyboard.addListener('keyboardWillShow', (info) => setKb(info.keyboardHeight)));
    safe(Keyboard.addListener('keyboardWillHide', () => setKb(0)));
    return;
  }
  // 浏览器调试：用 visualViewport 估算
  const vv = window.visualViewport;
  if (!vv) return;
  let last = 0;
  const update = () => {
    const h = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    if (Math.abs(h - last) < 1) return;
    last = h;
    setKb(h);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
}
