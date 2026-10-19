// 自由拖拽（规则见 docs/drag.md，落点算法在 src/dragTree.ts）：一棵树里的任何一项都能拖到任何位置。
// - 长按浮起（照旧弹出上下文菜单），浮起后手指再移动超过约 8pt 就收起菜单进入拖动
// - 开始拖时把看得见的行（NOW 卡和它的子任务、「接下来」、各列表的树）按显示顺序摊平；
//   每一行在 DOM 上用 data-drag-row 等属性标出（dragRowProps），双页时左右两页各是这棵树的一段
// - 纵坐标选空隙，横坐标按每级约 24pt 换算深度（带约 1/4 级的迟滞），夹到空隙允许的范围里
// - 反馈：缩进到落点深度的插入线、新父项高亮（和连到插入线的竖线）、浮起副本带子孙数角标
// - 悬停 600ms 自动展开折叠的行；拖到上下边缘自动滚动；拖回原处、拖出列表区松手就取消（副本飞回去）
// - FOCUS 顶层的落点在聚焦区的框里（data-zone，含框的上方）就进聚焦区，框外就回「接下来」；从外面拖进来时
//   聚焦区整块描边、提示「松手 = 加入聚焦」（ui.dropZone）。双页时左页整页都算聚焦区那一边
// - 放下调 store.place；换了父项、层级或进出聚焦区时弹「已移到「X」下 · 撤销」，撤销就是放回开始时记下的位置
// - 触感：浮起 medium（长按时已给），换空隙 / 换深度 selection，放下 light，取消不给
import { flushSync } from 'react-dom';
import { projectDrop, restRows, type DragRow, type DropProjection } from '../dragTree';
import { descendantIds, inZone, siblingsOf, type PlaceTarget } from '../model';
import type { ListId, Todo } from '../types';
import { listLabel } from './actions';
import { reduceMotion } from './fx';
import { haptic } from './native';
import { activeOf, useData } from './store';
import { markAdded, scrollParent, showUndoToast, toggleExpanded, useUi } from './ui';

/** 浮起后手指移动超过这个距离才算开始拖（再小就是想点菜单） */
export const DRAG_SLOP = 8;
/** 横向每移动这么多算一级 */
const INDENT = 24;
/** 换深度要多越过的那一截（1/4 级），手指轻微抖动时不在两级之间来回跳 */
const HYSTERESIS = 0.25;
/** 离滚动区上下边缘多近时开始自动滚动，以及每帧最多滚多少 */
const EDGE = 56;
const MAX_SPEED = 14;
/** 在折叠着子项的行上停这么久就展开 */
const EXPAND_MS = 600;

export interface DragSession {
  move(x: number, y: number): void;
  end(): void;
  cancel(): void;
}

/**
 * 可拖的一行在 DOM 上的标记（摊平时读）：depth 是这一项在整棵树里的深度（顶层 0），
 * collapsed 是「有子项但现在没显示出来」。
 */
export function dragRowProps(todo: Todo, depth: number, collapsed: boolean) {
  return {
    'data-drag-row': todo.id,
    'data-depth': depth,
    'data-parent': todo.parentId ?? '',
    'data-list': todo.list,
    'data-done': todo.done ? '1' : '',
    'data-collapsed': collapsed ? '1' : '',
  };
}

interface Row extends DragRow {
  el: HTMLElement;
  pane: 'l' | 'r';
  /** 在聚焦区面板里（聚焦项和它的子任务） */
  zone: boolean;
}

/** 当前看得见的行，按显示顺序（双页时左页在前，正好是树的顺序） */
function flatten(): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('.app [data-drag-row]')) {
    const id = el.dataset.dragRow!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      el,
      depth: Number(el.dataset.depth) || 0,
      parentId: el.dataset.parent || null,
      list: el.dataset.list as ListId,
      done: el.dataset.done === '1',
      collapsed: el.dataset.collapsed === '1',
      pane: el.closest('.pane-r') ? 'r' : 'l',
      zone: !!el.closest('[data-zone]'),
    });
  }
  return out;
}

/** 双页时左右两页的分界（视口坐标）；单页时 null */
function pages() {
  const app = document.querySelector<HTMLElement>('.app.is-spread');
  if (!app) return null;
  const cs = getComputedStyle(app);
  const leftEnd = parseFloat(cs.getPropertyValue('--page-l-end'));
  const rightStart = parseFloat(cs.getPropertyValue('--page-r-start'));
  const mainLeft = parseFloat(cs.getPropertyValue('--main-left')) || 0;
  if (!leftEnd || !rightStart) return null;
  return { leftEnd, rightStart, mainLeft };
}

