// 可同步的数据文档：每条 todo / profile 拆成若干寄存器，每个寄存器带戳（HLC + 版本向量）。
// 合并逐寄存器进行；可见列表、回收站、冲突都由文档派生。纯函数，两端共用。
import * as M from '../model';
import type { ListId, Todo, TrashEntry } from '../types';
import { compareStamps, dominates, mergeVV, tick, type ClockState, type Hlc, type Stamp, type VV } from './clock';

export interface Reg<T> {
  v: T;
  s: Stamp;
  /** 连带改动（例如完成父项时子项跟着完成、过期自动清理）：并发时让位于直接改动，也不算"被人改过" */
  d?: 1;
  /** 解决冲突时写入的 */
  r?: 1;
}

/**
 * 标题被两台设备并发改成不同内容时，所有候选值都留在 alts 里等人决定。
 * 每个候选带自己的版本向量：后来某次改动已经看过并覆盖了它，合并时就把它剔掉。
 */
export interface TitleAlt {
  v: string;
  t: Hlc;
  vv: VV;
  r?: 1;
}
export interface TitleVal {
  title: string;
  alts?: TitleAlt[];
}
export interface StatusVal {
  done: boolean;
  completedAt: number | null;
  completedFrom?: ListId;
  testing?: boolean;
}
export interface PosVal {
  parentId: string | null;
  list: ListId;
}
export interface DelVal {
  deletedAt: number | null;
  purged?: boolean;
}

export interface TodoRec {
  id: string;
  /** 所属 profile，创建后不变 */
  p: string;
  createdAt: number;
  title?: Reg<TitleVal>;
  status?: Reg<StatusVal>;
  pos?: Reg<PosVal>;
  order?: Reg<number>;
  del?: Reg<DelVal>;
}

export interface ProfileMeta {
  name: string;
  /** 手机端头像颜色序号；桌面端没有时按 id 配色 */
  tint?: number;
  createdAt: number;
}
export interface ProfileRec {
  id: string;
  meta?: Reg<ProfileMeta>;
  del?: Reg<{ deletedAt: number | null }>;
}

export interface SyncDoc {
  profiles: Record<string, ProfileRec>;
  todos: Record<string, TodoRec>;
}

export const emptyDoc = (): SyncDoc => ({ profiles: {}, todos: {} });

export const TODO_REGS = ['title', 'status', 'pos', 'order', 'del'] as const;
export type TodoRegName = (typeof TODO_REGS)[number];

// ---------- 合并 ----------

type Eq<T> = (a: T, b: T) => boolean;

const sameStatus: Eq<StatusVal> = (a, b) =>
  a.done === b.done && a.completedAt === b.completedAt && a.completedFrom === b.completedFrom && !!a.testing === !!b.testing;
const samePos: Eq<PosVal> = (a, b) => a.parentId === b.parentId && a.list === b.list;
const sameDel: Eq<DelVal> = (a, b) => a.deletedAt === b.deletedAt && !!a.purged === !!b.purged;
const sameMeta: Eq<ProfileMeta> = (a, b) => a.name === b.name && a.tint === b.tint && a.createdAt === b.createdAt;
const sameNum: Eq<number> = (a, b) => a === b;
const sameProfileDel: Eq<{ deletedAt: number | null }> = (a, b) => a.deletedAt === b.deletedAt;

function altsOf(r: Reg<TitleVal>): TitleAlt[] {
  if (r.v.alts?.length) return r.v.alts;
  const a: TitleAlt = { v: r.v.title, t: r.s.t, vv: r.s.vv };
  if (r.r) a.r = 1;
  return [a];
}

/**
 * 候选值的合并：同一次写入去重；被别的候选因果覆盖的剔除；剩下的都是"解决冲突时写的"就按时间取一个。
 * 只剩一个值时冲突自然消失。结果按 t 排序，与合并顺序无关。
 */
function normalizeTitle(all: TitleAlt[]): TitleVal {
  const byT = new Map<string, TitleAlt>();
  for (const a of all) {
    const prev = byT.get(a.t);
    byT.set(a.t, prev ? { ...prev, vv: mergeVV(prev.vv, a.vv) } : a);
  }
  const uniq = [...byT.values()];
  const live = uniq.filter((a) => !uniq.some((b) => b.t !== a.t && dominates(b.vv, a.vv)));
  live.sort((x, y) => (x.t < y.t ? -1 : x.t > y.t ? 1 : 0));
  const top = live[live.length - 1];
  if (live.length <= 1 || live.every((a) => a.r) || live.every((a) => a.v === top.v)) return { title: top.v };
  return { title: top.v, alts: live };
}

