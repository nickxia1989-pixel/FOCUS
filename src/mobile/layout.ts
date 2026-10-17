// 双页布局：内容区够宽（iPhone Duo 展开横握的内屏、手机横屏、iPad）时，以折痕为界分成左右两页。
// 只看可用宽度，不认机型；折痕的位置来自原生外壳（系统报告的 reserved region），没有折痕时以窗口中线为界。
// 两页之间一直留 40pt 的空档：展平和半折时排版一样，开合之间内容不重排。
import { useLayoutEffect, useState, type RefObject } from 'react';
import { nativeChrome, useChrome } from './chrome';

/** 内容区达到这个宽度就分成两页 */
export const SPREAD_MIN = 700;
/** 两页之间的空档（Duo 半折时折痕区约 40pt） */
export const GUTTER = 40;
/** 一页至少要有的宽度，不够就不分 */
const PAGE_MIN = 300;

/** 安全区加原生栏占掉的边距（env() 只能在 CSS 里取，借一个探针元素） */
export function contentInsets() {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;' +
    'padding:calc(env(safe-area-inset-top) + var(--chrome-top, 0px)) calc(env(safe-area-inset-right) + var(--chrome-right, 0px)) ' +
    'calc(env(safe-area-inset-bottom) + var(--chrome-bottom, 0px)) calc(env(safe-area-inset-left) + var(--chrome-left, 0px))';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const r = {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
  probe.remove();
  return r;
}

export interface Spread {
  /** 左页右边界、右页左边界（视口坐标） */
  leftEnd: number;
  rightStart: number;
}

/** 算两页怎么分；不够宽返回 null */
export function computeSpread(main: DOMRect, insets: { left: number; right: number }, fold: { x: number; y: number; width: number; height: number } | null): Spread | null {
  const L = main.left + insets.left;
  const R = main.right - insets.right;
  if (R - L < SPREAD_MIN) return null;
  // 竖着的折痕落在内容区里才用它；否则以窗口中线（原生外壳）或内容栏中线（网页自带侧栏时）为界
  const vertical = fold && fold.height > fold.width && fold.x > L && fold.x + fold.width < R ? fold : null;
  const mid = vertical ? vertical.x + vertical.width / 2 : nativeChrome ? window.innerWidth / 2 : (main.left + main.right) / 2;
  const half = Math.max(GUTTER, vertical?.width ?? 0) / 2;
  const s = { leftEnd: mid - half, rightStart: mid + half };
  if (s.leftEnd - L < PAGE_MIN || R - s.rightStart < PAGE_MIN) return null;
  return s;
}

/**
 * 当前是不是双页；是的话把分界写进 app 根节点的 CSS 变量（--page-l-end、--page-r-start、--main-left，视口坐标），
 * 页面、新建卡片、提示条、面板都按它摆，不压在折痕上。
 */
export function useSpread(
  appRef: RefObject<HTMLElement | null>,
  mainRef: RefObject<HTMLElement | null>,
  ready: boolean,
): boolean {
  const fold = useChrome((s) => s.geo.fold);
  const [on, setOn] = useState(false);
  useLayoutEffect(() => {
    const app = appRef.current;
    const main = mainRef.current;
    if (!app || !main) return;
    const update = () => {
      const r = main.getBoundingClientRect();
      const s = computeSpread(r, contentInsets(), fold);
      if (s) {
        app.style.setProperty('--page-l-end', `${s.leftEnd}px`);
        app.style.setProperty('--page-r-start', `${s.rightStart}px`);
        app.style.setProperty('--main-left', `${r.left}px`);
      }
      setOn(!!s);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(main);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [appRef, mainRef, fold, ready]);
  return on;
}
