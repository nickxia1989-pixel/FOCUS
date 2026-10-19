// 桌面的自由拖拽（规则见 docs/drag.md，落点算法在 src/dragTree.ts）。
// 一棵树里的任何一项都能拖到任何位置：纵坐标选空隙，横坐标按每级缩进换算深度。
// 界面这边负责：把看得见的行摊平（带位置）、画插入线和新父项高亮、悬停展开、边缘滚动、
// 拖到页签 / 侧栏换列表（停 800ms 切过去继续拖）、拖进 / 拖出 FOCUS 的聚焦区、放下后可撤销。
import type { PointerEvent as ReactPointerEvent } from 'react';
import { goView, moveToListByDrag } from './actions';
import { depthFromOffset, projectDrop, restRows, type DragRow, type DropProjection } from './dragTree';
import { prepareHandoff, reduceMotion, setExitMode } from './fx';
import { compareTodos, descendantIds, inZone } from './model';
import { showToast, useData, useUi } from './store';
import type { ListId, Todo } from './types';

/** 每级缩进的像素（横向位移换算深度用；子项实际缩进约 22–26px） */
export const INDENT = 24;
const THRESHOLD = 5;
const EDGE = 44;
const HOLD_EXPAND = 600;
const HOLD_TAB = 800;

/** 摊平后的一行，位置是滚动区内容坐标（不随滚动变） */
interface Row extends DragRow {
  el: HTMLElement;
  top: number;
  bottom: number;
  mid: number;
  /** 这一行内容（勾选圈）的横坐标，画插入线的左端用 */
  x: number;
  right: number;
  /** 它的子项比它往右缩多少 */
  childIndent: number;
  /** 在 FOCUS 的聚焦区里（聚焦项和它的子任务） */
  zone: boolean;
}

/**
 * 行上的标记（由各组件写在可拖的那一行上）：
 * data-drag-id / data-depth / data-parent / data-list / data-done / data-collapsed / data-indent，
 * 位置取 [data-drag-rect] 子元素（聚焦项、GOAL 卡取标题行），没有就取自己。
 * 聚焦区（和它空着时的虚线框、FOCUS 整个空着时的空状态）带 data-zone，「接下来」的容器带 data-queue。
 */
export function dragAttrs(t: Todo, depth: number, opts: { collapsed?: boolean; indent: number }) {
  return {
    'data-drag-id': t.id,
    'data-depth': depth,
    'data-parent': t.parentId ?? '',
    'data-list': t.list,
    'data-done': t.done ? '1' : '0',
    'data-collapsed': opts.collapsed ? '1' : '0',
    'data-indent': opts.indent,
  };
}

/** 当前视图的滚动区（切换列表的交叉淡入期间旧视图还在，按 key 找新的） */
function currentScroller(): HTMLElement | null {
  const views = [...document.querySelectorAll<HTMLElement>('.view')];
  return views.find((v) => v.dataset.viewKey === currentViewKey()) ?? views[views.length - 1] ?? null;
}

function currentViewKey() {
  const s = useData.getState();
  return `${s.profileId}:${useUi.getState().trashOpen ? 'trash' : s.prefs.activeView}`;
}

function collect(scroller: HTMLElement): Row[] {
  const sr = scroller.getBoundingClientRect();
  const st = scroller.scrollTop;
  const rows: Row[] = [];
  for (const el of scroller.querySelectorAll<HTMLElement>('[data-drag-id]')) {
    const box = el.querySelector<HTMLElement>(':scope > [data-drag-rect]') ?? el;
    const r = box.getBoundingClientRect();
    if (!r.height) continue;
    const d = el.dataset;
    const top = r.top - sr.top + st;
    const bottom = r.bottom - sr.top + st;
    rows.push({
      id: d.dragId!,
      depth: Number(d.depth),
      parentId: d.parent || null,
      list: d.list as ListId,
      done: d.done === '1',
      collapsed: d.collapsed === '1',
      el,
      top,
      bottom,
      mid: (top + bottom) / 2,
      x: r.left + (parseFloat(getComputedStyle(box).paddingLeft) || 0),
      right: r.right,
      childIndent: Number(d.indent) || INDENT,
      zone: !!el.closest('[data-zone]'),
    });
  }
  return rows;
}