const sameTitle: Eq<TitleVal> = (a, b) =>
  a.title === b.title && JSON.stringify(a.alts ?? null) === JSON.stringify(b.alts ?? null);

/** 并发时谁赢：直接改动优先于连带改动，其次看 HLC */
const outranks = (a: Reg<unknown>, b: Reg<unknown>) => (!a.d !== !b.d ? !a.d : a.s.t > b.s.t);

/**
 * 合并一个寄存器。一方覆盖另一方就取它；并发时按 outranks 取胜者，版本向量取并集。
 * 返回值和其中一个入参相同时直接返回那个入参，方便判断"有没有变化"。
 */
function mergeReg<T>(
  a: Reg<T> | undefined,
  b: Reg<T> | undefined,
  eq: Eq<T>,
  concurrent?: (a: Reg<T>, b: Reg<T>) => T,
): Reg<T> | undefined {
  if (!a) return b;
  if (!b) return a;
  const order = compareStamps(a.s, b.s);
  if (order === 'after') return a;
  if (order === 'before') return b;
  if (order === 'equal' && (eq(a.v, b.v) || !concurrent)) return a;
  const winner = outranks(a, b) ? a : b;
  const v = concurrent && !eq(a.v, b.v) ? concurrent(a, b) : winner.v;
  const out: Reg<T> = { v, s: { t: winner.s.t, vv: mergeVV(a.s.vv, b.s.vv) } };
  if (winner.d) out.d = 1;
  if (winner.r) out.r = 1;
  return out;
}

function mergeTitle(a: Reg<TitleVal> | undefined, b: Reg<TitleVal> | undefined) {
  return mergeReg(a, b, sameTitle, (x, y) => normalizeTitle([...altsOf(x), ...altsOf(y)]));
}

function mergeTodoRec(a: TodoRec | undefined, b: TodoRec | undefined): TodoRec {
  if (!a) return b!;
  if (!b) return a;
  const title = mergeTitle(a.title, b.title);
  const status = mergeReg(a.status, b.status, sameStatus);
  const pos = mergeReg(a.pos, b.pos, samePos);
  const order = mergeReg(a.order, b.order, sameNum);
  const del = mergeReg(a.del, b.del, sameDel);
  const createdAt = Math.min(a.createdAt, b.createdAt);
  if (title === a.title && status === a.status && pos === a.pos && order === a.order && del === a.del && createdAt === a.createdAt)
    return a;
  if (title === b.title && status === b.status && pos === b.pos && order === b.order && del === b.del && createdAt === b.createdAt && a.p === b.p)
    return b;
  return { id: a.id, p: a.p < b.p ? a.p : b.p, createdAt, title, status, pos, order, del };
}

function mergeProfileRec(a: ProfileRec | undefined, b: ProfileRec | undefined): ProfileRec {
  if (!a) return b!;
  if (!b) return a;
  const meta = mergeReg(a.meta, b.meta, sameMeta);
  const del = mergeReg(a.del, b.del, sameProfileDel);
  if (meta === a.meta && del === a.del) return a;
  if (meta === b.meta && del === b.del) return b;
  return { id: a.id, meta, del };
}

/** 合并两份文档；满足交换律、结合律、幂等。没有任何变化时返回 a 本身 */
export function mergeDocs(a: SyncDoc, b: SyncDoc): SyncDoc {
  let todos = a.todos;
  for (const [id, rb] of Object.entries(b.todos)) {
    const ra = a.todos[id];
    const m = mergeTodoRec(ra, rb);
    if (m !== ra) {
      if (todos === a.todos) todos = { ...a.todos };
      todos[id] = m;
    }
  }
  let profiles = a.profiles;
  for (const [id, rb] of Object.entries(b.profiles)) {
    const ra = a.profiles[id];
    const m = mergeProfileRec(ra, rb);
    if (m !== ra) {
      if (profiles === a.profiles) profiles = { ...a.profiles };
      profiles[id] = m;
    }
  }
  return todos === a.todos && profiles === a.profiles ? a : { profiles, todos };
}