/** 安全区 + 栏占掉的上下边距（--inset-* 是 calc()，借探针元素取算好的值） */
function insets(): [number, number] {
  const app = document.querySelector('.app');
  if (!app) return [0, 0];
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;padding-top:var(--inset-top);padding-bottom:var(--inset-bottom)';
  app.appendChild(probe);
  const ps = getComputedStyle(probe);
  const r: [number, number] = [parseFloat(ps.paddingTop) || 0, parseFloat(ps.paddingBottom) || 0];
  probe.remove();
  return r;
}

/** 这一行的圆圈 / 序号（插入线、竖线从这里对齐） */
const markerOf = (el: HTMLElement) =>
  el.querySelector<HTMLElement>(':scope .check, :scope .q-no, :scope > .zring, :scope > .zcb') ?? el;

/** 子项相对这一行的圆圈往右缩进多少（画插入线用）：聚焦项的子任务和标题对齐 */
function childIndent(el: HTMLElement) {
  if (el.classList.contains('zhead')) return 36;
  if (el.classList.contains('q-row')) return 44;
  if (el.classList.contains('zsub')) return 24;
  return 30;
}

const hits = (r: DOMRect, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * 开始拖动。node：这一项的整块（连同子孙，拖动时留作空位）；row：手指按住的那一行（做浮起的副本）；
 * x、y：手指按下的那一点（之后的位置由 move 给）。编辑中的行、找不到这一行时返回 null。
 */
export function beginDrag(todo: Todo, node: HTMLElement, row: HTMLElement, x: number, y: number): DragSession | null {
  if (useUi.getState().editingId === todo.id) return null;
  const startRow = flatten().find((r) => r.id === todo.id);
  if (!startRow) return null;
  const todos0 = activeOf(useData.getState()).todos;
  /** 拖之前在不在聚焦区 */
  const wasZone = inZone(todo);
  // 撤销用：开始拖时在原父项下、同完成状态的兄弟里排第几（FOCUS 顶层按「聚焦区 + 接下来」连起来数），在不在聚焦区
  const origin: PlaceTarget = {
    list: todo.list,
    parentId: todo.parentId,
    index: siblingsOf(todos0, todo)
      .filter((t) => t.done === todo.done)
      .findIndex((t) => t.id === todo.id),
    focused: wasZone,
  };
  const kids = descendantIds(todos0, todo.id).size;

  // 浮起的副本（带子孙数角标）
  const rr = row.getBoundingClientRect();
  const ghost = document.createElement('div');
  const kind = row.classList.contains('zhead')
    ? 'is-zone'
    : row.classList.contains('zsub')
      ? 'is-zsub'
      : row.classList.contains('q-row')
        ? 'is-q'
        : 'is-row';
  ghost.className = `drag-ghost ${kind}`;
  const clone = row.cloneNode(true) as HTMLElement;
  clone.classList.remove('lifted', 'shake', 'drop-parent');
  for (const a of ['data-anchor', 'data-drag-row']) clone.removeAttribute(a);
  ghost.appendChild(clone);
  if (kids > 0) {
    const badge = document.createElement('span');
    badge.className = 'drag-count';
    badge.textContent = `+${kids}`;
    ghost.appendChild(badge);
  }
  ghost.style.cssText = `top:${rr.top}px;left:${rr.left}px;width:${rr.width}px;`;
  ghost.style.setProperty('--c', getComputedStyle(row).getPropertyValue('--c'));
  document.body.appendChild(ghost);

  // 插入线（左端带小圆点）和从新父项连到插入线的竖线
  const line = document.createElement('div');
  line.className = 'drop-line';
  const guide = document.createElement('div');
  guide.className = 'drop-guide';
  document.body.append(line, guide);

  const grabX = x - rr.left;
  const grabY = y - rr.top;
  const startPane = startRow.pane;
  const reduce = reduceMotion();

  node.classList.add('drag-source');
  document.documentElement.classList.add('is-dragging');
  useUi.getState().set({ menu: null, swipedId: null, draggingId: todo.id });
  haptic.selectionBegin();

  let px = x;
  let py = y;
  let want = startRow.depth;
  let proj: DropProjection | null = null;
  let gap = -1;
  let inside = true;
  let parentEl: HTMLElement | null = null;
  let hoverId: string | null = null;
  let expandTimer: ReturnType<typeof setTimeout> | undefined;
  let raf = 0;
  let done = false;
  /** 这次落点进不进聚焦区（只对 FOCUS 顶层的未完成项有意义；其它情况 undefined） */
  let focusDrop: boolean | undefined;

  const pg = pages();
  const paneOf = (cx: number): 'l' | 'r' => (pg && cx >= (pg.leftEnd + pg.rightStart) / 2 ? 'r' : 'l');
  const paneLeft = (p: 'l' | 'r') => (pg ? (p === 'l' ? pg.mainLeft : pg.rightStart) : 0);

  /** 指针所在的那一页里，纵坐标落在哪个空隙（每行以中线为界） */
  const pickGap = (rest: Row[], pane: 'l' | 'r') => {
    let last = -1;
    for (let i = 0; i < rest.length; i++) {
      const r = rest[i];
      if (pg && r.pane !== pane) continue;
      last = i;
      const b = r.el.getBoundingClientRect();
      if (py < b.top + Math.min(b.height, 64) / 2) return i;
    }
    if (last >= 0) return last + 1;
    return pane === 'l' ? 0 : rest.length;
  };

  /** 列表区：滚动页的可见部分（不含导航栏、页签栏）。拖出去松手就取消 */
  const inListArea = () => {
    const [top, bottom] = insets();
    return [...document.querySelectorAll<HTMLElement>(pg ? '.pane-l, .pane-r' : '.screen')].some((el) => {
      const b = el.getBoundingClientRect();
      return px >= b.left && px <= b.right && py >= Math.max(b.top, top) && py <= Math.min(b.bottom, window.innerHeight - bottom);
    });
  };

  /** 聚焦区的框（空着时是虚线框）：只在 FOCUS 页有 */
  const zoneBox = () => document.querySelector<HTMLElement>('.app [data-zone]');

  /**
   * FOCUS 顶层的落点进不进聚焦区：手指在聚焦区的框里（含框的上方）就进，在框下面就回「接下来」。
   * 双页时聚焦区那一页（左页）整页都算进，另一页是「接下来」。
   */
  const zoneDropOf = (p: DropProjection | null): boolean | undefined => {
    if (!p || todo.done || p.list !== 'focus' || p.parentId !== null) return undefined;
    const box = zoneBox();
    if (!box) return undefined;
    if (pg) return paneOf(px) === (box.closest('.pane-r') ? 'r' : 'l');
    return py <= box.getBoundingClientRect().bottom + 4;
  };
  /** 落点进 / 出了聚焦区（位置可能没变） */
  const zoneChanged = () => focusDrop !== undefined && focusDrop !== wasZone;
  const setDropZone = (on: boolean) => {
    if (useUi.getState().dropZone !== on) useUi.getState().set({ dropZone: on });
  };

  const setParent = (el: HTMLElement | null) => {
    if (el === parentEl) return;
    parentEl?.classList.remove('drop-parent');
    parentEl = el;
    parentEl?.classList.add('drop-parent');
  };

  const hideFeedback = () => {
    line.classList.remove('on');
    guide.classList.remove('on');
    setParent(null);
  };

  const layout = () => {
    if (done) return;
    const rows = flatten();
    if (!rows.some((r) => r.id === todo.id)) return;
    const rest = restRows(rows, todo.id) as Row[];
    const pane = paneOf(px);
    inside = inListArea();

    // 深度：按这一页里的横向位移算（跨页时各自从页的左边量），换级要多越过 1/4 级
    const dx = px - paneLeft(pane) - (x - paneLeft(startPane));
    const raw = startRow.depth + dx / INDENT;
    if (Math.abs(raw - want) >= 0.5 + HYSTERESIS) want = Math.round(raw);

    const g = pickGap(rest, pane);
    const next = projectDrop(rows, todo.id, g, want);
    if (!next) return;
    const nextZone = zoneDropOf(next);
    if (proj && (g !== gap || next.depth !== proj.depth || nextZone !== focusDrop)) haptic.selection();
    gap = g;
    proj = next;
    focusDrop = nextZone;
    // 从外面拖进聚焦区：整块描边，提示「松手 = 加入聚焦」
    setDropZone(inside && focusDrop === true && !wasZone);

    ghost.classList.toggle('is-out', !inside);
    if (!inside || (proj.unchanged && !zoneChanged())) hideFeedback();
    else drawLine(rest, g, proj, pane);
    hoverExpand(rest, pane);
  };

  /** 插入线：画在空隙上，左端缩进到落点深度；有新父项时父项高亮，竖线从父项连到插入线 */
  const drawLine = (rest: Row[], g: number, p: DropProjection, pane: 'l' | 'r') => {
    const prev = rest[g - 1];
    const next = rest[g];
    const prevB = prev && (!pg || prev.pane === pane) ? prev.el.getBoundingClientRect() : null;
    const nextB = next && (!pg || next.pane === pane) ? next.el.getBoundingClientRect() : null;
    const parent = p.parentId ? rest.find((r) => r.id === p.parentId) : undefined;
    let y: number;
    if (prevB && parent && prev.id === parent.id) y = prevB.bottom + 1;
    else if (prevB && nextB) y = (prevB.bottom + nextB.top) / 2;
    else if (nextB) y = nextB.top - 1;
    else if (prevB) y = prevB.bottom + 1;
    else y = py;
    // 聚焦区和「接下来」的分界：插入线画在落点那一边（框里的最后一件下面，或「接下来」第一行上面）
    if (!p.parentId && prevB && prev.zone && !next?.zone) {
      if (focusDrop === true) y = prevB.bottom + 1;
      else if (focusDrop === false && nextB) y = nextB.top - 1;
      else if (focusDrop === false) y = (zoneBox()?.getBoundingClientRect().bottom ?? prevB.bottom) + 14;
    }
    // 聚焦区空着：框本身描边就是反馈，不画插入线
    if (focusDrop === true && !wasZone && !rest.some((r) => r.zone)) {
      line.classList.remove('on');
      guide.classList.remove('on');
      setParent(null);
      return;
    }

    // 左端：同父、同深度的上一个兄弟的圆圈；没有就是父项往右缩一级；顶层用这一页里第一行
    let ref: Row | undefined;
    for (let k = g - 1; k >= 0; k--) {
      const r = rest[k];
      if (r.depth < p.depth) break;
      if (r.depth === p.depth && r.parentId === p.parentId && (!pg || r.pane === pane)) {
        ref = r;
        break;
      }
    }
    if (!ref && !parent) ref = rest.find((r) => r.depth === 0 && (!pg || r.pane === pane));
    let left: number;
    let right: number;
    if (ref) {
      left = markerOf(ref.el).getBoundingClientRect().left;
      right = ref.el.getBoundingClientRect().right;
    } else if (parent) {
      left = markerOf(parent.el).getBoundingClientRect().left + childIndent(parent.el);
      right = parent.el.getBoundingClientRect().right;
    } else {
      const b = prevB ?? nextB;
      left = b ? b.left : px - 40;
      right = b ? b.right : px + 200;
    }
    // 双页时不画进折痕区
    if (pg) right = Math.min(right, pane === 'l' ? pg.leftEnd - 4 : window.innerWidth - 8);
    line.style.transform = `translate(${left}px, ${y}px)`;
    line.style.width = `${Math.max(40, right - left)}px`;
    line.classList.add('on');

    setParent(parent?.el ?? null);
    if (parent && (!pg || parent.pane === pane)) {
      const pb = parent.el.getBoundingClientRect();
      const mk = markerOf(parent.el).getBoundingClientRect();
      const top = pb.bottom + 2;
      if (y - top > 10) {
        guide.style.transform = `translate(${mk.left + mk.width / 2 - 1}px, ${top}px)`;
        guide.style.height = `${y - top}px`;
        guide.classList.add('on');
      } else guide.classList.remove('on');
    } else guide.classList.remove('on');
  };

  /** 在折叠着子项的行上停 600ms 就展开（「接下来」的行在界面上展开，列表里的行改数据里的折叠） */
  const hoverExpand = (rest: Row[], pane: 'l' | 'r') => {
    const over = rest.find((r) => (!pg || r.pane === pane) && r.collapsed && hits(r.el.getBoundingClientRect(), px, py));
    if (!over) {
      hoverId = null;
      clearTimeout(expandTimer);
      return;
    }
    if (hoverId === over.id) return;
    hoverId = over.id;
    clearTimeout(expandTimer);
    expandTimer = setTimeout(() => {
      if (done || hoverId !== over.id) return;
      if (over.el.classList.contains('q-row')) toggleExpanded(over.id);
      else useData.getState().setCollapsed(over.id, false);
      haptic.selection();
      // 展开后行变了：等界面画出来再算
      requestAnimationFrame(() => requestAnimationFrame(layout));
    }, EXPAND_MS);
  };

  const scrollerAt = () =>
    pg ? document.querySelector<HTMLElement>(paneOf(px) === 'l' ? '.pane-l' : '.pane-r') : scrollParent(node);

  // 拖到滚动区上下边缘时自动滚，越靠边越快
  const tick = () => {
    raf = 0;
    if (done) return;
    const scroller = scrollerAt();
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    const [insetTop, insetBottom] = insets();
    const top = Math.max(box.top, insetTop);
    const bottom = Math.min(box.bottom, window.innerHeight - insetBottom);
    let v = 0;
    if (py < top + EDGE && py > top - EDGE) v = -MAX_SPEED * Math.min(1, (top + EDGE - py) / EDGE);
    else if (py > bottom - EDGE && py < bottom + EDGE) v = MAX_SPEED * Math.min(1, (py - bottom + EDGE) / EDGE);
    if (v) {
      const before = scroller.scrollTop;
      scroller.scrollTop += v;
      if (scroller.scrollTop !== before) layout();
      raf = requestAnimationFrame(tick);
    }
  };

  const follow = () => {
    ghost.style.transform = `translate(${px - grabX - rr.left}px, ${py - grabY - rr.top}px) scale(1.03)`;
  };

  const cleanup = () => {
    done = true;
    cancelAnimationFrame(raf);
    clearTimeout(expandTimer);
    haptic.selectionEnd();
    setParent(null);
    setDropZone(false);
    node.classList.remove('drag-source');
    document.documentElement.classList.remove('is-dragging');
    ghost.remove();
    line.remove();
    guide.remove();
    requestAnimationFrame(() => useUi.getState().set({ draggingId: null }));
  };

  /** 取消：副本飞回原位（减弱动态效果时直接回去） */
  const flyBack = () => {
    done = true;
    cancelAnimationFrame(raf);
    hideFeedback();
    if (reduce) return cleanup();
    const back = row.getBoundingClientRect();
    ghost.classList.add('is-landing');
    ghost.style.transform = `translate(${back.left - rr.left}px, ${back.top - rr.top}px)`;
    setTimeout(cleanup, 180);
  };

  const commit = () => {
    const p = proj;
    const latest = activeOf(useData.getState()).todos;
    const me = latest.find((t) => t.id === todo.id);
    const zoneMove = zoneChanged();
    // 拖回原处（也没进出聚焦区）、拖出列表区、被拖的项已被别处删掉：取消
    if (!p || (p.unchanged && !zoneMove) || !inside || !me) return flyBack();
    const intoZone = focusDrop;
    const target: PlaceTarget = { list: p.list, parentId: p.parentId, index: p.index, focused: intoZone };
    const moved = target.parentId !== me.parentId || target.list !== me.list;
    const parentTitle = target.parentId ? latest.find((t) => t.id === target.parentId)?.title : null;
    const land = () => {
      flushSync(() => {
        cleanup();
        useData.getState().place(todo.id, target);
      });
      haptic.light();
      // 拖进聚焦区：新的聚焦项荧光绿闪一下
      if (intoZone && !wasZone) markAdded(todo.id);
      if (moved || zoneMove)
        showUndoToast(
          parentTitle
            ? `已移到「${truncate(parentTitle, 12)}」下`
            : intoZone && !wasZone
              ? '已放进聚焦区'
              : wasZone && intoZone === false
                ? '已移出聚焦区'
                : `已移到 ${listLabel(target.list)} 顶层`,
          () => {
            useData.getState().place(todo.id, origin);
            haptic.light();
          },
        );
    };
    if (reduce) return land();
    // 副本落到插入线上（聚焦区空着时落进虚线框）再写入
    done = true;
    cancelAnimationFrame(raf);
    const box = !line.classList.contains('on') && intoZone ? zoneBox()?.getBoundingClientRect() : null;
    const lb = box ?? line.getBoundingClientRect();
    ghost.classList.add('is-landing');
    ghost.style.transform = box
      ? `translate(${box.left + 12 - rr.left}px, ${box.top + box.height / 2 - rr.height / 2 - rr.top}px) scale(0.98)`
      : `translate(${lb.left - rr.left - 8}px, ${lb.top - rr.top - 6}px) scale(0.98)`;
    setTimeout(land, 150);
  };

  follow();
  layout();

  return {
    move(nx, ny) {
      if (done) return;
      px = nx;
      py = ny;
      follow();
      layout();
      if (!raf) raf = requestAnimationFrame(tick);
    },
    end() {
      if (done) return;
      layout();
      commit();
    },
    cancel() {
      if (!done) flyBack();
    },
  };
}
