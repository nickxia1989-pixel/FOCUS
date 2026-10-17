// 纯数据操作：全部返回新数组，不修改入参，方便测试与撤销
import { COMPLETE_TO_INBOX, LIST_IDS, type ListId, type Todo } from './types';

/** 未完成在前；同状态按 order 降序（默认即创建时间新的在前） */
export function compareTodos(a: Todo, b: Todo): number {
  return (
    Number(a.done) - Number(b.done) ||
    b.order - a.order ||
    b.createdAt - a.createdAt ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

const rootKey = (list: ListId) => `root:${list}`;

/** 父 id（或列表根）→ 已排好序的子项 */
export type TreeIndex = Map<string, Todo[]>;

export function buildIndex(todos: Todo[]): TreeIndex {
  const index: TreeIndex = new Map();
  for (const t of todos) {
    const key = t.parentId ?? rootKey(t.list);
    const arr = index.get(key);
    if (arr) arr.push(t);
    else index.set(key, [t]);
  }
  for (const arr of index.values()) arr.sort(compareTodos);
  return index;
}

export function rootsOf(index: TreeIndex, list: ListId): Todo[] {
  return index.get(rootKey(list)) ?? [];
}

export function childrenOf(index: TreeIndex, id: string): Todo[] {
  return index.get(id) ?? [];
}

/** 与 todo 处于同一层级（同父、同列表）的兄弟，含自身，已排序 */
export function siblingsOf(todos: Todo[], todo: Todo): Todo[] {
  return todos
    .filter((t) => t.parentId === todo.parentId && (todo.parentId !== null || t.list === todo.list))
    .sort(compareTodos);
}

export function descendantIds(todos: Todo[], id: string): Set<string> {
  const byParent = new Map<string, string[]>();
  for (const t of todos) {
    if (!t.parentId) continue;
    const arr = byParent.get(t.parentId);
    if (arr) arr.push(t.id);
    else byParent.set(t.parentId, [t.id]);
  }
  const out = new Set<string>();
  const stack = [...(byParent.get(id) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    stack.push(...(byParent.get(cur) ?? []));
  }
  return out;
}

export function createTodo(
  todos: Todo[],
  input: { id: string; title: string; list: ListId; parentId?: string | null; now: number },
): Todo[] {
  const parent = input.parentId ? todos.find((t) => t.id === input.parentId) : undefined;
  const list = parent ? parent.list : input.list;
  // order 至少比同层现有项都大，保证新建项排在最前
  const siblings = todos.filter((t) => t.parentId === (parent?.id ?? null) && (parent || t.list === list));
  const maxOrder = siblings.reduce((m, t) => Math.max(m, t.order), -Infinity);
  const todo: Todo = {
    id: input.id,
    title: input.title.trim(),
    done: false,
    list,
    parentId: parent?.id ?? null,
    createdAt: input.now,
    completedAt: null,
    order: Math.max(input.now, maxOrder + 1),
  };
  let next = [...todos, todo];
  // 给折叠着的父项加子项时自动展开，免得新项"消失"
  if (parent?.collapsed) next = next.map((t) => (t.id === parent.id ? { ...t, collapsed: false } : t));
  return next;
}

export interface CompleteResult {
  todos: Todo[];
  /** FOCUS / VERIFY 的顶层项完成后会被移到 INBOX */
  movedTo: ListId | null;
}

/**
 * 标记完成：子孙一并完成，待测标记随之清除。
 * 只有 FOCUS / VERIFY 的顶层项完成后会整棵移到 INBOX；子项完成永远留在原处。
 */
export function completeTodo(todos: Todo[], id: string, now: number): CompleteResult {
  const target = todos.find((t) => t.id === id);
  if (!target || target.done) return { todos, movedTo: null };
  const subtree = descendantIds(todos, id);
  const moveToInbox = COMPLETE_TO_INBOX.has(target.list) && target.parentId === null;
  const next = todos.map((t) => {
    if (t.id !== id && !subtree.has(t.id)) return t;
    const done = t.done ? t : { ...t, done: true, completedAt: now, completedFrom: t.list, testing: false };
    return moveToInbox ? { ...done, list: 'inbox' as ListId } : done;
  });
  return { todos: next, movedTo: moveToInbox ? 'inbox' : null };
}

/**
 * 标为待测：
 * - 顶层项：整棵移进 VERIFY（见 moveTodo）
 * - 子项：留在父项下、不换页签，只打上待测标记
 * 两种情况下该项本身都回到未完成，测完再勾。
 */
export function markForTest(todos: Todo[], id: string): Todo[] {
  const target = todos.find((t) => t.id === id);
  if (!target) return todos;
  if (target.parentId === null) return moveTodo(todos, id, 'verify');
  return todos.map((t) => (t.id === id ? { ...t, testing: true, done: false, completedAt: null, completedFrom: undefined } : t));
}

export function unmarkTest(todos: Todo[], id: string): Todo[] {
  return todos.map((t) => (t.id === id && t.testing ? { ...t, testing: false } : t));
}

/** 取消完成：只影响自身 */
export function uncompleteTodo(todos: Todo[], id: string): Todo[] {
  return todos.map((t) => (t.id === id && t.done ? { ...t, done: false, completedAt: null, completedFrom: undefined } : t));
}

/**
 * 移到另一个列表：子孙跟着走；子项会脱离原父项，成为目标列表的顶层项。
 * 移进 VERIFY 的顶层项本身就是待测：回到未完成，原地待测标记不再需要。
 */
export function moveTodo(todos: Todo[], id: string, list: ListId): Todo[] {
  const target = todos.find((t) => t.id === id);
  if (!target) return todos;
  if (target.list === list && target.parentId === null) return todos;
  const subtree = descendantIds(todos, id);
  const intoVerify = list === 'verify';
  return todos.map((t) => {
    if (t.id === id) {
      const moved = { ...t, list, parentId: null };
      return intoVerify ? { ...moved, done: false, completedAt: null, completedFrom: undefined, testing: false } : moved;
    }
    if (subtree.has(t.id)) return { ...t, list };
    return t;
  });
}

/**
 * 改挂到另一个父项下（AI agent 用，界面上没有这个操作）：子孙跟着走，列表跟随新父项，排在新兄弟的最前面。
 * 挂到自己、自己的子孙下，或本来就在这个父项下时原样返回。
 */
export function reparentTodo(todos: Todo[], id: string, parentId: string): Todo[] {
  const target = todos.find((t) => t.id === id);
  const parent = todos.find((t) => t.id === parentId);
  if (!target || !parent || id === parentId || target.parentId === parentId) return todos;
  const subtree = descendantIds(todos, id);
  if (subtree.has(parentId)) return todos;
  const maxOrder = todos.reduce((m, t) => (t.parentId === parentId ? Math.max(m, t.order) : m), -Infinity);
  const order = Math.max(target.order, maxOrder + 1);
  return todos.map((t) => {
    if (t.id === id) return { ...t, parentId, list: parent.list, order };
    if (subtree.has(t.id)) return { ...t, list: parent.list };
    // 挂到折叠着的父项下时自动展开，免得它"消失"
    if (t.id === parentId && t.collapsed) return { ...t, collapsed: false };
    return t;
  });
}

/**
 * 同层、同完成状态内的手动排序。
 * toIndex 是把该项从组里拿掉之后的插入位置。
 * 只改被拖的那一项：取新位置上下两个邻居 order 的中点（多端同步时，两台设备拖不同的项互不影响）。
 * 邻居的 order 相同、插不进去时，才给整组重新分配。
 */
export function reorderTodo(todos: Todo[], id: string, toIndex: number): Todo[] {
  const target = todos.find((t) => t.id === id);
  if (!target) return todos;
  const group = siblingsOf(todos, target).filter((t) => t.done === target.done);
  const from = group.findIndex((t) => t.id === id);
  const rest = group.filter((t) => t.id !== id);
  const to = Math.max(0, Math.min(toIndex, rest.length));
  if (to === from) return todos;
  const above = rest[to - 1];
  const below = rest[to];
  let order: number | null;
  if (!above && !below) order = null;
  else if (!above) order = below.order + 1;
  else if (!below) order = above.order - 1;
  else order = above.order - below.order > 1e-6 ? (above.order + below.order) / 2 : null;
  if (order !== null) return todos.map((t) => (t.id === id ? { ...t, order } : t));
  // 插不进去：按新顺序给整组重新编号（保持在原来的最大值附近，新建项仍排在最前）
  const arranged = [...rest.slice(0, to), target, ...rest.slice(to)];
  const top = Math.max(...group.map((t) => t.order));
  const newOrder = new Map(arranged.map((t, i) => [t.id, top - i]));
  return todos.map((t) => (newOrder.has(t.id) && newOrder.get(t.id) !== t.order ? { ...t, order: newOrder.get(t.id)! } : t));
}

export function deleteTodo(todos: Todo[], id: string): Todo[] {
  const subtree = descendantIds(todos, id);
  return todos.filter((t) => t.id !== id && !subtree.has(t.id));
}

export function renameTodo(todos: Todo[], id: string, title: string): Todo[] {
  const clean = title.trim();
  if (!clean) return todos;
  return todos.map((t) => (t.id === id && t.title !== clean ? { ...t, title: clean } : t));
}

export function setCollapsed(todos: Todo[], id: string, collapsed: boolean): Todo[] {
  return todos.map((t) => (t.id === id ? { ...t, collapsed } : t));
}

export function openCount(todos: Todo[], list: ListId): number {
  let n = 0;
  for (const t of todos) if (t.list === list && !t.done) n++;
  return n;
}

export function completedSince(todos: Todo[], since: number): number {
  let n = 0;
  for (const t of todos) if (t.done && t.completedAt !== null && t.completedAt >= since) n++;
  return n;
}

export function startOfToday(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 读入外部数据时做一次清洗，丢掉孤儿、修正父子不同列表 */
export function sanitize(raw: unknown): Todo[] {
  if (!Array.isArray(raw)) return [];
  const valid = new Set<ListId>(LIST_IDS);
  const todos: Todo[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const t = r as Partial<Todo>;
    if (typeof t.id !== 'string' || typeof t.title !== 'string') continue;
    const createdAt = typeof t.createdAt === 'number' ? t.createdAt : Date.now();
    todos.push({
      id: t.id,
      title: t.title,
      done: !!t.done,
      list: valid.has(t.list as ListId) ? (t.list as ListId) : 'inbox',
      parentId: typeof t.parentId === 'string' ? t.parentId : null,
      createdAt,
      completedAt: typeof t.completedAt === 'number' ? t.completedAt : null,
      completedFrom: t.done && valid.has(t.completedFrom as ListId) ? (t.completedFrom as ListId) : undefined,
      order: typeof t.order === 'number' ? t.order : createdAt,
      collapsed: !!t.collapsed,
      testing: !!t.testing && !t.done,
    });
  }
  const byId = new Map(todos.map((t) => [t.id, t]));
  // 父项不存在或成环的，提升为顶层
  for (const t of todos) {
    const seen = new Set<string>([t.id]);
    let p = t.parentId ? byId.get(t.parentId) : undefined;
    while (p) {
      if (seen.has(p.id)) break;
      seen.add(p.id);
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
    if (t.parentId && (!byId.has(t.parentId) || (p && seen.has(p.id)))) t.parentId = null;
  }
  // 子项跟随根的列表
  const rootList = (t: Todo): ListId => {
    let cur = t;
    while (cur.parentId) cur = byId.get(cur.parentId)!;
    return cur.list;
  };
  for (const t of todos) t.list = rootList(t);
  return todos;
}
