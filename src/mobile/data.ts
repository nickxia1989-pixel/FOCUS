// iOS 版的数据形状与纯函数：profile（独立数据空间）、HISTORY 按天分组、首次启动的示例数据。
// 列表内的增删改移全部复用 ../model 与 ../trash，这里不重复实现。
import * as M from '../model';
import { purgeTrash, sanitizeTrash } from '../trash';
import { LIST_IDS, type ListId, type Todo, type TrashEntry } from '../types';

/** 五个分区：四个列表 + 按日期回看的 HISTORY */
export type Section = ListId | 'history';
export const SECTIONS: Section[] = [...LIST_IDS, 'history'];

/** 一个独立的数据空间，例如「工作」「生活」 */
export interface Profile {
  id: string;
  name: string;
  /** 头像颜色在 PROFILE_TINTS 里的序号 */
  tint: number;
  createdAt: number;
  todos: Todo[];
  trash: TrashEntry[];
}

export interface MobilePrefs {
  section: Section;
  sound: boolean;
  haptics: boolean;
  /** 各列表"已完成"分组是否折叠 */
  doneCollapsed: Partial<Record<ListId, boolean>>;
}

/** 落盘的完整快照（存储适配层只认这个形状） */
export interface MobileSnapshot {
  version: 1;
  activeProfileId: string;
  profiles: Profile[];
  prefs: MobilePrefs;
}

export const PROFILE_TINTS = ['#f2622e', '#0f9e8e', '#2f7bf5', '#8657f0', '#e0457b', '#3c9d4e', '#d18a00', '#6b7280'];

export const DEFAULT_PREFS: MobilePrefs = { section: 'focus', sound: true, haptics: true, doneCollapsed: {} };

export const DAY = 24 * 60 * 60 * 1000;

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ---------- 清洗 ----------

export function sanitizeSnapshot(raw: unknown, now: number): MobileSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<MobileSnapshot>;
  if (!Array.isArray(r.profiles)) return null;
  const profiles: Profile[] = [];
  const seen = new Set<string>();
  for (const p of r.profiles) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || seen.has(p.id)) continue;
    seen.add(p.id);
    profiles.push({
      id: p.id,
      name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : '未命名',
      tint: Number.isInteger(p.tint) ? Math.abs(p.tint) % PROFILE_TINTS.length : 0,
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : now,
      todos: M.sanitize(p.todos),
      trash: purgeTrash(sanitizeTrash(p.trash), now),
    });
  }
  if (profiles.length === 0) return null;
  const prefs = { ...DEFAULT_PREFS, ...(r.prefs ?? {}) };
  if (!SECTIONS.includes(prefs.section)) prefs.section = 'focus';
  const activeProfileId = profiles.some((p) => p.id === r.activeProfileId) ? r.activeProfileId! : profiles[0].id;
  return { version: 1, activeProfileId, profiles, prefs };
}

// ---------- HISTORY ----------

export interface HistoryItem {
  todo: Todo;
  /** 祖先标题（由外到内），父项当天没一起完成时用来交代出处 */
  path: string[];
  /** 当天跟着它一起完成、被折叠进来的子孙数量 */
  folded: number;
}

export interface HistoryDay {
  /** 当天 0 点的时间戳 */
  day: number;
  items: HistoryItem[];
  /** 当天完成的总数（含折叠进去的子项） */
  total: number;
}

/**
 * 已完成的条目按完成日期分组，新的在前。
 * 父项当天也完成了的子项不单独列出，折叠进父项的计数里，免得勾一个父项刷出一屏子项。
 */
