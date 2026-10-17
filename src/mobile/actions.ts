// 带动画 / 触感反馈的高层操作，供各组件调用
import { flushSync } from 'react-dom';
import { burst, chime, flyTo } from '../effects';
import { LISTS, type ListId, type Todo } from '../types';
import type { Section } from './data';
import { haptic } from './native';
import { useData } from './store';
import { pulse, showToast, useUi } from './ui';

/** 勾选后先播动画，稍后再真正写入（期间保持原位置） */
const CELEBRATE_MS = 640;

export const accentOf = (s: Section) =>
  getComputedStyle(document.documentElement).getPropertyValue(`--c-${s}`).trim() || '#f2622e';

export const listLabel = (list: ListId) => LISTS.find((l) => l.id === list)!.label;

function centerOf(el: Element | null | undefined) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** 底部标签栏或侧栏里，该分区的图标位置（取当前可见的那个） */
function sectionTarget(s: Section) {
  for (const el of document.querySelectorAll(`[data-target="${s}"]`)) {
    if (el.closest('[inert]')) continue; // 收起的侧栏 / 页签
    const c = centerOf(el);
    if (c && c.y > 0 && c.y < window.innerHeight) return c;
  }
  return null;
}

function checkAnchor(id: string) {
  return centerOf(document.querySelector(`[data-node-id="${CSS.escape(id)}"] .check`));
}

export function goSection(section: Section) {
  const ui = useUi.getState();
  if (ui.editingId || ui.menu || ui.swipedId) ui.set({ editingId: null, menu: null, swipedId: null });
  if (useData.getState().prefs.section === section) return;
  haptic.selection();
  useData.getState().setSection(section);
}

export function toggleTodo(todo: Todo) {
  const ui = useUi.getState();
  if (ui.completing[todo.id]) return;
  if (todo.done) {
    haptic.light();
    useData.getState().uncomplete(todo.id);
    return;
  }

  ui.set({ completing: { ...ui.completing, [todo.id]: true }, swipedId: null });
  haptic.success();
  const at = checkAnchor(todo.id);
  if (at) burst(at.x, at.y, accentOf(todo.list));
  if (useData.getState().prefs.sound) chime();

  setTimeout(() => {
    const from = checkAnchor(todo.id);
    const movedTo = useData.getState().complete(todo.id);
    const rest = { ...useUi.getState().completing };
    delete rest[todo.id];
    useUi.getState().set({ completing: rest });
    // FOCUS / VERIFY 的顶层项会离开当前列表：飞向 HISTORY，告诉用户它被记下了
    const to = movedTo ? sectionTarget('history') : null;
    if (from && to) flyTo(from, to, accentOf(todo.list), () => pulse('history'));
    else pulse('history');
  }, CELEBRATE_MS);
}

export function moveTodoTo(todo: Todo, list: ListId, fromEl?: Element | null) {
  const from = centerOf(fromEl) ?? checkAnchor(todo.id);
  useData.getState().move(todo.id, list);
  useUi.getState().set({ swipedId: null, menu: null });
  haptic.light();
  if (list === todo.list) {
    showToast('已移出父项，成为顶层项');
    return;
  }
  const to = sectionTarget(list);
  if (from && to) flyTo(from, to, accentOf(list), () => pulse(list));
  else showToast(`已移到 ${listLabel(list)}`);
}

/**
 * 做完但还要测：小小庆祝一下。
 * 顶层项飞进 VERIFY；子项留在父项下原地打上待测标记，不换列表。
 */
export function markForTest(todo: Todo, fromEl?: Element | null) {
  const at = centerOf(fromEl) ?? checkAnchor(todo.id);
  if (at) burst(at.x, at.y, accentOf('verify'));
  if (todo.parentId === null) moveTodoTo(todo, 'verify', fromEl);
  else {
    haptic.light();
    useData.getState().markForTest(todo.id);
    useUi.getState().set({ swipedId: null, menu: null });
  }
}

export function toggleTest(todo: Todo, fromEl?: Element | null) {
  if (todo.testing) {
    haptic.light();
    useData.getState().unmarkTest(todo.id);
  } else markForTest(todo, fromEl);
}

/** 删除进回收站；提示条上可直接撤销 */
export function deleteWithUndo(todo: Todo) {
  const entryId = useData.getState().remove(todo.id);
  useUi.getState().set({ swipedId: null, menu: null });
  if (!entryId) return;
  haptic.medium();
  const entry = useData
    .getState()
    .profiles.flatMap((p) => p.trash)
    .find((e) => e.id === entryId);
  const count = entry?.items.length ?? 1;
  const extra = count > 1 ? `（含 ${count - 1} 个子项）` : '';
  showToast(`已删除「${truncate(todo.title, 10)}」${extra}`, entryId);
}

export function undoDelete() {
  const { toast } = useUi.getState();
  if (!toast?.undoEntry) return;
  useData.getState().restoreTrash(toast.undoEntry);
  haptic.light();
  useUi.getState().set({ toast: null });
}

export function restoreFromTrash(entryId: string) {
  const list = useData.getState().restoreTrash(entryId);
  if (!list) return;
  haptic.light();
  pulse(list);
  showToast(`已恢复到 ${listLabel(list)}`);
}

// ---------- 新建输入卡片 ----------

let composerInput: HTMLTextAreaElement | null = null;
export function registerComposerInput(el: HTMLTextAreaElement | null) {
  composerInput = el;
}

/**
 * 打开底部的新建卡片。输入框常驻在 DOM 里，必须在点击事件里同步 focus，
 * iOS 才会弹出键盘（异步 focus 会被 WebKit 忽略）。
 */
export function openComposer(list: ListId, parentId: string | null = null) {
  useUi.getState().set({ composer: { open: true, list, parentId }, menu: null, swipedId: null, editingId: null });
  composerInput?.focus({ preventScroll: true });
}

export function closeComposer() {
  const ui = useUi.getState();
  if (!ui.composer.open) return;
  ui.set({ composer: { ...ui.composer, open: false, parentId: null } });
  composerInput?.blur();
}

/** 原地编辑标题：同样需要在点击里同步渲染出输入框再 focus */
export function startEdit(id: string) {
  flushSync(() => useUi.getState().set({ editingId: id, menu: null, swipedId: null }));
  const input = document.querySelector<HTMLTextAreaElement>(`[data-edit-input="${CSS.escape(id)}"]`);
  if (input) {
    input.focus({ preventScroll: true });
    const n = input.value.length;
    input.setSelectionRange(n, n);
  }
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
