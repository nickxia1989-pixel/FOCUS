// 编辑标题时调层级（和桌面同一套规则）：
// - Enter：保存，并在它后面开一个同级空行继续写；空行有内容再 Enter 才真正新建（placement { after }），空行上直接 Enter 就结束
// - 缩进：挂到上一个同级下面，成为它的最后一个子项；反缩进：升一级，排在原父项后面
// - 同级第一个缩进、顶层反缩进时不动，轻轻抖一下
// - 空行上按删除键：关掉空行，回到上一条
// 软键盘没有 Tab，所以键盘上方另有一条工具条（EditBar）；接了硬件键盘时 Tab / Shift+Tab 也能用。
//
// 条目挪到树的别处（缩进、反缩进、上移成 NOW…）时 React 会换一个编辑框。先把焦点交给一个常驻的隐藏输入框，
// 换好后再交回来，iOS 的软键盘就不会收起；旧编辑框失焦时照常保存文字，所以字不会丢。
import { flushSync } from 'react-dom';
import { siblingsOf } from '../model';
import type { Todo } from '../types';
import { haptic } from './native';
import { activeOf, useData } from './store';
import { markAdded, scrollParent, useUi, type Draft } from './ui';

let keeper: HTMLTextAreaElement | null = null;
/** 正在换编辑框：这期间空行失焦不算「点了别处」 */
let handing = false;
/** 空行里已经写了的字（空行换位置时编辑框会重新挂载，字从这里接上） */
let draftText = '';

export const isHandingOver = () => handing;
export const getDraftText = () => draftText;
export const setDraftText = (t: string) => {
  draftText = t;
};

function ensureKeeper() {
  if (keeper?.isConnected) return keeper;
  keeper = document.createElement('textarea');
  keeper.setAttribute('aria-hidden', 'true');
  keeper.tabIndex = -1;
  // 16px 免得 iOS 聚焦时放大页面；放在屏幕里（屏幕外的输入框 iOS 有时不给键盘）
  keeper.style.cssText =
    'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;pointer-events:none;resize:none';
  document.body.appendChild(keeper);
  return keeper;
}

const todosNow = () => activeOf(useData.getState()).todos;
const find = (id: string) => todosNow().find((t) => t.id === id);

/**
 * 换编辑框：先把焦点交给隐藏输入框（旧编辑框失焦、保存），fn 里同步改数据和界面，再聚焦新的编辑框。
 * caret：新编辑框里光标放在哪（默认末尾）
 */
function handOver(fn: () => void, target: { id: string } | 'draft', caret?: number) {
  const k = ensureKeeper();
  handing = true;
  try {
    k.focus({ preventScroll: true });
    flushSync(fn);
  } finally {
    handing = false;
  }
  const sel = target === 'draft' ? '[data-draft-input]' : `[data-edit-input="${CSS.escape(target.id)}"]`;
  const el = document.querySelector<HTMLTextAreaElement>(sel);
  if (!el) {
    k.blur();
    return;
  }
  el.focus({ preventScroll: true });
  const n = Math.min(caret ?? el.value.length, el.value.length);
  el.setSelectionRange(n, n);
  revealInput(el);
}

/**
 * 把正在编辑的那一行滚到看得见的地方：不压在导航栏下面，也不压在键盘和工具条下面
 * （WebView 不随软键盘缩小，所以要自己算）
 */
export function revealInput(el: Element | null) {
  if (!el) return;
  const scroller = scrollParent(el);
  const app = document.querySelector<HTMLElement>('.app');
  if (!scroller || !app) return;
  // --inset-* 是 calc()，借一个探针元素取算好的值
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;padding-top:var(--inset-top);padding-bottom:var(--inset-bottom);margin-top:var(--kb)';
  app.appendChild(probe);
  const ps = getComputedStyle(probe);
  const insetTop = parseFloat(ps.paddingTop) || 0;
  const insetBottom = parseFloat(ps.paddingBottom) || 0;
  const kb = parseFloat(ps.marginTop) || 0;
  probe.remove();
  const top = Math.max(insetTop, scroller.getBoundingClientRect().top) + 12;
  // 工具条约 60 高；没有软键盘时它浮在页签栏上面
  const bottom = window.innerHeight - Math.max(kb, insetBottom) - 72;
  const r = el.getBoundingClientRect();
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  if (r.bottom > bottom) scroller.scrollBy({ top: r.bottom - bottom, behavior });
  else if (r.top < top) scroller.scrollBy({ top: r.top - top, behavior });
}

/** 不能这么挪：那一行左右抖一下 */
export function shake(target: string | 'draft') {
  haptic.light();
  const el =
    target === 'draft'
      ? document.querySelector('[data-draft-row]')
      : document.querySelector(`[data-anchor="${CSS.escape(target)}"]`);
  if (!el) return;
  el.classList.remove('shake');
  void (el as HTMLElement).offsetWidth;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 420);
}

/** 让某一项的子项露出来（挂到收着的父项下时自动展开） */
function reveal(parentId: string) {
  const ui = useUi.getState();
  const parent = find(parentId);
  if (parent?.collapsed) useData.getState().setCollapsed(parentId, false);
  if (!ui.expanded[parentId]) ui.set({ expanded: { ...ui.expanded, [parentId]: true } });
  if (ui.subsFolded[parentId]) {
    const rest = { ...ui.subsFolded };
    delete rest[parentId];
    ui.set({ subsFolded: rest });
  }
}

