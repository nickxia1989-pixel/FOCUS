// 拖动排序：长按浮起（照旧弹出上下文菜单），浮起后手指再移动超过约 8pt 就收起菜单进入拖动。
// - 只在同一组兄弟里排：「接下来」的顶层项、各列表的行、同一个父项下的子项（DOM 上用 data-drag-group 标出同组）
// - 被拖的那一项留下等高的空位，手指下面是它的浮起副本；同组其它项让位（上下平移）
// - 拖到滚动页的上下边缘时自动滚动；经过新位置时 selection 触感
// - FOCUS 页里从「接下来」拖到 NOW 卡上 = 设为现在（Duo 双页时就是从右页拖到左页）
// - 松手时 store.reorder(id, toIndex)；减弱动态效果时不做归位动画
import { flushSync } from 'react-dom';
import { siblingsOf } from '../model';
import type { Todo } from '../types';
import { setNow } from './actions';
import { reduceMotion } from './fx';
import { haptic } from './native';
import { activeOf, useData } from './store';
import { scrollParent, useUi } from './ui';

/** 浮起后手指移动超过这个距离才算开始拖（再小就是想点菜单） */
export const DRAG_SLOP = 8;
/** 离滚动页上下边缘多近时开始自动滚动，以及每帧最多滚多少 */
const EDGE = 56;
const MAX_SPEED = 14;

export interface DragSession {
  move(x: number, y: number): void;
  end(): void;
  cancel(): void;
}

/** 同一组兄弟：列表 + 父项（顶层用 root）；NOW 卡上的子任务另起一组，免得和列表里同一个父项的子项混在一起 */
export const dragGroup = (todo: Todo, where: 'list' | 'now' = 'list') =>
  `${where === 'now' ? 'now:' : ''}${todo.list}:${todo.parentId ?? 'root'}`;

interface Sib {
  id: string;
  el: HTMLElement;
  body: HTMLElement;
  /** 开始拖时的位置（视口坐标），之后按滚动量修正 */
  top: number;
  bottom: number;
  mid: number;
}

/**
 * 开始拖动。node：带 data-drag-group 的那一项（连同子项一起挪）；row：手指按住的那一行（做浮起的副本）；
 * x、y：手指按下的那一点（之后的位置由 move 给）。不能拖（已完成、找不到同组）时返回 null。
 */
