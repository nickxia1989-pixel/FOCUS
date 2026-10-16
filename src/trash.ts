// 回收站：删除的条目（连同子孙）整组保存，可原样恢复。纯函数，便于测试。
import { deleteTodo, descendantIds, sanitize } from './model';
import { LIST_IDS, type ListId, type Todo, type TrashEntry } from './types';

/** 回收站里的条目保留天数，过期自动清除 */
export const TRASH_KEEP_DAYS = 30;

/** 删除一棵子树，返回删除后的列表和对应的回收站条目 */
export function trashSubtree(
  todos: Todo[],
  id: string,
  now: number,
  entryId: string,
): { todos: Todo[]; entry: TrashEntry | null } {
  const root = todos.find((t) => t.id === id);
  if (!root) return { todos, entry: null };
  const subtree = descendantIds(todos, id);
  const items = todos.filter((t) => t.id === id || subtree.has(t.id));
  const entry: TrashEntry = {
    id: entryId,
    deletedAt: now,
    rootId: id,
    parentId: root.parentId,
    list: root.list,
    items,
  };
  return { todos: deleteTodo(todos, id), entry };
}

/**
 * 从回收站恢复：原父项还在就挂回原父项（跟随父项当前所在的列表），
 * 否则作为顶层项回到原来的列表。
 */
export function restoreEntry(todos: Todo[], entry: TrashEntry): Todo[] {
  const existing = new Set(todos.map((t) => t.id));
  const parent = entry.parentId ? todos.find((t) => t.id === entry.parentId) : undefined;
  const list = parent ? parent.list : entry.list;
  const restored = entry.items
    .filter((t) => !existing.has(t.id))
    .map((t) => ({ ...t, list, ...(t.id === entry.rootId ? { parentId: parent ? parent.id : null } : {}) }));
  return sanitize([...todos, ...restored]);
}

/** 去掉过期的回收站条目 */
export function purgeTrash(trash: TrashEntry[], now: number, days = TRASH_KEEP_DAYS): TrashEntry[] {
  const limit = now - days * 24 * 60 * 60 * 1000;
  const kept = trash.filter((e) => e.deletedAt >= limit);
  return kept.length === trash.length ? trash : kept;
}

/** 读入外部数据时清洗回收站 */
export function sanitizeTrash(raw: unknown): TrashEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: TrashEntry[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const e = r as Partial<TrashEntry>;
    if (typeof e.id !== 'string' || typeof e.rootId !== 'string' || typeof e.deletedAt !== 'number') continue;
    const items = sanitize(e.items);
    if (!items.some((t) => t.id === e.rootId)) continue;
    out.push({
      id: e.id,
      deletedAt: e.deletedAt,
      rootId: e.rootId,
      parentId: typeof e.parentId === 'string' ? e.parentId : null,
      list: LIST_IDS.includes(e.list as ListId) ? (e.list as ListId) : 'inbox',
      items,
    });
  }
  return out;
}
