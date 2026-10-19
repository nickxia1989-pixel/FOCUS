// 纯数据操作：全部返回新数组，不修改入参，方便测试与撤销
import { COMPLETE_TO_INBOX, LIST_IDS, type ListId, type Todo } from './types';

/**
 * order 的方向：顶层项按 order 降序（新建的在前，像收件箱）；子项按 order 升序（按创建顺序，新建的在后，
 * 子任务常常要按顺序一步步做）。返回 1 = 降序、-1 = 升序；同一组兄弟的方向一致。
 */
export const orderDir = (t: Pick<Todo, 'parentId'>): 1 | -1 => (t.parentId === null ? 1 : -1);

/** FOCUS 的顶层项：聚焦区和「接下来」都在这一层 */
export const isFocusRoot = (t: Pick<Todo, 'list' | 'parentId'>) => t.list === 'focus' && t.parentId === null;

/** 在聚焦区里：FOCUS 里打了聚焦标记的未完成顶层项 */
export const inZone = (t: Todo) => !!t.focused && !t.done && isFocusRoot(t);

/** 未完成在前；FOCUS 顶层的聚焦区排在「接下来」前面；同组按 order 排（方向见 orderDir） */
export function compareTodos(a: Todo, b: Todo): number {
  const dir = orderDir(a);
  return (
    Number(a.done) - Number(b.done) ||
    Number(inZone(b)) - Number(inZone(a)) ||
    dir * (b.order - a.order) ||
    dir * (b.createdAt - a.createdAt) ||
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

/** FOCUS 里未完成的顶层项：聚焦区在前，「接下来」在后 */
const openFocusRoots = (todos: Todo[]) => todos.filter((t) => isFocusRoot(t) && !t.done).sort(compareTodos);

/** 聚焦区：同时盯着的几件事，按手动顺序 */
export function zoneOf(todos: Todo[]): Todo[] {
  return openFocusRoots(todos).filter((t) => t.focused);
}

/** 「接下来」：FOCUS 里没在聚焦区的未完成顶层项 */
export function queueOf(todos: Todo[]): Todo[] {
  return openFocusRoots(todos).filter((t) => !t.focused);
}

/** 去掉聚焦标记（移出 FOCUS 顶层时） */
function dropFocus(t: Todo): Todo {
  if (!t.focused) return t;
  const n = { ...t };
  delete n.focused;
  return n;
}

/**
 * 新建时排在哪。不传时顶层项排最前、子项排最后（见 orderDir）。
 * - 'top'：排在同级最前；FOCUS 顶层 = 放进聚焦区最前（新建并设为现在）
 * - 'afterNow'：FOCUS 顶层排在聚焦区后面（「接下来」的第一位）；FOCUS 里还没有未完成的事时直接进聚焦区
 * - { after }：紧跟在某个未完成的同级后面（编辑时回车新建下一条）；FOCUS 顶层跟着那一条在不在聚焦区
 */
export type Placement = 'top' | 'afterNow' | { after: string };

/** 排到聚焦区后面（「接下来」的第一位）；FOCUS 里只有它一件未完成的事时直接进聚焦区 */
function afterZone(todos: Todo[], id: string): Todo[] {
  const others = openFocusRoots(todos).filter((t) => t.id !== id);
  if (!others.length) return reorderTodo(todos, id, 0, true);
  return reorderTodo(todos, id, others.filter((t) => t.focused).length, false);
}

export function createTodo(
  todos: Todo[],
  input: { id: string; title: string; list: ListId; parentId?: string | null; now: number; placement?: Placement },
): Todo[] {
  const parent = input.parentId ? todos.find((t) => t.id === input.parentId) : undefined;
  const list = parent ? parent.list : input.list;
  // order 至少比同层现有项都大：顶层项因此排在最前，子项排在最后
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
  const placement = input.placement;
  const focusRoot = !parent && list === 'focus';
  if (focusRoot && placement === 'top') next = reorderTodo(next, todo.id, 0, true);
  else if (focusRoot && placement === 'afterNow') next = afterZone(next, todo.id);
  else if (placement === 'afterNow' && !parent) next = reorderTodo(next, todo.id, 1);
  else if (placement === 'top' && parent) next = reorderTodo(next, todo.id, 0);
  else if (typeof placement === 'object') {
    const sibs = siblingsOf(next, todo).filter((t) => !t.done && t.id !== todo.id);
    const at = sibs.findIndex((t) => t.id === placement.after);
    if (at >= 0) next = reorderTodo(next, todo.id, at + 1, focusRoot ? !!sibs[at].focused : undefined);
  }
  return next;
}

/**
 * 送进 FOCUS：整棵移到 FOCUS 顶层，排在聚焦区后面（「接下来」的第一位），不打乱正在盯着的事。
 * FOCUS 里原本没有未完成的事时直接进聚焦区。已经是 FOCUS 顶层项时原样返回。
 */
export function sendToFocus(todos: Todo[], id: string): Todo[] {
  const target = todos.find((t) => t.id === id);
  if (!target || isFocusRoot(target)) return todos;
  return moveTodo(todos, id, 'focus');
}

/**
 * 设为现在：放进聚焦区最前面。
 * 从别的列表或父项下来的先整棵移进 FOCUS；已完成的先恢复为未完成。
 */
export function setNow(todos: Todo[], id: string): Todo[] {
  const target = todos.find((t) => t.id === id);
  if (!target) return todos;
  let next = target.done ? uncompleteTodo(todos, id) : todos;
  next = moveTodo(next, id, 'focus');
  return reorderTodo(next, id, 0, true);
}

/**
 * 放进聚焦区，排在聚焦区里第 index 位（不给就排最后）。
 * 从别的列表或父项下来的先整棵移进 FOCUS；已完成的先恢复为未完成。
 */
export function focusTodo(todos: Todo[], id: string, index?: number): Todo[] {
  const target = todos.find((t) => t.id === id);
  if (!target) return todos;
  let next = target.done ? uncompleteTodo(todos, id) : todos;
  next = moveTodo(next, id, 'focus');
  const zoneLen = zoneOf(next).filter((t) => t.id !== id).length;
  return reorderTodo(next, id, Math.max(0, Math.min(index ?? zoneLen, zoneLen)), true);
}

/** 移出聚焦区：回到「接下来」的第 index 位（默认第一位）。不在聚焦区的原样返回 */
export function unfocusTodo(todos: Todo[], id: string, index = 0): Todo[] {
  const target = todos.find((t) => t.id === id);
  if (!target || !inZone(target)) return todos;
  const zoneLen = zoneOf(todos).filter((t) => t.id !== id).length;
  return reorderTodo(todos, id, zoneLen + Math.max(0, index), false);
}

/** 聚焦区里排第一的那件（「现在」）；聚焦区空着时为 null */
export function nowOf(todos: Todo[]): Todo | null {
  return zoneOf(todos)[0] ?? null;
}

/**
 * 升级到聚焦区：FOCUS 里有未完成的事、却一件都没在聚焦区时，把原来的 NOW（手动顺序排第一的那件）放进去。
 * 只在本机第一次用上聚焦区时跑一次（之后聚焦区空着是旅行者自己清空的）。
 */
export function migrateZone(todos: Todo[]): Todo[] {
  const open = openFocusRoots(todos);
  if (!open.length || open.some((t) => t.focused)) return todos;
  return todos.map((t) => (t.id === open[0].id ? { ...t, focused: true } : t));
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
    return moveToInbox ? dropFocus({ ...done, list: 'inbox' as ListId }) : done;
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
 * 移出 FOCUS 顶层就离开聚焦区；移进 FOCUS 的未完成项排在聚焦区后面（FOCUS 原本是空的就直接进聚焦区）。
 */
export function moveTodo(todos: Todo[], id: string, list: ListId): Todo[] {
  const target = todos.find((t) => t.id === id);
  if (!target) return todos;
  if (target.list === list && target.parentId === null) return todos;
  const subtree = descendantIds(todos, id);
  const intoVerify = list === 'verify';
  const next = todos.map((t) => {
    if (t.id === id) {
      const moved = dropFocus({ ...t, list, parentId: null });
      return intoVerify ? { ...moved, done: false, completedAt: null, completedFrom: undefined, testing: false } : moved;
    }
    if (subtree.has(t.id)) return { ...t, list };
    return t;
  });
  return list === 'focus' && !target.done ? afterZone(next, id) : next;
}

/**
 * 改挂到另一个父项下：子孙跟着走，列表跟随新父项，排在新兄弟的最后面。
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
    if (t.id === id) return dropFocus({ ...t, parentId, list: parent.list, order });
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
 *
 * FOCUS 的未完成顶层项是「聚焦区 + 接下来」一组，聚焦区排在前面：
 * - focused 指定进不进聚焦区，位置夹在那一段里；
 * - 不指定时按落点推断：落在聚焦区那一段就进，落在后面就出，正好在分界上保持原样（手机端拖动、agent 排序走这里）。
 * 聚焦区的 order 总比「接下来」的大，没升级的旧版本会把聚焦区第一件当 NOW；
 * 多端并发把这个顺序弄乱时，这次排序顺手给整组重新编号。
 */
export function reorderTodo(todos: Todo[], id: string, toIndex: number, focused?: boolean): Todo[] {
  const target = todos.find((t) => t.id === id);
  if (!target) return todos;
  const dir = orderDir(target);
  const group = siblingsOf(todos, target).filter((t) => t.done === target.done);
  const from = group.findIndex((t) => t.id === id);
  const rest = group.filter((t) => t.id !== id);
  let to = Math.max(0, Math.min(toIndex, rest.length));
  const zoned = isFocusRoot(target) && !target.done;
  const was = zoned && !!target.focused;
  let want = was;
  let broken = false;
  let selfBad = false;
  if (zoned) {
    const zone = rest.filter((t) => t.focused);
    const queue = rest.filter((t) => !t.focused);
    want = focused ?? (to < zone.length ? true : to > zone.length ? false : was);
    to = want ? Math.min(to, zone.length) : Math.max(to, zone.length);
    const zoneMin = Math.min(...zone.map((t) => t.order));
    const queueMax = Math.max(...queue.map((t) => t.order));
    broken = zone.length > 0 && queue.length > 0 && zoneMin <= queueMax;
    // 只有它自己的 order 和所在那一段对不上（例如刚从别的列表移进来）：只挪它
    selfBad = want ? target.order <= queueMax : target.order >= zoneMin;
  }
  if (to === from && want === was && !broken && !selfBad) return todos;
  const patch = (t: Todo, order: number): Todo => {
    if (!zoned) return { ...t, order };
    const n = { ...t, order, focused: true };
    if (!want) delete (n as Partial<Todo>).focused;
    return n;
  };
  const above = rest[to - 1];
  const below = rest[to];
  // 原来的 order 已经落在新邻居之间（只是进 / 出聚焦区）：不改 order
  const fits = (!above || dir * (above.order - target.order) > 0) && (!below || dir * (target.order - below.order) > 0);
  let order: number | null;
  if (broken) order = null;
  else if (fits) order = target.order;
  else if (!above && !below) order = null;
  else if (!above) order = below.order + dir;
  else if (!below) order = above.order - dir;
  else order = Math.abs(above.order - below.order) > 1e-6 ? (above.order + below.order) / 2 : null;
  if (order !== null) return todos.map((t) => (t.id === id ? patch(t, order) : t));
  // 插不进去：按新顺序给整组重新编号（保持在原来的端点附近，新建项的位置规则不变）
  const arranged = [...rest.slice(0, to), target, ...rest.slice(to)];
  const top = dir === 1 ? Math.max(...group.map((t) => t.order)) : Math.min(...group.map((t) => t.order));
  const newOrder = new Map(arranged.map((t, i) => [t.id, top - dir * i]));
  return todos.map((t) => {
    if (t.id === id) return patch(t, newOrder.get(t.id)!);
    return newOrder.has(t.id) && newOrder.get(t.id) !== t.order ? { ...t, order: newOrder.get(t.id)! } : t;
  });
}

/**
 * 缩进（编辑时按 Tab）：挂到界面上紧挨着的上一个同级下面，成为它的最后一个子项，子孙跟着走。
 * 已经是同级第一个时原样返回。
 * VERIFY 的顶层项本身就是待测，缩进成子项后打上待测标记，免得「待验证」状态丢掉。
 */
export function indentTodo(todos: Todo[], id: string): Todo[] {
  const target = todos.find((t) => t.id === id);
  if (!target) return todos;
  const sibs = siblingsOf(todos, target);
  const i = sibs.findIndex((t) => t.id === id);
  if (i <= 0) return todos;
  const next = reparentTodo(todos, id, sibs[i - 1].id);
  if (target.parentId === null && target.list === 'verify' && !target.done)
    return next.map((t) => (t.id === id ? { ...t, testing: true } : t));
  return next;
}

/**
 * 反缩进（编辑时按 Shift+Tab）：升一级，排在原父项的紧后面；它后面的兄弟仍留在原父项下。
 * 顶层项原样返回。升成 VERIFY 的顶层项时去掉待测标记（VERIFY 的顶层项本身就是待测）。
 */
export function outdentTodo(todos: Todo[], id: string): Todo[] {
  const target = todos.find((t) => t.id === id);
  if (!target || target.parentId === null) return todos;
  const parent = todos.find((t) => t.id === target.parentId);
  if (!parent) return todos;
  let next: Todo[];
  if (parent.parentId !== null) next = reparentTodo(todos, id, parent.parentId);
  else {
    // 升成顶层：列表不变（子项本来就跟着根项的列表），order 先放在原父项旁边，再精确排到它后面
    next = todos.map((t) =>
      t.id === id ? { ...t, parentId: null, order: parent.order, testing: t.list === 'verify' ? false : t.testing } : t,
    );
  }
  const moved = next.find((t) => t.id === id)!;
  if (moved.done !== parent.done) return next;
  const at = siblingsOf(next, moved)
    .filter((t) => t.done === moved.done && t.id !== id)
    .findIndex((t) => t.id === parent.id);
  // FOCUS 里升成顶层：原父项在聚焦区，它也留在聚焦区
  return at >= 0 ? reorderTodo(next, id, at + 1, isFocusRoot(moved) ? inZone(parent) : undefined) : next;
}

/**
 * 自由拖拽的落点：挂到 parentId 下（顶层为 null），排在同级、同完成状态的第 index 位。
 * FOCUS 顶层的 index 按「聚焦区 + 接下来」连起来数；focused 指定进不进聚焦区，不给就按落点推断（见 reorderTodo）。
 */
export interface PlaceTarget {
  list: ListId;
  parentId: string | null;
  index: number;
  focused?: boolean;
}

/**
 * 放到任意位置（自由拖拽）：子孙跟着走；index 超出范围就排到最后。
 * 挂到自己或自己的子孙下面、父项不存在时原样返回。放进折叠着的父项时自动展开。
 * VERIFY 的顶层项本身就是待测：
 * - VERIFY 里的顶层项放成子项时打上待测标记，「待验证」不丢；
 * - 放成 VERIFY 顶层时去掉待测标记；从别的列表放进来的，和「送去验证」一样回到未完成。
 */
export function placeTodo(todos: Todo[], id: string, target: PlaceTarget): Todo[] {
  const t = todos.find((x) => x.id === id);
  if (!t) return todos;
  const subtree = descendantIds(todos, id);
  const parent = target.parentId ? todos.find((x) => x.id === target.parentId) : undefined;
  if (target.parentId && (!parent || parent.id === id || subtree.has(parent.id))) return todos;
  const parentId = parent?.id ?? null;
  const list = parent ? parent.list : target.list;
  let next = todos;
  if (t.parentId !== parentId || t.list !== list) {
    let patch: Partial<Todo> = { parentId, list };
    if (!parent && list === 'verify') {
      patch.testing = false;
      if (t.list !== 'verify') patch = { ...patch, done: false, completedAt: null, completedFrom: undefined };
    } else if (parent && t.parentId === null && t.list === 'verify' && list === 'verify' && !t.done) patch.testing = true;
    next = todos.map((x) => {
      if (x.id === id) return dropFocus({ ...x, ...patch });
      if (subtree.has(x.id) && x.list !== list) return { ...x, list };
      if (x.id === parentId && x.collapsed) return { ...x, collapsed: false };
      return x;
    });
  }
  return reorderTodo(next, id, target.index, target.focused);
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
      ...(t.focused === true ? { focused: true } : {}),
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
  // 聚焦标记只留在 FOCUS 的顶层项上
  for (const t of todos) if (t.focused && !isFocusRoot(t)) delete t.focused;
  return todos;
}