/** 插入线左端：缩进到落点深度 */
function lineX(rest: Row[], gap: number, depth: number, fallback: number): number {
  const prev = rest[gap - 1];
  if (prev && depth === prev.depth + 1) return prev.x + prev.childIndent;
  for (let k = gap - 1; k >= 0; k--) {
    if (rest[k].depth === depth) return rest[k].x;
    if (rest[k].depth < depth) break;
  }
  const next = rest[gap];
  if (next && next.depth === depth) return next.x;
  return fallback + depth * INDENT;
}

/** 在兄弟（同父、同完成状态）里排第几、在不在聚焦区：撤销时放回去用 */
function originOf(id: string) {
  const todos = useData.getState().todos;
  const t = todos.find((x) => x.id === id)!;
  const sibs = todos.filter((x) => x.parentId === t.parentId && (t.parentId !== null || x.list === t.list) && x.done === t.done).sort(compareTodos);
  return { list: t.list, parentId: t.parentId, index: Math.max(0, sibs.findIndex((x) => x.id === id)), focused: inZone(t) };
}

const titleOf = (id: string | null) => (id ? useData.getState().todos.find((t) => t.id === id)?.title ?? '' : '');
const trunc = (s: string, n = 10) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 把这一项放回拖之前的位置（撤销） */
function putBack(id: string, origin: ReturnType<typeof originOf>) {
  if (!useData.getState().todos.some((t) => t.id === id)) return;
  useData.getState().place(id, origin);
}

/**
 * 在一行上按下：移动超过 5px 才开始拖。按钮、输入框、编辑中的文字不触发；
 * 编辑中的行、播放完成动画的行不能拖。
 */
