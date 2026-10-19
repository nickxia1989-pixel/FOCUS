// 大纲式编辑的数据规则：编辑时回车开空行、Tab / Shift+Tab 调层级、⌥⇧↑↓ 同级移动、空行上退格。
// 纯函数，不碰界面；桌面的接线在 src/editing.ts。真正改数据的仍是 model 的 createTodo / indentTodo /
// outdentTodo / reorderTodo，这里只算「空行在哪、新建时用什么 parentId 和 placement」。
import { compareTodos, isFocusRoot, type Placement } from './model';
import type { ListId, Todo } from './types';

/**
 * 空行：还没真正新建的一条。挂在 parentId 下（顶层为 null），排在 afterId 后面；
 * afterId 为 null 表示排在这一层的最前面。
 */
export interface Draft {
  list: ListId;
  parentId: string | null;
  afterId: string | null;
}

/** 某一层的兄弟（已排序，未完成在前） */
export function levelOf(todos: Todo[], list: ListId, parentId: string | null): Todo[] {
  return todos.filter((t) => t.parentId === parentId && (parentId !== null || t.list === list)).sort(compareTodos);
}

const openLevel = (todos: Todo[], list: ListId, parentId: string | null) => levelOf(todos, list, parentId).filter((t) => !t.done);

/** 这一层最后一个未完成的；没有就是 null（空行排在最前，也就是所有已完成的前面） */
function lastOpen(todos: Todo[], list: ListId, parentId: string | null): string | null {
  const open = openLevel(todos, list, parentId);
  return open.length ? open[open.length - 1].id : null;
}

/**
 * 编辑某一条时按回车：保存，并在它后面开一个同层级的空行。
 * 已完成的条目后面不能插（新建的总在未完成里），空行排在这一层未完成的最后。
 */
export function draftAfter(todos: Todo[], id: string): Draft | null {
  const t = todos.find((x) => x.id === id);
  if (!t) return null;
  return { list: t.list, parentId: t.parentId, afterId: t.done ? lastOpen(todos, t.list, t.parentId) : t.id };
}

/** 「添加子任务」：在 parent 的子项最后开一个空行 */
export function draftChildOf(todos: Todo[], parentId: string): Draft | null {
  const p = todos.find((x) => x.id === parentId);
  if (!p) return null;
  return { list: p.list, parentId: p.id, afterId: lastOpen(todos, p.list, p.id) };
}

/**
 * 空行上按 Tab：它将成为上一条（afterId）的最后一个子项。
 * 这一层最前面的空行（没有上一条）不能缩进，返回 null。
 */
export function draftIndent(todos: Todo[], d: Draft): Draft | null {
  if (!d.afterId) return null;
  const prev = todos.find((t) => t.id === d.afterId);
  if (!prev) return null;
  return { list: prev.list, parentId: prev.id, afterId: lastOpen(todos, prev.list, prev.id) };
}

/** 空行上按 Shift+Tab：升一级，排在原父项后面。顶层空行返回 null */
export function draftOutdent(todos: Todo[], d: Draft): Draft | null {
  if (d.parentId === null) return null;
  const parent = todos.find((t) => t.id === d.parentId);
  if (!parent) return null;
  return {
    list: parent.list,
    parentId: parent.parentId,
    afterId: parent.done ? lastOpen(todos, parent.list, parent.parentId) : parent.id,
  };
}

/** 空行上按 ⌥⇧↑ / ⌥⇧↓：在同级未完成的项之间挪一格；挪不动返回 null */
export function draftShift(todos: Todo[], d: Draft, dir: -1 | 1): Draft | null {
  const ids = openLevel(todos, d.list, d.parentId).map((t) => t.id);
  // 空行现在的位置：排在 afterId 后面 = 下标 pos（0 = 最前）
  const pos = d.afterId === null ? 0 : ids.indexOf(d.afterId) + 1;
  if (pos === 0 && d.afterId !== null) return null; // afterId 已经不在这一层了
  const next = pos + dir;
  if (next < 0 || next > ids.length) return null;
  return { ...d, afterId: next === 0 ? null : ids[next - 1] };
}

/** 空行有内容回车时，用什么参数新建（store.add(title, list, parentId, placement)） */
export function draftInsert(d: Draft): { list: ListId; parentId: string | null; placement: Placement } {
  return { list: d.list, parentId: d.parentId, placement: d.afterId ? { after: d.afterId } : 'top' };
}

/** 空行上按退格：关掉空行，回到上一条（排在它前面的那条，没有就是父项）继续编辑 */
export function draftBackTarget(d: Draft): string | null {
  return d.afterId ?? d.parentId;
}

/**
 * ⌥⇧↑ / ⌥⇧↓：在同级、同完成状态里上移 / 下移一格。
 * 返回给 reorderTodo 的 toIndex（拿掉自己之后的插入位置）；已经在头 / 尾返回 null。
 */
export function moveIndex(todos: Todo[], id: string, dir: -1 | 1): number | null {
  const t = todos.find((x) => x.id === id);
  if (!t) return null;
  const group = levelOf(todos, t.list, t.parentId).filter((x) => x.done === t.done);
  const i = group.findIndex((x) => x.id === id);
  const to = i + dir;
  if (i < 0 || to < 0 || to >= group.length) return null;
  return to;
}

/**
 * ⌥⇧↑ / ⌥⇧↓ 的落点（给 reorderTodo 的 toIndex 和进不进聚焦区）。
 * FOCUS 顶层把聚焦区和「接下来」的分界也当一格：「接下来」第一件上移先进聚焦区末尾，
 * 聚焦区最后一件下移先出到「接下来」第一位。其它情况同 moveIndex；到头返回 null。
 */
export function moveStep(todos: Todo[], id: string, dir: -1 | 1): { to: number; focused?: boolean } | null {
  const t = todos.find((x) => x.id === id);
  if (!t) return null;
  if (isFocusRoot(t) && !t.done) {
    const group = levelOf(todos, t.list, null).filter((x) => !x.done);
    const zoneLen = group.filter((x) => x.focused).length;
    const i = group.findIndex((x) => x.id === id);
    if (t.focused && dir === 1 && i === zoneLen - 1) return { to: i, focused: false };
    if (!t.focused && dir === -1 && i === zoneLen) return { to: zoneLen, focused: true };
  }
  const to = moveIndex(todos, id, dir);
  return to === null ? null : { to };
}

/** Tab 能不能缩进：同级第一个不行 */
export function canIndent(todos: Todo[], id: string): boolean {
  const t = todos.find((x) => x.id === id);
  if (!t) return false;
  return levelOf(todos, t.list, t.parentId).findIndex((x) => x.id === id) > 0;
}

/** Shift+Tab 能不能反缩进：顶层不行 */
export function canOutdent(todos: Todo[], id: string): boolean {
  const t = todos.find((x) => x.id === id);
  return !!t && t.parentId !== null;
}

/** 列表渲染时把空行插进某一层：afterId 不在这一层（例如 FOCUS 顶层的 NOW 在卡片里）时放在最前 */
export function withDraft<T extends { id: string }>(items: T[], draft: Draft | null, list: ListId, parentId: string | null): (T | 'draft')[] {
  if (!draft || draft.parentId !== parentId || (parentId === null && draft.list !== list)) return items;
  const at = draft.afterId === null ? 0 : items.findIndex((t) => t.id === draft.afterId) + 1;
  const out: (T | 'draft')[] = [...items];
  out.splice(at, 0, 'draft');
  return out;
}