// ---------- 派生：可见列表与回收站 ----------

const DEFAULT_STATUS: StatusVal = { done: false, completedAt: null };

export function recToTodo(r: TodoRec, collapsed: boolean): Todo {
  const st = r.status?.v ?? DEFAULT_STATUS;
  const pos = r.pos?.v ?? { parentId: null, list: 'inbox' as ListId };
  return {
    id: r.id,
    title: r.title?.v.title ?? '',
    done: st.done,
    list: pos.list,
    parentId: pos.parentId,
    createdAt: r.createdAt,
    completedAt: st.completedAt,
    completedFrom: st.completedFrom,
    order: r.order?.v ?? r.createdAt,
    collapsed,
    testing: !!st.testing && !st.done,
  };
}

const isDeleted = (r: TodoRec) => r.del?.v.deletedAt != null || !!r.del?.v.purged;

export interface ProfileView {
  /** 可见的 todo（已清洗：子项跟随根的列表） */
  todos: Todo[];
  /** 回收站条目：最上层被删的项连同子孙 */
  trash: TrashEntry[];
}

export function profileRecords(doc: SyncDoc, profileId: string): TodoRec[] {
  const out: TodoRec[] = [];
  for (const r of Object.values(doc.todos)) if (r.p === profileId) out.push(r);
  return out;
}

/** 当前 profile 的可见列表与回收站。collapsed 只存在本机 */
export function viewProfile(doc: SyncDoc, profileId: string, collapsed: Record<string, true> = {}): ProfileView {
  const recs = profileRecords(doc, profileId);
  const byId = new Map(recs.map((r) => [r.id, r]));
  // 自己或任一祖先被删 / 彻底删除就不可见；父项根本不存在时当作顶层
  const hiddenMemo = new Map<string, boolean>();
  const hidden = (r: TodoRec, seen = new Set<string>()): boolean => {
    const cached = hiddenMemo.get(r.id);
    if (cached !== undefined) return cached;
    let h = isDeleted(r);
    const pid = r.pos?.v.parentId;
    if (!h && pid && !seen.has(r.id)) {
      seen.add(r.id);
      const parent = byId.get(pid);
      if (parent) h = hidden(parent, seen);
    }
    hiddenMemo.set(r.id, h);
    return h;
  };
  const visible = recs.filter((r) => !hidden(r)).map((r) => recToTodo(r, !!collapsed[r.id]));
  // 确定性清洗：按 id 排序后再修孤儿、断环、子项列表跟随根
  visible.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const todos = M.sanitize(visible);

  const trash: TrashEntry[] = [];
  const kids = new Map<string, TodoRec[]>();
  for (const r of recs) {
    const pid = r.pos?.v.parentId;
    if (!pid) continue;
    const arr = kids.get(pid);
    if (arr) arr.push(r);
    else kids.set(pid, [r]);
  }
  for (const r of recs) {
    const d = r.del?.v;
    if (!d || d.deletedAt == null || d.purged) continue;
    // 只取最上层被删的项：祖先都没被删
    const pid = r.pos?.v.parentId;
    const parent = pid ? byId.get(pid) : undefined;
    if (parent && hidden(parent)) continue;
    const items: Todo[] = [recToTodo(r, false)];
    const stack = [...(kids.get(r.id) ?? [])];
    const seen = new Set([r.id]);
    while (stack.length) {
      const k = stack.pop()!;
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      if (k.del?.v.purged || k.del?.v.deletedAt != null) continue;
      items.push(recToTodo(k, false));
      stack.push(...(kids.get(k.id) ?? []));
    }
    trash.push({
      id: r.id,
      deletedAt: d.deletedAt,
      rootId: r.id,
      parentId: pid ?? null,
      list: rootListOf(r, byId),
      items,
    });
  }
  return { todos, trash };
}

function rootListOf(r: TodoRec, byId: Map<string, TodoRec>): ListId {
  let cur = r;
  const seen = new Set<string>();
  while (cur.pos?.v.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const p = byId.get(cur.pos.v.parentId);
    if (!p) break;
    cur = p;
  }
  return cur.pos?.v.list ?? 'inbox';
}

export interface VisibleProfile {
  id: string;
  name: string;
  tint?: number;
  createdAt: number;
}

