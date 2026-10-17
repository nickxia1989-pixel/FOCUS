// 自写的指针拖拽：同层同状态内排序、拖到页签 / 侧栏上换列表、拖到 NOW 卡上设为现在。
// 不移动兄弟节点，只画一条插入线，嵌套结构下最稳。
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ListId } from './types';

export interface DragOptions {
  id: string;
  list: ListId;
  /** 同层、同完成状态的兄弟 id（含自身），按当前显示顺序 */
  siblingIds: string[];
  /** 子孙数量，用于拖拽预览上的角标 */
  descendantCount: number;
  onReorder(id: string, toIndex: number): void;
  onMoveToList(id: string, list: ListId): void;
  onHoverTab(list: ListId | null): void;
  /** 能拖到 NOW 卡上（FOCUS 队列里的行）：松手时给出拖拽预览的位置，用来做交接动画 */
  onDropNow?(id: string, ghostRect: DOMRect): void;
  onHoverNow?(over: boolean): void;
}

const THRESHOLD = 5;
const EDGE = 44;

const nodeEl = (id: string) => document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);

export function beginPointerDrag(e: ReactPointerEvent, opts: DragOptions) {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement;
  if (target.closest('button, input, textarea, a, [data-no-drag]')) return;

  const row = e.currentTarget as HTMLElement;
  const startX = e.clientX;
  const startY = e.clientY;
  let started = false;
  let ghost: HTMLElement | null = null;
  let line: HTMLElement | null = null;
  let grabDX = 0;
  let grabDY = 0;
  let lastX = startX;
  let lastY = startY;
  let tab: ListId | null = null;
  let overNow = false;
  let insertAt: number | null = null;
  let raf = 0;
  const scroller = row.closest<HTMLElement>('.view');
  const others = opts.siblingIds.filter((x) => x !== opts.id);
  const fromIndex = opts.siblingIds.indexOf(opts.id);

  const start = () => {
    started = true;
    const rect = row.getBoundingClientRect();
    grabDX = startX - rect.left;
    grabDY = startY - rect.top;
    ghost = row.cloneNode(true) as HTMLElement;
    ghost.classList.remove('lift', 'flash', 'menu-open');
    ghost.classList.add('drag-ghost');
    ghost.style.width = `${rect.width}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    if (opts.descendantCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'drag-ghost-badge';
      badge.textContent = `+${opts.descendantCount}`;
      ghost.appendChild(badge);
    }
    document.body.appendChild(ghost);
    line = document.createElement('div');
    line.className = 'drop-line';
    document.body.appendChild(line);
    nodeEl(opts.id)?.classList.add('is-dragging');
    document.body.classList.add('dragging');
    window.getSelection()?.removeAllRanges();
    raf = requestAnimationFrame(autoScroll);
  };

  const update = () => {
    if (!ghost || !line) return;
    ghost.style.transform = `translate(${lastX - grabDX - parseFloat(ghost.style.left)}px, ${lastY - grabDY - parseFloat(ghost.style.top)}px) rotate(-2deg)`;

    // 页签优先：拖到其它列表的页签上即为移动
    const hit = document.elementFromPoint(lastX, lastY) as HTMLElement | null;
    const tabEl = hit?.closest<HTMLElement>('[data-tab-id]');
    const tabId = (tabEl?.dataset.tabId as ListId | undefined) ?? null;
    const newTab = tabId && tabId !== opts.list ? tabId : null;
    if (newTab !== tab) {
      tab = newTab;
      opts.onHoverTab(tab);
    }
    // 其次是 NOW 卡：松手 = 设为现在
    const nowHit = !tab && !!opts.onDropNow && !!hit?.closest('[data-drop-now]');
    if (nowHit !== overNow) {
      overNow = nowHit;
      opts.onHoverNow?.(overNow);
    }
    if (tab || overNow) {
      insertAt = null;
      line.style.opacity = '0';
      return;
    }

    // 在兄弟之间找插入位置
    const rects = others.map((id) => nodeEl(id)?.getBoundingClientRect()).filter((r): r is DOMRect => !!r);
    if (rects.length !== others.length || rects.length === 0) {
      insertAt = null;
      line.style.opacity = '0';
      return;
    }
    let idx = rects.length;
    for (let i = 0; i < rects.length; i++) {
      if (lastY < rects[i].top + rects[i].height / 2) {
        idx = i;
        break;
      }
    }
    insertAt = idx === fromIndex ? null : idx;
    if (insertAt === null) {
      line.style.opacity = '0';
      return;
    }
    const self = nodeEl(opts.id)?.getBoundingClientRect();
    const y = idx < rects.length ? rects[idx].top : rects[rects.length - 1].bottom;
    const left = self?.left ?? rects[0].left;
    const width = self?.width ?? rects[0].width;
    line.style.opacity = '1';
    line.style.transform = `translate(${left + 6}px, ${y - 1}px)`;
    line.style.width = `${width - 12}px`;
  };

  function autoScroll() {
    if (scroller && !tab && !overNow) {
      const r = scroller.getBoundingClientRect();
      let dy = 0;
      if (lastY < r.top + EDGE) dy = -Math.ceil((r.top + EDGE - lastY) / 4);
      else if (lastY > r.bottom - EDGE) dy = Math.ceil((lastY - (r.bottom - EDGE)) / 4);
      if (dy) {
        scroller.scrollTop += Math.max(-18, Math.min(18, dy));
        update();
      }
    }
    raf = requestAnimationFrame(autoScroll);
  }

  const onMove = (ev: PointerEvent) => {
    lastX = ev.clientX;
    lastY = ev.clientY;
    if (!started) {
      if (Math.hypot(lastX - startX, lastY - startY) < THRESHOLD) return;
      start();
    }
    ev.preventDefault();
    update();
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    cancelAnimationFrame(raf);
    ghost?.remove();
    line?.remove();
    nodeEl(opts.id)?.classList.remove('is-dragging');
    document.body.classList.remove('dragging');
    opts.onHoverTab(null);
    opts.onHoverNow?.(false);
    if (started) {
      // 吞掉拖拽结束后紧跟的 click，避免误触勾选/编辑
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    }
  };

  const onUp = () => {
    const dropTab = tab;
    const dropNow = overNow;
    const dropAt = insertAt;
    const ghostRect = ghost?.getBoundingClientRect();
    cleanup();
    if (!started) return;
    if (dropTab) opts.onMoveToList(opts.id, dropTab);
    else if (dropNow && ghostRect) opts.onDropNow?.(opts.id, ghostRect);
    else if (dropAt !== null) opts.onReorder(opts.id, dropAt);
  };

  const onCancel = () => {
    tab = null;
    overNow = false;
    insertAt = null;
    cleanup();
  };

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      onCancel();
    }
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
}
