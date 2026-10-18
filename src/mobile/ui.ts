// 仅界面使用的临时状态（不落盘）
import { useEffect, type RefObject } from 'react';
import { create } from 'zustand';
import type { ListId } from '../types';
import type { Section } from './data';

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface TodoMenu {
  todoId: string;
  /** 长按时那一行的位置，菜单和"抬起"的预览卡片据此定位 */
  rect: Rect;
  /** 从 HISTORY 打开时只给少量操作；NOW 卡上的子任务是另一组（完成、编辑、待验证、升一级、删除） */
  from: 'list' | 'history' | 'sub';
  /** 直接展开「移到…」子菜单（左滑点「移动」时） */
  moveFirst?: boolean;
}

/**
 * 编辑时回车开出来的空行（还没真正新建）：有内容再回车才建，建在 afterId 后面；afterId 为空时是父项下的第一条。
 * 空行可以缩进 / 反缩进，只是换个位置，还没写进数据。
 */
export interface Draft {
  list: ListId;
  parentId: string | null;
  afterId: string | null;
}

export interface ComposerState {
  open: boolean;
  list: ListId;
  parentId: string | null;
}

export interface ToastState {
  key: number;
  text: string;
  /** 可撤销的删除：对应的回收站条目 */
  undoEntry?: string;
  /** 别的可撤销操作（拖动换了父项）：点「撤销」时执行 */
  undo?: () => void;
}

interface UiState {
  /** 正在播放完成动画、还没写入数据的项 */
  completing: Record<string, true>;
  editingId: string | null;
  draft: Draft | null;
  /** NOW 卡上子任务收起了的那件（太多时可以收起） */
  subsFolded: Record<string, true>;
  /** 正在拖动排序的那一项 */
  draggingId: string | null;
  /** 当前滑开着操作按钮的行，同时只开一行 */
  swipedId: string | null;
  menu: TodoMenu | null;
  composer: ComposerState;
  sheet: null | 'profiles' | 'trash' | 'sync' | 'conflicts';
  /** 右上角 ⋯ 下拉菜单的锚点 */
  more: Rect | null;
  toast: ToastState | null;
  /** 分区"收到东西"的脉冲计数，变化即触发动画 */
  pulse: Record<Section, number>;
  /** 页面滚过了顶部（导航栏底下出现毛玻璃） */
  scrolled: boolean;
  /** 「接下来」里展开了子任务的行（只在界面上，不落盘） */
  expanded: Record<string, true>;
  /** 刚新建的行：撑开 + 荧光绿闪一下 */
  added: Record<string, true>;
  /** 正在播「完成 NOW · 换场」的那一件 */
  handoff: string | null;
  set(p: Partial<Omit<UiState, 'set'>>): void;
}

export const useUi = create<UiState>((set) => ({
  completing: {},
  editingId: null,
  draft: null,
  subsFolded: {},
  draggingId: null,
  swipedId: null,
  menu: null,
  composer: { open: false, list: 'focus', parentId: null },
  sheet: null,
  more: null,
  toast: null,
  pulse: { focus: 0, verify: 0, inbox: 0, goal: 0, history: 0 },
  scrolled: false,
  expanded: {},
  added: {},
  handoff: null,
  set: (p) => set(p),
}));

export function pulse(section: Section) {
  const cur = useUi.getState().pulse;
  useUi.getState().set({ pulse: { ...cur, [section]: cur[section] + 1 } });
}

let toastKey = 0;
export function showToast(text: string, undoEntry?: string) {
  useUi.getState().set({ toast: { key: ++toastKey, text, undoEntry } });
}

/** 带「撤销」的提示条（5 秒） */
export function showUndoToast(text: string, undo: () => void) {
  useUi.getState().set({ toast: { key: ++toastKey, text, undo } });
}

export const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

/** 输入框所在容器变宽 / 变窄时（切换形态、旋转）重新算自适应高度 */
export function useRefitOnWidth(ref: RefObject<HTMLElement | null>, fit: () => void) {
  useEffect(() => {
    const box = ref.current?.parentElement;
    if (!box) return;
    let width = box.clientWidth;
    const ro = new ResizeObserver(() => {
      if (box.clientWidth === width) return;
      width = box.clientWidth;
      fit();
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [ref, fit]);
}

/** 标记刚新建的行，一会儿后撤掉（新建动效只播一次） */
export function markAdded(id: string) {
  useUi.getState().set({ added: { ...useUi.getState().added, [id]: true } });
  setTimeout(() => {
    const rest = { ...useUi.getState().added };
    delete rest[id];
    useUi.getState().set({ added: rest });
  }, 900);
}

export function toggleExpanded(id: string) {
  const cur = { ...useUi.getState().expanded };
  if (cur[id]) delete cur[id];
  else cur[id] = true;
  useUi.getState().set({ expanded: cur });
}

/** 元素所在的滚动页（单页时是 .screen；双页时左右两页各自滚动） */
export function scrollParent(el: Element | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    if (!p.matches('.screen, .pane-l, .pane-r')) continue;
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') return p;
  }
  return null;
}