/** 同级里未完成的那组（上移 / 下移、缩进看的都是界面上挨着的） */
function openSiblings(todo: Todo) {
  return siblingsOf(todosNow(), todo).filter((t) => !t.done);
}

const caretOf = (id: string) =>
  document.querySelector<HTMLTextAreaElement>(`[data-edit-input="${CSS.escape(id)}"]`)?.selectionStart ?? undefined;

// ---------- 正在编辑的条目 ----------

/** Enter：保存（旧编辑框失焦时保存），在它后面开一个同级空行 */
export function editNext(todo: Todo) {
  if (todo.done) {
    endEditing();
    return;
  }
  draftText = '';
  const draft: Draft = { list: todo.list, parentId: todo.parentId, afterId: todo.id };
  handOver(() => useUi.getState().set({ editingId: null, draft }), 'draft');
}

export function indentItem(todo: Todo) {
  const sibs = siblingsOf(todosNow(), todo);
  const i = sibs.findIndex((t) => t.id === todo.id);
  if (i <= 0) return shake(todo.id);
  const parent = sibs[i - 1];
  haptic.light();
  handOver(
    () => {
      useData.getState().indent(todo.id);
      reveal(parent.id);
      useUi.getState().set({ editingId: todo.id });
    },
    { id: todo.id },
    caretOf(todo.id),
  );
}

export function outdentItem(todo: Todo) {
  if (todo.parentId === null) return shake(todo.id);
  haptic.light();
  handOver(
    () => {
      useData.getState().outdent(todo.id);
      useUi.getState().set({ editingId: todo.id });
    },
    { id: todo.id },
    caretOf(todo.id),
  );
}

/** 上移 / 下移一位（FOCUS 顶层上移到第一位就成了 NOW） */
export function moveItem(todo: Todo, delta: -1 | 1) {
  const group = openSiblings(todo);
  const i = group.findIndex((t) => t.id === todo.id);
  const to = i + delta;
  if (i < 0 || to < 0 || to >= group.length) return shake(todo.id);
  haptic.selection();
  handOver(
    () => {
      useData.getState().reorder(todo.id, to);
      useUi.getState().set({ editingId: todo.id });
    },
    { id: todo.id },
    caretOf(todo.id),
  );
}

export function endEditing() {
  const el = document.activeElement as HTMLElement | null;
  if (el?.matches('[data-edit-input], [data-draft-input]')) el.blur();
  else useUi.getState().set({ editingId: null, draft: null });
}

// ---------- 空行 ----------

/** 空行上 Enter：有内容就建在 afterId 后面并接着开下一行；没内容就结束 */
export function commitDraft(text: string, keepGoing: boolean) {
  const d = useUi.getState().draft;
  if (!d) return;
  const title = text.trim();
  if (!title) {
    closeDraft();
    return;
  }
  const id = useData.getState().add(title, d.list, d.parentId, d.afterId ? { after: d.afterId } : undefined);
  draftText = '';
  if (!id) return;
  haptic.light();
  markAdded(id);
  if (keepGoing) handOver(() => useUi.getState().set({ draft: { ...d, afterId: id } }), 'draft');
  else useUi.getState().set({ draft: null });
}

export function closeDraft() {
  draftText = '';
  if (useUi.getState().draft) useUi.getState().set({ draft: null });
}

/** 空行上按删除键：关掉空行，回到上一条（没有上一条就回到父项） */
export function backFromDraft() {
  const d = useUi.getState().draft;
  if (!d) return;
  const back = d.afterId ?? d.parentId;
  draftText = '';
  if (!back || !find(back)) {
    closeDraft();
    return;
  }
  handOver(() => useUi.getState().set({ draft: null, editingId: back }), { id: back });
}

/** 空行缩进：挂到上一条下面，成为它的最后一个子项 */
export function indentDraft() {
  const d = useUi.getState().draft;
  const prev = d?.afterId ? find(d.afterId) : undefined;
  if (!d || !prev) return shake('draft');
  const first = todosNow().find((t) => t.parentId === prev.id && !t.done);
  const kids = first ? openSiblings(first) : [];
  const last = kids.length ? kids[kids.length - 1] : null;
  haptic.light();
  handOver(() => {
    reveal(prev.id);
    useUi.getState().set({ draft: { list: prev.list, parentId: prev.id, afterId: last?.id ?? null } });
  }, 'draft');
}

/** 空行反缩进：升一级，排在原父项后面 */
export function outdentDraft() {
  const d = useUi.getState().draft;
  const parent = d?.parentId ? find(d.parentId) : undefined;
  if (!d || !parent) return shake('draft');
  haptic.light();
  handOver(() => useUi.getState().set({ draft: { list: parent.list, parentId: parent.parentId, afterId: parent.id } }), 'draft');
}

/** 某一项后面要不要接空行；afterId 为空的空行由父项自己放在子项最前面 */
export const draftAfter = (d: Draft | null, todo: Todo) =>
  !!d && d.afterId === todo.id && d.parentId === todo.parentId && !todo.done;
export const draftFirstUnder = (d: Draft | null, parentId: string) => !!d && d.afterId === null && d.parentId === parentId;
