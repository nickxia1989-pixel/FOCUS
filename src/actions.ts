// 带动画反馈的高层操作，供各组件调用
import { burst, chime, flyTo } from './effects';
import { sanitize } from './model';
import { pulseTab, showToast, useData, useUi } from './store';
import { LISTS, type ListId, type Todo } from './types';

/** 勾选后先播动画，稍后再真正写入（期间保持原位置） */
const CELEBRATE_MS = 720;

export const accentOf = (list: ListId) =>
  getComputedStyle(document.documentElement).getPropertyValue(`--c-${list}`).trim() || '#ff6a3d';

const listLabel = (list: ListId) => LISTS.find((l) => l.id === list)!.label;

function centerOf(el: Element | null | undefined) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function tabTarget(list: ListId) {
  return centerOf(document.querySelector(`[data-tab-id="${list}"] .tab-count`));
}

function rowAnchor(id: string) {
  return centerOf(document.querySelector(`[data-node-id="${CSS.escape(id)}"] > .row .check`));
}

export function toggleTodo(todo: Todo) {
  const ui = useUi.getState();
  if (ui.completing[todo.id]) return;
  if (todo.done) {
    useData.getState().uncomplete(todo.id);
    return;
  }

  ui.set({ completing: { ...ui.completing, [todo.id]: true } });
  const at = rowAnchor(todo.id);
  if (at) burst(at.x, at.y, accentOf(todo.list));
  if (useData.getState().prefs.sound) chime();

  setTimeout(() => {
    const from = rowAnchor(todo.id);
    const movedTo = useData.getState().complete(todo.id);
    const rest = { ...useUi.getState().completing };
    delete rest[todo.id];
    useUi.getState().set({ completing: rest });
    if (movedTo && from) {
      const to = tabTarget(movedTo);
      if (to) flyTo(from, to, accentOf(todo.list), () => pulseTab(movedTo));
    }
  }, CELEBRATE_MS);
}

export function moveTodoTo(todo: Todo, list: ListId, fromEl?: Element | null) {
  const from = centerOf(fromEl) ?? rowAnchor(todo.id);
  useData.getState().move(todo.id, list);
  if (list === todo.list) return; // 只是提升为顶层，不用飞
  const to = tabTarget(list);
  if (from && to) flyTo(from, to, accentOf(list), () => pulseTab(list));
  else pulseTab(list);
}

/** 做完但还要测：小小庆祝一下，然后飞进 VERIFY */
export function markForTest(todo: Todo, fromEl?: Element | null) {
  const at = centerOf(fromEl) ?? rowAnchor(todo.id);
  if (at) burst(at.x, at.y, accentOf('verify'));
  moveTodoTo(todo, 'verify', fromEl);
}

export function deleteWithUndo(todo: Todo) {
  const before = useData.getState().remove(todo.id);
  const after = new Set(useData.getState().todos.map((t) => t.id));
  const removed = before.filter((t) => !after.has(t.id));
  const extra = removed.length > 1 ? `（含 ${removed.length - 1} 个子项）` : '';
  showToast(`已删除「${truncate(todo.title, 14)}」${extra}`, removed);
}

export function undoDelete() {
  const { toast } = useUi.getState();
  if (!toast?.undo) return;
  const cur = useData.getState().todos;
  useData.getState().restore(sanitize([...cur, ...toast.undo]));
  useUi.getState().set({ toast: null });
}

export function startAddChild(todo: Todo) {
  if (todo.collapsed) useData.getState().setCollapsed(todo.id, false);
  useUi.getState().set({ addingChildOf: todo.id, editingId: null, menu: null });
}

export function describeMove(list: ListId) {
  return list === 'verify' ? '标为待测' : `移到 ${listLabel(list)}`;
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