export function historyDays(todos: Todo[]): HistoryDay[] {
  const byId = new Map(todos.map((t) => [t.id, t]));
  const done = todos.filter((t) => t.done && t.completedAt !== null);
  const dayOf = (t: Todo) => M.startOfToday(t.completedAt!);
  /** 往上找：同一天完成的最外层祖先 */
  const foldTarget = (t: Todo): Todo | null => {
    let target: Todo | null = null;
    let p = t.parentId ? byId.get(t.parentId) : undefined;
    const seen = new Set([t.id]);
    while (p && !seen.has(p.id)) {
      seen.add(p.id);
      if (p.done && p.completedAt !== null && dayOf(p) === dayOf(t)) target = p;
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
    return target;
  };
  const folded = new Map<string, number>();
  const shown: Todo[] = [];
  for (const t of done) {
    const target = foldTarget(t);
    if (target) folded.set(target.id, (folded.get(target.id) ?? 0) + 1);
    else shown.push(t);
  }
  const pathOf = (t: Todo) => {
    const out: string[] = [];
    let p = t.parentId ? byId.get(t.parentId) : undefined;
    const seen = new Set([t.id]);
    while (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.unshift(p.title);
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
    return out;
  };
  const days = new Map<number, HistoryDay>();
  for (const t of shown) {
    const day = dayOf(t);
    let d = days.get(day);
    if (!d) days.set(day, (d = { day, items: [], total: 0 }));
    const n = folded.get(t.id) ?? 0;
    d.items.push({ todo: t, path: pathOf(t), folded: n });
    d.total += 1 + n;
  }
  const out = [...days.values()].sort((a, b) => b.day - a.day);
  for (const d of out)
    d.items.sort((a, b) => b.todo.completedAt! - a.todo.completedAt! || (a.todo.id < b.todo.id ? -1 : 1));
  return out;
}

/** 截至今天的最近 n 天每天完成数，旧的在前 */
export function recentCounts(todos: Todo[], now: number, n = 7): { day: number; count: number }[] {
  const today = M.startOfToday(now);
  const days: { day: number; count: number }[] = [];
  for (let i = n - 1; i >= 0; i--) days.push({ day: M.startOfToday(today - i * DAY + DAY / 2), count: 0 });
  const index = new Map(days.map((d, i) => [d.day, i]));
  for (const t of todos) {
    if (!t.done || t.completedAt === null) continue;
    const i = index.get(M.startOfToday(t.completedAt));
    if (i !== undefined) days[i].count++;
  }
  return days;
}

/** 连续有完成记录的天数；今天还没完成也不算断，从昨天往前数 */
export function streak(todos: Todo[], now: number): number {
  const days = new Set<number>();
  for (const t of todos) if (t.done && t.completedAt !== null) days.add(M.startOfToday(t.completedAt));
  let cur = M.startOfToday(now);
  if (!days.has(cur)) cur = M.startOfToday(cur - DAY / 2);
  let n = 0;
  while (days.has(cur)) {
    n++;
    cur = M.startOfToday(cur - DAY / 2);
  }
  return n;
}

// ---------- 首次启动的示例数据 ----------

function seedSpace(now: number, build: (add: SeedAdd) => void): Todo[] {
  let s: Todo[] = [];
  let tick = 0;
  const add: SeedAdd = (title, list, opts = {}) => {
    const id = newId();
    s = M.createTodo(s, { id, title, list, parentId: opts.parent ?? null, now: now + ++tick });
    if (opts.doneAgo !== undefined) {
      const at = now - opts.doneAgo;
      s = s.map((t) => (t.id === id ? { ...t, done: true, completedAt: at } : t));
    }
    return id;
  };
  build(add);
  return s;
}

type SeedAdd = (title: string, list: ListId, opts?: { parent?: string; doneAgo?: number }) => string;

const HOUR = 60 * 60 * 1000;

export function seedSnapshot(now: number): MobileSnapshot {
  const work: Profile = {
    id: newId(),
    name: '工作',
    tint: 0,
    createdAt: now,
    trash: [],
    todos: seedSpace(now, (add) => {
      add('装好 FOCUS iOS 原型', 'inbox', { doneAgo: HOUR / 2 });
      add('完成的事会按日期记进 HISTORY', 'inbox', { doneAgo: DAY + 3 * HOUR });
      add('左滑：删除、移动；右滑：直接完成', 'inbox');
      add('长按条目，查看全部操作', 'inbox');
      add('点右边的 ◎，把这条送进 FOCUS', 'inbox');
      const g = add('写下一个长期目标', 'goal');
      add('长按 → 添加子任务，把它拆成小步骤', 'goal', { parent: g });
      add('做完但还要测？点右边的烧瓶，送进 VERIFY', 'focus');
      add('点圆圈完成，体验一下完成动画 ✦', 'focus');
    }),
  };
  const life: Profile = {
    id: newId(),
    name: '生活',
    tint: 2,
    createdAt: now + 1,
    trash: [],
    todos: seedSpace(now, (add) => {
      add('买咖啡豆', 'inbox');
      add('周末整理书桌', 'focus');
      const g = add('今年读完 12 本书', 'goal');
      add('《置身事内》', 'goal', { parent: g, doneAgo: 2 * DAY });
      add('《原则》', 'goal', { parent: g });
    }),
  };
  return { version: 1, activeProfileId: work.id, profiles: [work, life], prefs: DEFAULT_PREFS };
}

export function emptyProfile(name: string, tint: number, now: number): Profile {
  return { id: newId(), name: name.trim() || '未命名', tint, createdAt: now, todos: [], trash: [] };
}