export function beginDrag(todo: Todo, node: HTMLElement, row: HTMLElement, x: number, y: number): DragSession | null {
  const key = node.dataset.dragGroup;
  if (!key || todo.done) return null;
  const all = [...document.querySelectorAll<HTMLElement>(`[data-drag-group="${CSS.escape(key)}"]`)];
  const from = all.indexOf(node);
  if (from < 0) return null;
  const scroller = scrollParent(node);
  const scroll0 = scroller?.scrollTop ?? 0;
  const bodyOf = (el: HTMLElement) => el.querySelector<HTMLElement>(':scope > [data-drag-body]') ?? el;
  const sibs: Sib[] = all
    .filter((el) => el !== node)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.nodeId!, el, body: bodyOf(el), top: r.top, bottom: r.bottom, mid: r.top + Math.min(r.height, 64) / 2 };
    });
  // 让位的距离 = 这一项的高度 + 和邻居之间的空隙
  const nr = node.getBoundingClientRect();
  const next = all[from + 1]?.getBoundingClientRect();
  const prev = all[from - 1]?.getBoundingClientRect();
  const gap = next ? next.top - nr.bottom : prev ? nr.top - prev.bottom : 0;
  const shift = nr.height + Math.max(0, gap);

  // 浮起的副本
  const rr = row.getBoundingClientRect();
  const ghost = document.createElement('div');
  const kind = row.classList.contains('now-sub') ? 'is-sub' : row.classList.contains('q-row') ? 'is-q' : 'is-row';
  ghost.className = `drag-ghost ${kind}`;
  const clone = row.cloneNode(true) as HTMLElement;
  clone.classList.remove('lifted', 'shake');
  clone.removeAttribute('data-anchor');
  ghost.appendChild(clone);
  ghost.style.cssText = `top:${rr.top}px;left:${rr.left}px;width:${rr.width}px;`;
  // 颜色跟着原来的上下文（列表色、NOW 卡）
  const cs = getComputedStyle(row);
  ghost.style.setProperty('--c', cs.getPropertyValue('--c'));
  document.body.appendChild(ghost);
  const grabX = x - rr.left;
  const grabY = y - rr.top;

  node.classList.add('drag-source');
  document.documentElement.classList.add('is-dragging');
  useUi.getState().set({ menu: null, swipedId: null, draggingId: todo.id });
  haptic.selectionBegin();

  const now = key === 'focus:root' ? document.querySelector<HTMLElement>('[data-drop-now]') : null;
  const reduce = reduceMotion();
  for (const s of sibs) s.body.style.transition = reduce ? 'none' : 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)';

  let px = x;
  let py = y;
  let to = from;
  let overNow = false;
  let raf = 0;
  let done = false;

  const layout = () => {
    const dy = (scroller?.scrollTop ?? 0) - scroll0;
    const center = py - grabY + rr.height / 2;
    let t = 0;
    for (const s of sibs) if (s.mid - dy < center) t++;
    const nowHit = !!now && hits(now, px, py);
    if (nowHit !== overNow) {
      overNow = nowHit;
      now!.classList.toggle('drop-target', nowHit);
      haptic.selection();
    }
    if (t !== to) {
      to = t;
      haptic.selection();
      sibs.forEach((s, j) => {
        // j 是去掉被拖那一项之后的序号；原位在 from
        const dir = from < to && j >= from && j < to ? -1 : to < from && j >= to && j < from ? 1 : 0;
        s.body.style.transform = dir ? `translateY(${dir * shift}px)` : '';
      });
    }
  };

  // 拖到滚动页上下边缘时自动滚
  const tick = () => {
    raf = 0;
    if (done || !scroller) return;
    const box = scroller.getBoundingClientRect();
    const [insetTop, insetBottom] = insets();
    const top = Math.max(box.top, insetTop);
    const bottom = Math.min(box.bottom, window.innerHeight - insetBottom);
    let v = 0;
    if (py < top + EDGE) v = -MAX_SPEED * Math.min(1, (top + EDGE - py) / EDGE);
    else if (py > bottom - EDGE) v = MAX_SPEED * Math.min(1, (py - bottom + EDGE) / EDGE);
    if (v) {
      const before = scroller.scrollTop;
      scroller.scrollTop += v;
      if (scroller.scrollTop !== before) layout();
      raf = requestAnimationFrame(tick);
    }
  };

  const place = () => {
    ghost.style.transform = `translate(${px - grabX - rr.left}px, ${py - grabY - rr.top}px) scale(1.03)`;
  };

  const cleanup = () => {
    done = true;
    cancelAnimationFrame(raf);
    haptic.selectionEnd();
    now?.classList.remove('drop-target');
    for (const s of sibs) {
      s.body.style.transition = 'none';
      s.body.style.transform = '';
    }
    node.classList.remove('drag-source');
    document.documentElement.classList.remove('is-dragging');
    ghost.remove();
    // 让位的过渡在下一帧再恢复，免得复位时又动一下
    requestAnimationFrame(() => {
      for (const s of sibs) s.body.style.transition = '';
    });
  };

  const commit = () => {
    if (overNow) {
      cleanup();
      setNow(todo);
    } else if (to !== from) {
      const index = modelIndex(todo, sibs, to);
      // 让位后的样子就是新顺序：复位和写入放在同一帧，不闪
      flushSync(() => {
        cleanup();
        if (index !== null) useData.getState().reorder(todo.id, index);
      });
      haptic.light();
    } else cleanup();
    requestAnimationFrame(() => useUi.getState().set({ draggingId: null }));
  };

  place();
  ghost.getBoundingClientRect();
  ghost.classList.add('is-up');

  return {
    move(nx, ny) {
      px = nx;
      py = ny;
      place();
      layout();
      if (!raf) raf = requestAnimationFrame(tick);
    },
    end() {
      if (done) return;
      if (reduce || overNow) return commit();
      // 归位：副本落到空位上再写入。往下挪时落在越过的最后一项（已上移）后面，往上挪时落在越过的第一项原来的位置
      const dy = (scroller?.scrollTop ?? 0) - scroll0;
      const slot =
        to > from ? sibs[to - 1].bottom - shift + Math.max(0, gap) - dy : to < from ? sibs[to].top - dy : nr.top - dy;
      ghost.classList.add('is-landing');
      ghost.style.transform = `translate(0px, ${slot + (rr.top - nr.top) - rr.top}px)`;
      setTimeout(commit, 160);
      done = true;
      cancelAnimationFrame(raf);
    },
    cancel() {
      if (done) return;
      cleanup();
      useUi.getState().set({ draggingId: null });
    },
  };
}

function hits(el: Element, x: number, y: number) {
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** 落点换算成 store.reorder 的序号：同组（未完成）里排在 sibs[to - 1] 后面 */
function modelIndex(todo: Todo, sibs: Sib[], to: number): number | null {
  const group = siblingsOf(activeOf(useData.getState()).todos, todo).filter((t) => t.done === todo.done && t.id !== todo.id);
  if (to === 0) {
    const i = group.findIndex((t) => t.id === sibs[0]?.id);
    return i >= 0 ? i : null;
  }
  const i = group.findIndex((t) => t.id === sibs[to - 1]?.id);
  return i >= 0 ? i + 1 : null;
}

/** 安全区 + 栏占掉的上下边距（--inset-* 是 calc()，借探针元素取算好的值） */
function insets(): [number, number] {
  const app = document.querySelector('.app');
  if (!app) return [0, 0];
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-top:var(--inset-top);padding-bottom:var(--inset-bottom)';
  app.appendChild(probe);
  const ps = getComputedStyle(probe);
  const r: [number, number] = [parseFloat(ps.paddingTop) || 0, parseFloat(ps.paddingBottom) || 0];
  probe.remove();
  return r;
}