export function startTreeDrag(e: ReactPointerEvent, todo: Todo, opts: { no?: string } = {}) {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest('button, input, textarea, a, [data-no-drag], [data-editor]')) return;
  const ui = useUi.getState();
  if (ui.editingId === todo.id || ui.completing[todo.id]) return;
  const sourceRow = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-drag-id]') ?? (e.currentTarget as HTMLElement);

  const id = todo.id;
  const startX = e.clientX;
  const startY = e.clientY;
  let lastX = startX;
  let lastY = startY;
  let alt = e.altKey;
  let started = false;
  let scroller: HTMLElement | null = null;
  let rows: Row[] = [];
  let active: Row | null = null;
  /** 起拖时的深度和横坐标（切到别的列表后从 0 级重新算） */
  let baseDepth = 0;
  let baseX = startX;
  /** 切到了别的列表：被拖的项不在这棵树里，用一行假的接在最后 */
  let crossList = false;
  let dirty = false;
  let proj: DropProjection | null = null;
  let tab: ListId | null = null;
  let tabSince = 0;
  let hoverRow: string | null = null;
  let hoverSince = 0;
  let raf = 0;
  let ghost: HTMLElement | null = null;
  let line: HTMLElement | null = null;
  let stem: HTMLElement | null = null;
  let parentEl: HTMLElement | null = null;
  const srcEls: HTMLElement[] = [];
  const origin = originOf(id);
  const descendants = descendantIds(useData.getState().todos, id).size;

  const refresh = () => {
    if (!scroller) return;
    rows = collect(scroller);
    if (crossList) {
      const view = useData.getState().prefs.activeView;
      const list = (view === 'history' ? todo.list : view) as ListId;
      active = { id, depth: 0, parentId: null, list, done: todo.done, el: sourceRow, top: Infinity, bottom: Infinity, mid: Infinity, x: 0, right: 0, childIndent: INDENT, zone: false };
      rows = [...rows.filter((r) => r.id !== id), active];
    } else active = rows.find((r) => r.id === id) ?? active;
  };

  const start = () => {
    scroller = currentScroller();
    if (!scroller) return false;
    // 先进入拖拽状态再量行：悬停时才出现的按钮、「添加子任务」会收起，行的位置以收起后的为准
    document.body.classList.add('dragging');
    refresh();
    if (!active) {
      document.body.classList.remove('dragging');
      return false;
    }
    started = true;
    baseDepth = active.depth;
    // 被拖的那一项连同子孙变淡，原位置留着
    const at = rows.indexOf(active);
    for (let k = at; k < rows.length && (k === at || rows[k].depth > active.depth); k++) {
      rows[k].el.classList.add('drag-src');
      srcEls.push(rows[k].el);
    }
    // 浮起的副本：序号 / 勾选圈 + 标题 + 子项数角标
    const rr = sourceRow.getBoundingClientRect();
    ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.innerHTML = `${opts.no ? `<span class="no">${opts.no}</span>` : '<span class="g-cb"></span>'}<span class="g-tt"></span>${
      descendants ? `<span class="drag-ghost-badge">+${descendants}</span>` : ''
    }`;
    ghost.querySelector('.g-tt')!.textContent = todo.title;
    ghost.style.width = `${Math.max(160, Math.min(Math.max(rr.width, 200), 340, window.innerWidth - startX + 20))}px`;
    ghost.style.left = `${startX - 28}px`;
    ghost.style.top = `${startY + 10}px`;
    document.body.appendChild(ghost);
    line = document.createElement('div');
    line.className = 'drop-line';
    document.body.appendChild(line);
    stem = document.createElement('div');
    stem.className = 'drop-stem';
    document.body.appendChild(stem);
    document.body.classList.add('dragging');
    window.getSelection()?.removeAllRanges();
    raf = requestAnimationFrame(tick);
    return true;
  };

  const setParentHighlight = (el: HTMLElement | null) => {
    if (el === parentEl) return;
    parentEl?.classList.remove('drop-parent');
    parentEl = el;
    parentEl?.classList.add('drop-parent');
  };

  const hideFeedback = () => {
    if (line) line.style.opacity = '0';
    if (stem) stem.style.opacity = '0';
    setParentHighlight(null);
  };
  const setDropZone = (on: boolean) => {
    if (useUi.getState().dropZone !== on) useUi.getState().set({ dropZone: on });
  };
  /** 拖之前在不在聚焦区 */
  const wasZone = origin.focused;
  /** 这次落点进不进聚焦区（只对 FOCUS 顶层的未完成项有意义；其它情况 undefined） */
  let focusDrop: boolean | undefined;

  /**
   * FOCUS 顶层的落点进不进聚焦区：插入线落在聚焦区框里（含框的上方）就进，落在框下面就是「接下来」。
   * 聚焦区空着时拖到虚线框上、FOCUS 整个空着时拖进来，也都进聚焦区。
   */
  const zoneDropOf = (p: DropProjection | null): boolean | undefined => {
    if (!p || !scroller || todo.done || p.list !== 'focus' || p.parentId !== null) return undefined;
    const box = scroller.querySelector<HTMLElement>('[data-zone]');
    if (!box) return undefined;
    return lastY <= box.getBoundingClientRect().bottom + 4;
  };
  /** 落点只是进 / 出聚焦区（位置没变） */
  const zoneChanged = () => focusDrop !== undefined && focusDrop !== wasZone;

  const update = () => {
    if (!ghost || !line || !stem || !scroller) return;
    ghost.style.transform = `translate(${lastX - startX}px, ${lastY - startY}px) rotate(-2deg)`;

    // 页签 / 侧栏优先：拖上去就是换列表；停 800ms 切过去继续拖
    const hit = document.elementFromPoint(lastX, lastY) as HTMLElement | null;
    const tabEl = hit?.closest<HTMLElement>('[data-tab-id]');
    const tabId = (tabEl?.dataset.tabId as ListId | undefined) ?? null;
    const viewNow = useData.getState().prefs.activeView;
    const newTab = tabId && !(tabId === viewNow && crossList) && !(tabId === todo.list && todo.parentId === null && !crossList) ? tabId : null;
    if (newTab !== tab) {
      tab = newTab;
      tabSince = performance.now();
      useUi.getState().set({ dragOverTab: tab });
    }
    if (tab) {
      proj = null;
      focusDrop = undefined;
      hideFeedback();
      setDropZone(false);
      return;
    }

    if (dirty) return; // 等展开 / 切换后的行重新量好
    const sr = scroller.getBoundingClientRect();
    const py = lastY - sr.top + scroller.scrollTop;
    const rest = restRows(rows, id) as Row[];
    let gap = rest.findIndex((r) => py < r.mid);
    if (gap < 0) gap = rest.length;
    const want = alt ? baseDepth : depthFromOffset(baseDepth, lastX - baseX, INDENT);
    proj = projectDrop(rows, id, gap, want);

    // 悬停在折叠着子项的行上 600ms：展开
    const over = rest.find((r) => py >= r.top && py <= r.bottom);
    const overId = over?.collapsed ? over.id : null;
    if (overId !== hoverRow) {
      hoverRow = overId;
      hoverSince = performance.now();
    }

    // 从外面拖进聚焦区：整块描边，提示「松手 = 加入聚焦」
    focusDrop = zoneDropOf(proj);
    setDropZone(focusDrop === true && !wasZone);
    if (!proj || (proj.unchanged && !zoneChanged() && !crossList)) {
      hideFeedback();
      return;
    }

    // 插入线：深一级时紧贴上一行下面，否则贴着下一行上面；聚焦区和「接下来」的分界上画在落点那一边
    const prev = rest[gap - 1];
    const next = rest[gap];
    let yContent = prev && proj.depth > prev.depth ? prev.bottom + 1 : next ? next.top - 1 : (prev?.bottom ?? 0) + 1;
    if (focusDrop === true && prev?.zone && !next?.zone) yContent = prev.bottom + 1;
    if (focusDrop === false && prev?.zone && !next) {
      const q = scroller.querySelector<HTMLElement>('[data-queue]');
      if (q) yContent = q.getBoundingClientRect().top - sr.top + scroller.scrollTop + 1;
    }
    const y = yContent - scroller.scrollTop + sr.top;
    const base = rest.find((r) => r.depth === 0)?.x ?? sr.left + 16;
    const x = lineX(rest, gap, proj.depth, base);
    const right = Math.max(...rest.map((r) => r.right), x + 80);
    line.style.opacity = '1';
    line.style.left = `${x}px`;
    line.style.top = `${y - 1}px`;
    line.style.width = `${Math.max(40, right - x - 4)}px`;

    // 新父项高亮 + 竖线连到插入线
    const parent = proj.parentId ? rest.find((r) => r.id === proj!.parentId) : undefined;
    setParentHighlight(parent?.el ?? null);
    if (parent && parent.childIndent > 0) {
      const pBottom = parent.bottom - scroller.scrollTop + sr.top;
      stem.style.opacity = y > pBottom ? '1' : '0';
      stem.style.left = `${parent.x + parent.childIndent / 2 - 1}px`;
      stem.style.top = `${pBottom}px`;
      stem.style.height = `${Math.max(0, y - pBottom)}px`;
    } else stem.style.opacity = '0';
  };

  function tick() {
    const now = performance.now();
    // 停在页签上 800ms：切到那个列表继续拖
    if (tab && now - tabSince > HOLD_TAB && tab !== useData.getState().prefs.activeView) {
      const to = tab;
      goView(to);
      crossList = true;
      dirty = true;
      baseDepth = 0;
      baseX = lastX;
      tabSince = Infinity;
      setTimeout(() => {
        scroller = currentScroller();
        refresh();
        dirty = false;
        update();
      }, 320);
    }
    // 悬停 600ms 展开折叠的行
    if (hoverRow && now - hoverSince > HOLD_EXPAND) {
      expand(hoverRow);
      hoverRow = null;
      dirty = true;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          refresh();
          dirty = false;
          update();
        }),
      );
    }
    // 拖到滚动区上下边缘：自动滚，越靠边越快
    if (scroller && !tab) {
      const r = scroller.getBoundingClientRect();
      let dy = 0;
      if (lastY < r.top + EDGE) dy = -Math.ceil((r.top + EDGE - lastY) / 4);
      else if (lastY > r.bottom - EDGE) dy = Math.ceil((lastY - (r.bottom - EDGE)) / 4);
      if (dy) {
        scroller.scrollTop += Math.max(-18, Math.min(18, dy));
        update();
      }
    }
    raf = requestAnimationFrame(tick);
  }

  const onMove = (ev: PointerEvent) => {
    lastX = ev.clientX;
    lastY = ev.clientY;
    alt = ev.altKey;
    if (!started) {
      if (Math.hypot(lastX - startX, lastY - startY) < THRESHOLD) return;
      if (!start()) {
        cleanup(false);
        return;
      }
    }
    ev.preventDefault();
    update();
  };

  const cleanup = (wasStarted: boolean) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKeyUp, true);
    cancelAnimationFrame(raf);
    line?.remove();
    stem?.remove();
    setParentHighlight(null);
    for (const el of srcEls) el.classList.remove('drag-src');
    document.body.classList.remove('dragging');
    useUi.getState().set({ dragOverTab: null, dropZone: false });
    if (wasStarted) {
      // 吞掉拖拽结束后紧跟的 click，避免误触勾选 / 编辑
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    }
  };

  /** 取消：浮起的项飞回原位 */
  const flyBack = () => {
    const g = ghost;
    ghost = null;
    if (!g) return;
    const home = sourceRow.isConnected ? sourceRow.getBoundingClientRect() : null;
    if (!home || reduceMotion()) {
      g.remove();
      return;
    }
    g.animate([{ transform: g.style.transform, opacity: 1 }, { transform: `translate(${home.left + 28 - startX}px, ${home.top - 10 - startY}px)`, opacity: 0.2 }], {
      duration: 180,
      easing: 'cubic-bezier(.2,.8,.2,1)',
      fill: 'forwards',
    }).finished.then(() => g.remove(), () => g.remove());
  };

  const onUp = () => {
    if (!started) {
      cleanup(false);
      return;
    }
    const dropTab = tab;
    const ghostRect = ghost?.getBoundingClientRect();
    // 放下时按最新数据重新量一次（拖动中远端同步可能改了数据）
    if (!dropTab && scroller && !dirty) {
      refresh();
      update();
    }
    const p = proj;
    cleanup(true);
    const t = useData.getState().todos.find((x) => x.id === id);
    if (!t) {
      flyBack();
      return; // 被别处删掉了
    }
    if (dropTab) {
      ghost?.remove();
      ghost = null;
      moveToListByDrag(t, dropTab);
      offerUndo(id, origin, `已移到 ${dropTab.toUpperCase()}`);
      return;
    }
    const zoneMove = zoneChanged();
    if (!p || (p.unchanged && !crossList && !zoneMove)) {
      flyBack();
      return;
    }
    ghost?.remove();
    ghost = null;
    const intoZone = focusDrop;
    // 拖进聚焦区：新的聚焦项从松手的位置移过去，原来那一行直接消失
    if (intoZone && !wasZone && ghostRect) {
      prepareHandoff(id, ghostRect);
      setExitMode(id, 'instant');
    }
    useData.getState().place(id, { list: p.list, parentId: p.parentId, index: p.index, focused: intoZone });
    const structure = p.parentId !== origin.parentId || p.list !== origin.list;
    if (structure || zoneMove)
      offerUndo(
        id,
        origin,
        p.parentId
          ? `已移到「${trunc(titleOf(p.parentId))}」下`
          : intoZone
            ? '已放进聚焦区'
            : wasZone && p.list === 'focus'
              ? '已移出聚焦区'
              : `已移到 ${p.list.toUpperCase()} 顶层`,
      );
  };

  const onCancel = () => {
    tab = null;
    cleanup(started);
    flyBack();
  };

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      ev.preventDefault();
      onCancel();
      return;
    }
    if (ev.key === 'Alt' && started) {
      alt = true;
      update();
    }
  };
  const onKeyUp = (ev: KeyboardEvent) => {
    if (ev.key === 'Alt' && started) {
      alt = false;
      update();
    }
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKeyUp, true);
}

/** 悬停展开：「接下来」里的行用本次运行的展开状态，其它按各条的折叠状态（聚焦项总是展开） */
function expand(id: string) {
  const s = useData.getState();
  const t = s.todos.find((x) => x.id === id);
  if (!t) return;
  const ui = useUi.getState();
  if (t.list === 'focus' && t.parentId === null && !inZone(t)) ui.set({ queueOpen: { ...ui.queueOpen, [id]: true } });
  if (t.collapsed) s.setCollapsed(id, false);
}

/** 结构变了（换父项、层级或列表）：5 秒内可以撤销，放回原来的父项和位置 */
function offerUndo(id: string, origin: ReturnType<typeof originOf>, text: string) {
  showToast(text, undefined, () => putBack(id, origin));
}