/** profile 被删了、但别的设备同时在里面改过：冲突解决之前仍然显示，免得整个空间突然消失 */
function profileDeleteContested(doc: SyncDoc, p: ProfileRec): boolean {
  const del = p.del;
  if (!del || del.v.deletedAt == null) return false;
  if (p.meta && concurrent(p.meta.s, del.s)) return true;
  for (const r of Object.values(doc.todos)) {
    if (r.p !== p.id) continue;
    for (const name of TODO_REGS) {
      const reg = r[name];
      if (reg && !reg.d && concurrent(reg.s, del.s)) return true;
    }
  }
  return false;
}

export function visibleProfiles(doc: SyncDoc): VisibleProfile[] {
  return Object.values(doc.profiles)
    .filter((p) => p.meta && (p.del?.v.deletedAt == null || profileDeleteContested(doc, p)))
    .map((p) => ({ id: p.id, name: p.meta!.v.name, tint: p.meta!.v.tint, createdAt: p.meta!.v.createdAt }))
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

// ---------- 本机写入 ----------

export interface Edit {
  doc: SyncDoc;
  clock: ClockState;
}

function status(t: Todo): StatusVal {
  const s: StatusVal = { done: t.done, completedAt: t.completedAt };
  if (t.completedFrom) s.completedFrom = t.completedFrom;
  if (t.testing) s.testing = true;
  return s;
}

/** 子项的 list 是派生值，不参与比较 */
const posOf = (t: Todo): PosVal => ({ parentId: t.parentId, list: t.list });
const posChanged = (r: TodoRec, t: Todo) => {
  const p = r.pos?.v;
  if (!p) return true;
  if (p.parentId !== t.parentId) return true;
  return t.parentId === null && p.list !== t.list;
};

/**
 * 把 model.ts 改过的可见列表写回文档：哪组字段变了就给哪个寄存器盖新戳。
 * 一次操作只走一次时钟，改动的寄存器共用同一个戳。
 * targets 是这次操作直接针对的条目；其它条目被连带改动的寄存器标成 d（例如完成父项时子项跟着完成）。
 */
export function applyTodos(
  doc: SyncDoc,
  clock: ClockState,
  profileId: string,
  next: Todo[],
  now: number,
  targets?: ReadonlySet<string>,
): Edit {
  let stamp: Stamp | null = null;
  const getStamp = () => {
    if (!stamp) {
      const r = tick(clock, now);
      stamp = r.stamp;
      clock = r.clock;
    }
    return stamp;
  };
  let todos = doc.todos;
  const put = (r: TodoRec) => {
    if (todos === doc.todos) todos = { ...doc.todos };
    todos[r.id] = r;
  };
  for (const t of next) {
    const r = todos[t.id];
    if (!r) {
      const s = getStamp();
      put({
        id: t.id,
        p: profileId,
        createdAt: t.createdAt,
        title: { v: { title: t.title }, s },
        status: { v: status(t), s },
        pos: { v: posOf(t), s },
        order: { v: t.order, s },
        del: { v: { deletedAt: null }, s },
      });
      continue;
    }
    let u: TodoRec | null = null;
    const edit = () => (u ??= { ...r });
    const derived = targets && !targets.has(t.id);
    const reg = <V,>(v: V): Reg<V> => (derived ? { v, s: getStamp(), d: 1 } : { v, s: getStamp() });
    if ((r.title?.v.title ?? '') !== t.title) edit().title = reg({ title: t.title });
    if (!r.status || !sameStatus(r.status.v, status(t))) edit().status = reg(status(t));
    if (posChanged(r, t)) edit().pos = reg(posOf(t));
    if ((r.order?.v ?? r.createdAt) !== t.order) edit().order = reg(t.order);
    if (u) put(u);
  }
  return { doc: todos === doc.todos ? doc : { ...doc, todos }, clock };
}

function writeReg(doc: SyncDoc, clock: ClockState, id: string, now: number, fn: (r: TodoRec, s: Stamp) => TodoRec): Edit {
  const r = doc.todos[id];
  if (!r) return { doc, clock };
  const t = tick(clock, now);
  return { doc: { ...doc, todos: { ...doc.todos, [id]: fn(r, t.stamp) } }, clock: t.clock };
}

/**
 * 改标题。base 是开始编辑时本机的知识：编辑期间远端改了同一条的标题，两边就成为并发，
 * 变成冲突交给旅行者，而不是用编辑框里的旧底稿悄悄盖掉远端的改动。
 */
export function editTitle(
  doc: SyncDoc,
  clock: ClockState,
  id: string,
  title: string,
  base: VV | null,
  now: number,
  resolution = false,
): Edit {
  const r = doc.todos[id];
  const clean = title.trim();
  if (!r || !clean) return { doc, clock };
  const t = tick(clock, now);
  const vv = base ? { ...base, [clock.deviceId]: t.clock.counter } : t.stamp.vv;
  const mine: Reg<TitleVal> = { v: { title: clean }, s: { t: t.stamp.t, vv } };
  if (resolution) mine.r = 1;
  const merged = mergeTitle(r.title, mine)!;
  return { doc: { ...doc, todos: { ...doc.todos, [id]: { ...r, title: merged } } }, clock: t.clock };
}

/** 删除进回收站：只在被删的根项上记删除 */
export function softDelete(doc: SyncDoc, clock: ClockState, id: string, now: number): Edit {
  return writeReg(doc, clock, id, now, (r, s) => ({ ...r, del: { v: { deletedAt: now }, s } }));
}

/**
 * 从回收站恢复：原父项还可见就挂回去，否则作为顶层项回到原列表。返回恢复到的列表。
 */
export function restoreTodo(doc: SyncDoc, clock: ClockState, id: string, now: number): Edit & { list: ListId | null } {
  const r = doc.todos[id];
  if (!r) return { doc, clock, list: null };
  const view = viewProfile(doc, r.p);
  const entry = view.trash.find((e) => e.id === id);
  const visibleIds = new Set(view.todos.map((t) => t.id));
  const pid = r.pos?.v.parentId ?? null;
  const parentVisible = !!pid && visibleIds.has(pid);
  const list = parentVisible ? view.todos.find((t) => t.id === pid)!.list : (entry?.list ?? r.pos?.v.list ?? 'inbox');
  const e = writeReg(doc, clock, id, now, (rec, s) => ({
    ...rec,
    del: { v: { deletedAt: null }, s },
    ...(parentVisible || !pid ? {} : { pos: { v: { parentId: null, list }, s } }),
  }));
  return { ...e, list };
}

/** 彻底删除（回收站里点删除 / 清空 / 过期）：写墓碑，子孙随之不可见。过期清理是连带改动，并发的恢复会赢 */
export function purgeTodos(doc: SyncDoc, clock: ClockState, ids: string[], now: number, derived = false): Edit {
  const live = ids.filter((id) => doc.todos[id] && !doc.todos[id].del?.v.purged);
  if (live.length === 0) return { doc, clock };
  const t = tick(clock, now);
  const todos = { ...doc.todos };
  for (const id of live) {
    const r = todos[id];
    const del: Reg<DelVal> = { v: { deletedAt: r.del?.v.deletedAt ?? now, purged: true }, s: t.stamp };
    if (derived) del.d = 1;
    todos[id] = { ...r, del };
  }
  return { doc: { ...doc, todos }, clock: t.clock };
}

export const TRASH_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** 回收站里超过 30 天的条目写成墓碑；还有待决冲突的先不动 */
export function expireTrash(doc: SyncDoc, clock: ClockState, now: number): Edit {
  const conflicted = new Set(findConflicts(doc).map((c) => (c.kind === 'profile' ? '' : c.id)));
  const ids: string[] = [];
  for (const r of Object.values(doc.todos)) {
    const d = r.del?.v;
    // 删除时间在未来的（对方时钟快）不算过期
    if (d?.deletedAt != null && !d.purged && d.deletedAt <= now && now - d.deletedAt > TRASH_KEEP_MS && !conflicted.has(r.id))
      ids.push(r.id);
  }
  return purgeTodos(doc, clock, ids, now, true);
}

// ---------- profile ----------

export function createProfile(
  doc: SyncDoc,
  clock: ClockState,
  input: { id: string; name: string; tint?: number },
  now: number,
): Edit {
  const t = tick(clock, now);
  const meta: ProfileMeta = { name: input.name, createdAt: now };
  if (input.tint !== undefined) meta.tint = input.tint;
  const rec: ProfileRec = { id: input.id, meta: { v: meta, s: t.stamp }, del: { v: { deletedAt: null }, s: t.stamp } };
  return { doc: { ...doc, profiles: { ...doc.profiles, [input.id]: rec } }, clock: t.clock };
}

export function updateProfile(
  doc: SyncDoc,
  clock: ClockState,
  id: string,
  patch: Partial<Pick<ProfileMeta, 'name' | 'tint'>>,
  now: number,
): Edit {
  const r = doc.profiles[id];
  if (!r?.meta) return { doc, clock };
  const v = { ...r.meta.v, ...patch };
  if (sameMeta(v, r.meta.v)) return { doc, clock };
  const t = tick(clock, now);
  return { doc: { ...doc, profiles: { ...doc.profiles, [id]: { ...r, meta: { v, s: t.stamp } } } }, clock: t.clock };
}

export function setProfileDeleted(doc: SyncDoc, clock: ClockState, id: string, deleted: boolean, now: number): Edit {
  const r = doc.profiles[id];
  if (!r) return { doc, clock };
  const t = tick(clock, now);
  const del = { v: { deletedAt: deleted ? (r.del?.v.deletedAt ?? now) : null }, s: t.stamp };
  return { doc: { ...doc, profiles: { ...doc.profiles, [id]: { ...r, del } } }, clock: t.clock };
}

// ---------- 冲突 ----------

export type ConflictEditKind = 'title' | 'status' | 'pos' | 'order' | 'child';

export type Conflict =
  | { kind: 'title'; id: string; profileId: string; current: string; options: TitleAlt[] }
  | {
      kind: 'delete';
      id: string;
      profileId: string;
      title: string;
      purged: boolean;
      deletedT: Hlc;
      edits: { t: Hlc; what: ConflictEditKind; title: string }[];
    }
  | { kind: 'profile'; profileId: string; name: string; deletedT: Hlc; edits: number };

const concurrent = (a: Stamp, b: Stamp) => compareStamps(a, b) === 'concurrent';

/** 从文档派生出所有待决冲突；任何一台设备做了决定，新戳覆盖旧戳后冲突自然消失 */
export function findConflicts(doc: SyncDoc): Conflict[] {
  const out: Conflict[] = [];
  const kids = new Map<string, TodoRec[]>();
  for (const r of Object.values(doc.todos)) {
    const pid = r.pos?.v.parentId;
    if (!pid) continue;
    const arr = kids.get(pid);
    if (arr) arr.push(r);
    else kids.set(pid, [r]);
  }
  const liveProfiles = new Set(visibleProfiles(doc).map((p) => p.id));

  for (const r of Object.values(doc.todos)) {
    if (!liveProfiles.has(r.p)) continue;
    const alts = r.title?.v.alts;
    if (alts?.length && !r.del?.v.purged) {
      out.push({ kind: 'title', id: r.id, profileId: r.p, current: r.title!.v.title, options: alts });
    }
    const del = r.del;
    if (!del || (del.v.deletedAt == null && !del.v.purged)) continue;
    const edits: { t: Hlc; what: ConflictEditKind; title: string }[] = [];
    for (const name of ['title', 'status', 'pos', 'order'] as const) {
      const reg = r[name];
      if (reg && !reg.d && concurrent(reg.s, del.s)) edits.push({ t: reg.s.t, what: name, title: r.title?.v.title ?? '' });
    }
    // 子孙里（没有被单独删掉的）任何一处并发改动也算
    const stack = [...(kids.get(r.id) ?? [])];
    const seen = new Set([r.id]);
    while (stack.length) {
      const k = stack.pop()!;
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      if (k.del?.v.deletedAt != null || k.del?.v.purged) continue;
      for (const name of ['title', 'status', 'pos', 'order'] as const) {
        const reg = k[name];
        if (reg && !reg.d && concurrent(reg.s, del.s)) {
          edits.push({ t: reg.s.t, what: 'child', title: k.title?.v.title ?? '' });
          break;
        }
      }
      stack.push(...(kids.get(k.id) ?? []));
    }
    if (edits.length) {
      out.push({
        kind: 'delete',
        id: r.id,
        profileId: r.p,
        title: r.title?.v.title ?? '',
        purged: !!del.v.purged,
        deletedT: del.s.t,
        edits: edits.sort((a, b) => (a.t !== b.t ? (a.t < b.t ? 1 : -1) : a.what < b.what ? -1 : a.what > b.what ? 1 : 0)),
      });
    }
  }

  for (const p of Object.values(doc.profiles)) {
    const del = p.del;
    if (!del || del.v.deletedAt == null || !p.meta) continue;
    let edits = 0;
    for (const r of Object.values(doc.todos)) {
      if (r.p !== p.id) continue;
      for (const name of TODO_REGS) {
        const reg = r[name];
        if (reg && !reg.d && concurrent(reg.s, del.s)) {
          edits++;
          break;
        }
      }
    }
    if (p.meta && concurrent(p.meta.s, del.s)) edits++;
    if (edits) out.push({ kind: 'profile', profileId: p.id, name: p.meta.v.name, deletedT: del.s.t, edits });
  }
  // 顺序与对象遍历顺序无关，各设备显示一致
  const key = (c: Conflict) => `${c.kind === 'profile' ? 0 : 1}:${c.kind === 'profile' ? c.profileId : c.id}:${c.kind}`;
  return out.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** 标题冲突：选定一个值（也可以是旅行者另外输入的）。两台设备同时做了不同决定时按时间取一个，不再反复弹出 */
export function resolveTitle(doc: SyncDoc, clock: ClockState, id: string, title: string, now: number): Edit {
  return editTitle(doc, clock, id, title, null, now, true);
}

/** 标题冲突：两个都保留——原条目用 keep，其它候选各复制成一条新 todo（同列表、同父项、同状态） */
export function keepAllTitles(
  doc: SyncDoc,
  clock: ClockState,
  id: string,
  keep: string,
  others: { id: string; title: string }[],
  now: number,
): Edit {
  const r = doc.todos[id];
  if (!r) return { doc, clock };
  const t = tick(clock, now);
  const todos = { ...doc.todos, [id]: { ...r, title: { v: { title: keep }, s: t.stamp, r: 1 as const } } };
  for (const o of others) {
    todos[o.id] = {
      id: o.id,
      p: r.p,
      createdAt: now,
      title: { v: { title: o.title }, s: t.stamp },
      status: r.status ? { v: r.status.v, s: t.stamp } : undefined,
      pos: r.pos ? { v: r.pos.v, s: t.stamp } : undefined,
      // 紧挨在原条目后面：顶层项 order 降序、子项升序（见 model.ts 的 orderDir）
      order: { v: (r.order?.v ?? r.createdAt) + (r.pos?.v.parentId ? 0.0001 : -0.0001), s: t.stamp },
      del: { v: { deletedAt: r.del?.v.deletedAt ?? null }, s: t.stamp },
    };
  }
  return { doc: { ...doc, todos }, clock: t.clock };
}

/** 删除 vs 修改：恢复，或确认删除（重写一次删除，让它覆盖那些并发改动） */
export function resolveDelete(doc: SyncDoc, clock: ClockState, id: string, choice: 'restore' | 'delete', now: number): Edit {
  const r = doc.todos[id];
  if (!r?.del) return { doc, clock };
  if (choice === 'delete') return writeReg(doc, clock, id, now, (rec, s) => ({ ...rec, del: { v: rec.del!.v, s, r: 1 } }));
  return restoreTodo(doc, clock, id, now);
}

export function resolveProfile(doc: SyncDoc, clock: ClockState, id: string, choice: 'restore' | 'delete', now: number): Edit {
  return setProfileDeleted(doc, clock, id, choice === 'delete', now);
}

// ---------- 其它 ----------

/** 文档里最大的 HLC，用来推进对方的时钟 */
export function maxStampT(doc: SyncDoc): Hlc | null {
  let m: Hlc | null = null;
  const see = (s?: Stamp) => {
    if (s && (m === null || s.t > m)) m = s.t;
  };
  for (const r of Object.values(doc.todos)) for (const n of TODO_REGS) see(r[n]?.s);
  for (const p of Object.values(doc.profiles)) {
    see(p.meta?.s);
    see(p.del?.s);
  }
  return m;
}

/** 文档包含的全部知识（所有戳的版本向量之并） */
export function docKnowledge(doc: SyncDoc) {
  let k = {};
  for (const r of Object.values(doc.todos)) for (const n of TODO_REGS) if (r[n]) k = mergeVV(k, r[n]!.s.vv);
  for (const p of Object.values(doc.profiles)) {
    if (p.meta) k = mergeVV(k, p.meta.s.vv);
    if (p.del) k = mergeVV(k, p.del.s.vv);
  }
  return k;
}
