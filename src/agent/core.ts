// AI agent 操作 FOCUS 的核心：解析 id、执行一批操作、生成紧凑快照、按 cursor 算增量。
// 纯函数，桌面渲染进程（实时模式）和 MCP 进程（离线模式）共用。
// 所有写入只调 ../sync/ops 和 ../sync/doc，经时钟打戳；这里不直接改任何寄存器。
import { addDays, dayStart, groupByDay, type HistoryItem } from '../history';
import * as M from '../model';
import { dominates, type ClockState, type VV } from '../sync/clock';
import * as D from '../sync/doc';
import * as O from '../sync/ops';
import { LISTS, LIST_IDS, VIEW_IDS, type ListId, type Todo, type TrashEntry, type ViewId } from '../types';

/** 桌面和 MCP 之间的接口版本：不一致时提示重新构建 */
export const AGENT_API = 1;

export type Collapsed = Record<string, true>;

export interface AgentState {
  doc: D.SyncDoc;
  clock: ClockState;
  /** 折叠状态只属于桌面界面；离线模式下是空的 */
  collapsed: Collapsed;
}

export type Mode = 'live' | 'offline';

export interface SyncInfo {
  enabled: boolean;
  state?: string;
  lastSyncAt?: number | null;
  pending?: boolean;
}

export interface Meta {
  mode: Mode;
  /** 桌面当前的 profile */
  activeProfileId: string | null;
  now: number;
  sync?: SyncInfo | null;
  /** 头部下面的一行补充说明，例如 outbox 里还有改动等桌面并入 */
  note?: string | null;
}

class OpError extends Error {}

const LABEL = Object.fromEntries(LISTS.map((l) => [l.id, l.label])) as Record<ListId, string>;
const REG_NAME: Record<D.TodoRegName, string> = { title: '标题', status: '状态', pos: '位置', order: '排序', del: '删除' };
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

// ---------- 时间 ----------

const pad = (n: number) => String(n).padStart(2, '0');
const md = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const hm = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const weekday = (t: number) => `周${'日一二三四五六'[new Date(t).getDay()]}`;

// ---------- id ----------

const lcp = (a: string, b: string | undefined) => {
  if (b === undefined) return 0;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

/** 每个 id 的最短唯一前缀（至少 min 位，按小写比较）；本来就不长的 id 原样显示 */
export function shortIds(ids: Iterable<string>, min = 6): Map<string, string> {
  const sorted = [...ids].map((id) => ({ id, low: id.toLowerCase() })).sort((a, b) => (a.low < b.low ? -1 : a.low > b.low ? 1 : 0));
  const out = new Map<string, string>();
  sorted.forEach((x, i) => {
    if (x.id.length <= min + 2) return void out.set(x.id, x.id);
    const need = Math.max(lcp(x.low, sorted[i - 1]?.low), lcp(x.low, sorted[i + 1]?.low)) + 1;
    out.set(x.id, x.id.slice(0, Math.max(min, need)));
  });
  return out;
}

interface Fmt {
  sid(id: string): string;
  pid(id: string): string;
}

function makeFmt(doc: D.SyncDoc): Fmt {
  const t = shortIds(Object.keys(doc.todos));
  const p = shortIds(Object.keys(doc.profiles));
  return { sid: (id) => t.get(id) ?? id.slice(0, 8), pid: (id) => p.get(id) ?? id.slice(0, 8) };
}

/** 输入可以是完整 id，也可以是至少 4 位的唯一前缀（不分大小写） */
function matchPrefix(ids: string[], input: string): string[] {
  if (ids.includes(input)) return [input];
  const low = input.toLowerCase();
  return ids.filter((id) => id.toLowerCase().startsWith(low));
}

// ---------- cursor：文档当时的版本向量 ----------

export function cursorOf(doc: D.SyncDoc): string {
  const k = D.docKnowledge(doc) as VV;
  return `c1.${Object.keys(k)
    .sort()
    .map((id) => `${id}:${k[id].toString(36)}`)
    .join(',')}`;
}

export function parseCursor(s: unknown): VV | null {
  if (typeof s !== 'string' || !s.startsWith('c1.')) return null;
  const vv: VV = {};
  const body = s.slice(3);
  if (!body) return vv;
  for (const part of body.split(',')) {
    const m = /^([A-Za-z0-9_-]{1,64}):([0-9a-z]{1,12})$/.exec(part);
    if (!m) return null;
    vv[m[1]] = parseInt(m[2], 36);
  }
  return vv;
}

/** 记录上在 cursor 之后才有的改动（寄存器名） */
function changedRegs(r: D.TodoRec, since: VV): D.TodoRegName[] {
  return D.TODO_REGS.filter((n) => r[n] && !dominates(since, r[n]!.s.vv));
}

// ---------- 定位 ----------

const viewCache = new WeakMap<D.SyncDoc, Map<string, D.ProfileView>>();
function viewOf(doc: D.SyncDoc, profileId: string): D.ProfileView {
  let m = viewCache.get(doc);
  if (!m) viewCache.set(doc, (m = new Map()));
  let v = m.get(profileId);
  if (!v) m.set(profileId, (v = D.viewProfile(doc, profileId)));
  return v;
}

type Where =
  | { kind: 'visible'; todo: Todo; profileId: string }
  | { kind: 'trash'; entry: TrashEntry; profileId: string }
  | { kind: 'inTrash'; entry: TrashEntry; profileId: string }
  | { kind: 'gone'; profileId: string }
  | { kind: 'profileGone'; profileId: string };

function locate(doc: D.SyncDoc, id: string): Where | null {
  const r = doc.todos[id];
  if (!r) return null;
  if (!D.visibleProfiles(doc).some((p) => p.id === r.p)) return { kind: 'profileGone', profileId: r.p };
  if (r.del?.v.purged) return { kind: 'gone', profileId: r.p };
  const view = viewOf(doc, r.p);
  const todo = view.todos.find((t) => t.id === id);
  if (todo) return { kind: 'visible', todo, profileId: r.p };
  const root = view.trash.find((e) => e.id === id);
  if (root) return { kind: 'trash', entry: root, profileId: r.p };
  const within = view.trash.find((e) => e.items.some((t) => t.id === id));
  if (within) return { kind: 'inTrash', entry: within, profileId: r.p };
  return { kind: 'gone', profileId: r.p };
}

const titleOf = (doc: D.SyncDoc, id: string) => oneLine(doc.todos[id]?.title?.v.title ?? '');
const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, ' ');

interface ProfileItem {
  id: string;
  name: string;
}

function deletedProfiles(doc: D.SyncDoc): ProfileItem[] {
  const live = new Set(D.visibleProfiles(doc).map((p) => p.id));
  return Object.values(doc.profiles)
    .filter((p) => p.meta && !live.has(p.id))
    .map((p) => ({ id: p.id, name: p.meta!.v.name }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** 按名字（不分大小写）或 id / id 前缀找 profile */
function findProfile(pool: ProfileItem[], input: string): ProfileItem[] {
  const low = input.trim().toLowerCase();
  const byName = pool.filter((p) => p.name.trim().toLowerCase() === low);
  if (byName.length) return byName;
  const exact = pool.filter((p) => p.id === input.trim());
  if (exact.length) return exact;
  if (low.length < 4) return [];
  return pool.filter((p) => p.id.toLowerCase().startsWith(low));
}

function resolveProfileIn(doc: D.SyncDoc, input: string, deleted: boolean): string {
  const live = D.visibleProfiles(doc);
  const gone = deletedProfiles(doc);
  const hits = findProfile(deleted ? gone : live, input);
  if (hits.length === 1) return hits[0].id;
  if (hits.length > 1) throw new OpError(`profile「${input}」有歧义：${hits.map((p) => `${p.name} [${p.id.slice(0, 8)}]`).join('、')}，用 id 指定`);
  if (!deleted && findProfile(gone, input).length) throw new OpError(`profile「${input}」已删除（可 profile_restore）`);
  if (deleted && findProfile(live, input).length) throw new OpError(`profile「${input}」没有被删除`);
  throw new OpError(`找不到 profile「${input}」；现有：${live.map((p) => p.name).join('、') || '无'}`);
}

/** 跟桌面一样：去掉首尾空白、合并连续空白、最多 24 个字 */
const cleanProfileName = (name: string) => name.trim().replace(/\s+/g, ' ').slice(0, 24);

const TITLE_MAX = 2000;

// ---------- 批量写入 ----------

export interface ApplyInput {
  ops?: unknown;
  profile?: unknown;
  if_unchanged_since?: unknown;
}

export interface ApplyEnv {
  now: number;
  newId(): string;
  activeProfileId: string | null;
  /** 实时模式（桌面开着）才允许界面类操作 */
  live: boolean;
  /** focus_purge 才允许彻底删除 */
  allowPurge: boolean;
}

export interface UiEffects {
  /** 让桌面切到某个 profile / 分区 */
  show?: { profileId: string; view?: ViewId };
  syncNow?: boolean;
}

export type ApplyResult =
  | {
      ok: true;
      state: AgentState;
      /** 每条操作一行结果 */
      lines: string[];
      cursor: string;
      /** 文档或折叠状态有没有变化 */
      changed: boolean;
      ui: UiEffects;
      /** 各类操作实际生效的次数（给桌面的提示条用） */
      counts: Record<string, number>;
    }
  | { ok: false; error: string };

const PURGE_OPS = new Set(['purge', 'empty_trash']);
const UI_OPS = new Set(['show', 'collapse', 'expand', 'sync_now']);

type Line = (f: Fmt) => string;
type Ref = { kind: 'todo' | 'profile'; id: string };

class Batch {
  st: AgentState;
  readonly doc0: D.SyncDoc;
  private ids0: string[];
  private fmt0: Fmt | null = null;
  private refs = new Map<string, Ref>();
  private since: VV | null;
  private defaultProfile: string | null = null;
  /** 同一批里加到同一处的多条按给出的顺序排：组 → 上一条 */
  private lastAdded = new Map<string, string>();
  out: Line[] = [];
  ui: UiEffects = {};
  counts: Record<string, number> = {};

  constructor(
    st: AgentState,
    private env: ApplyEnv,
    since: VV | null,
  ) {
    this.st = st;
    this.doc0 = st.doc;
    this.ids0 = Object.keys(st.doc.todos);
    this.since = since;
  }

  private get f0() {
    return (this.fmt0 ??= makeFmt(this.doc0));
  }

  setDefaultProfile(raw: unknown) {
    const live = D.visibleProfiles(this.st.doc);
    if (raw !== undefined && raw !== null && raw !== '') {
      if (typeof raw !== 'string') throw new OpError('profile 要是字符串');
      this.defaultProfile = resolveProfileIn(this.st.doc, raw, false);
      return;
    }
    const a = this.env.activeProfileId;
    this.defaultProfile = a && live.some((p) => p.id === a) ? a : (live[0]?.id ?? null);
  }

  private ctx(profileId: string): O.OpCtx {
    return { profileId, collapsed: this.st.collapsed, now: this.env.now };
  }

  /** 跑一个 ops.ts 的操作 */
  private run<R>(r: O.DocState & { collapsed: O.Collapsed; result: R }): R {
    this.st = { doc: r.doc, clock: r.clock, collapsed: r.collapsed };
    return r.result;
  }

  /** 跑一个直接改文档的操作（profile、冲突决定） */
  private runDoc(e: D.Edit) {
    this.st = { ...this.st, doc: e.doc, clock: e.clock };
  }

  private count(op: string) {
    this.counts[op] = (this.counts[op] ?? 0) + 1;
  }

  private stale(what: string, regs: string[]): never {
    throw new OpError(`${what} 在 if_unchanged_since 之后被改过（${regs.join('、')}）。整批没有执行，先 focus_read 看看最新状态再决定`);
  }

  private guardTodo(id: string) {
    const r = this.doc0.todos[id];
    if (!this.since || !r) return;
    const regs = changedRegs(r, this.since);
    if (regs.length) this.stale(`「${titleOf(this.doc0, id)}」${this.f0.sid(id)}`, regs.map((n) => REG_NAME[n]));
  }

  private guardProfile(id: string) {
    const p = this.doc0.profiles[id];
    if (!this.since || !p) return;
    const regs = (['meta', 'del'] as const).filter((n) => p[n] && !dominates(this.since!, p[n]!.s.vv));
    if (regs.length) this.stale(`profile「${p.meta?.v.name ?? id}」`, regs.map((n) => (n === 'meta' ? '名字' : '删除')));
  }

  private str(o: Record<string, unknown>, k: string): string;
  private str(o: Record<string, unknown>, k: string, optional: true): string | undefined;
  private str(o: Record<string, unknown>, k: string, optional = false): string | undefined {
    const v = o[k];
    if (v === undefined || v === null || v === '') {
      if (optional) return undefined;
      throw new OpError(`缺少 ${k}`);
    }
    if (typeof v !== 'string') throw new OpError(`${k} 要是字符串`);
    return v;
  }

  private list(v: string): ListId {
    const l = v.trim().toLowerCase() as ListId;
    if (!LIST_IDS.includes(l)) throw new OpError(`list 只能是 focus / verify / inbox / goal，收到「${v}」`);
    return l;
  }

  private title(v: string): string {
    const t = oneLine(v).trim();
    if (!t) throw new OpError('标题不能为空');
    if (t.length > TITLE_MAX) throw new OpError(`标题太长（最多 ${TITLE_MAX} 字）`);
    return t;
  }

  /** 解析条目 id：完整 id、唯一前缀，或本批前面 add 的 "$ref" */
  private todoId(raw: unknown, field = 'id', guard = true): string {
    if (typeof raw !== 'string' || !raw.trim()) throw new OpError(`缺少 ${field}`);
    const input = raw.trim();
    if (input.startsWith('$')) {
      const r = this.refs.get(input.slice(1));
      if (!r || r.kind !== 'todo') throw new OpError(`${field}「${input}」不是本批前面 add 起的 ref`);
      return r.id;
    }
    if (input.length < 4 && !this.doc0.todos[input]) throw new OpError(`${field}「${input}」太短，至少写 4 位`);
    const hits = matchPrefix(this.ids0, input);
    if (!hits.length) throw new OpError(`找不到 ${field}「${input}」`);
    if (hits.length > 1)
      throw new OpError(
        `${field}「${input}」有歧义：${hits
          .slice(0, 5)
          .map((id) => `${this.f0.sid(id)}「${titleOf(this.doc0, id)}」`)
          .join('、')}`,
      );
    if (guard) this.guardTodo(hits[0]);
    return hits[0];
  }

  private where(id: string): Where {
    const w = locate(this.st.doc, id);
    if (!w) throw new OpError(`找不到 ${id}`);
    return w;
  }

  private describeGone(id: string, w: Where): string {
    const name = `「${titleOf(this.st.doc, id)}」`;
    switch (w.kind) {
      case 'trash':
        return `${name}在回收站里（先 restore）`;
      case 'inTrash':
        return `${name}跟着「${oneLine(w.entry.items[0].title)}」${this.f0.sid(w.entry.id)} 一起在回收站里（restore 那一条）`;
      case 'profileGone':
        return `${name}所在的 profile 已删除`;
      default:
        return `${name}已被彻底删除`;
    }
  }

  /** 条目必须是可见的（不在回收站） */
  private visible(id: string): { todo: Todo; profileId: string } {
    const w = this.where(id);
    if (w.kind !== 'visible') throw new OpError(this.describeGone(id, w));
    return w;
  }

  private profileId(raw: unknown, deleted = false, guard = true): string {
    if (typeof raw !== 'string' || !raw.trim()) throw new OpError('缺少 profile');
    const input = raw.trim();
    let id: string;
    if (input.startsWith('$')) {
      const r = this.refs.get(input.slice(1));
      if (!r || r.kind !== 'profile') throw new OpError(`profile「${input}」不是本批前面 profile_create 起的 ref`);
      id = r.id;
    } else id = resolveProfileIn(this.st.doc, input, deleted);
    if (guard) this.guardProfile(id);
    return id;
  }

  private ref(o: Record<string, unknown>, ref: Ref) {
    const name = this.str(o, 'ref', true);
    if (name === undefined) return;
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) throw new OpError('ref 只能用字母、数字、_ 和 -，最多 32 位');
    if (this.refs.has(name)) throw new OpError(`ref「${name}」重复了`);
    this.refs.set(name, ref);
  }

  private noop(text: string) {
    this.out.push(() => text);
  }

  exec(op: string, o: Record<string, unknown>) {
    if (PURGE_OPS.has(op) && !this.env.allowPurge) throw new OpError('彻底删除不可撤销，请用 focus_purge');
    if (!PURGE_OPS.has(op) && this.env.allowPurge) throw new OpError('focus_purge 只做彻底删除');
    if (UI_OPS.has(op) && !this.env.live) throw new OpError('这是桌面界面上的操作，需要桌面开着（现在是离线模式）');
    switch (op) {
      case 'add':
        return this.add(o);
      case 'rename': {
        const id = this.todoId(o.id);
        const { todo, profileId } = this.visible(id);
        const title = this.title(this.str(o, 'title'));
        if (todo.title === title) return this.noop(`rename ${this.f0.sid(id)}：标题没变`);
        this.run(O.renameTodo(this.st, this.ctx(profileId), id, title));
        this.count(op);
        return this.out.push((f) => `rename ${f.sid(id)} →「${title}」`);
      }
      case 'complete': {
        const id = this.todoId(o.id);
        const { todo, profileId } = this.visible(id);
        if (todo.done) return this.noop(`complete ${this.f0.sid(id)}：已经是完成状态`);
        const movedTo = this.run(O.completeTodo(this.st, this.ctx(profileId), id));
        this.count(op);
        return this.out.push((f) => `complete ${f.sid(id)}「${oneLine(todo.title)}」→ 已完成${movedTo ? `，移到 ${LABEL[movedTo]} 的已完成` : ''}`);
      }
      case 'uncomplete': {
        const id = this.todoId(o.id);
        const { todo, profileId } = this.visible(id);
        if (!todo.done) return this.noop(`uncomplete ${this.f0.sid(id)}：本来就没完成`);
        this.run(O.uncompleteTodo(this.st, this.ctx(profileId), id));
        this.count(op);
        return this.out.push((f) => `uncomplete ${f.sid(id)}「${oneLine(todo.title)}」→ 未完成（${LABEL[todo.list]}）`);
      }
      case 'move':
        return this.move(o);
      case 'test': {
        const id = this.todoId(o.id);
        const { todo, profileId } = this.visible(id);
        if (todo.parentId === null && todo.list === 'verify' && !todo.done) return this.noop(`test ${this.f0.sid(id)}：已经在 VERIFY`);
        if (todo.parentId !== null && todo.testing) return this.noop(`test ${this.f0.sid(id)}：已经标为待测`);
        this.run(O.markForTest(this.st, this.ctx(profileId), id));
        this.count(op);
        return this.out.push((f) => `test ${f.sid(id)}「${oneLine(todo.title)}」→ ${todo.parentId === null ? '移进 VERIFY' : '原地标为待测'}`);
      }
      case 'untest': {
        const id = this.todoId(o.id);
        const { todo, profileId } = this.visible(id);
        if (todo.parentId === null) {
          if (todo.list !== 'verify') return this.noop(`untest ${this.f0.sid(id)}：不是待测项`);
          // 顶层待测项没测过：跟界面上 VERIFY 的 ◎ 一样退回 FOCUS
          this.run(O.moveTodo(this.st, this.ctx(profileId), id, 'focus'));
          this.count(op);
          return this.out.push((f) => `untest ${f.sid(id)}「${oneLine(todo.title)}」→ 退回 FOCUS`);
        }
        if (!todo.testing) return this.noop(`untest ${this.f0.sid(id)}：没有标待测`);
        this.run(O.unmarkTest(this.st, this.ctx(profileId), id));
        this.count(op);
        return this.out.push((f) => `untest ${f.sid(id)}「${oneLine(todo.title)}」→ 取消待测`);
      }
      case 'reorder':
        return this.reorder(o);
      case 'focus':
        return this.focus(o);
      case 'unfocus': {
        const id = this.todoId(o.id);
        const { todo, profileId } = this.visible(id);
        if (!M.inZone(todo)) return this.noop(`unfocus ${this.f0.sid(id)}：不在聚焦区`);
        this.run(O.unfocusTodo(this.st, this.ctx(profileId), id));
        this.count(op);
        return this.out.push((f) => `unfocus ${f.sid(id)}「${oneLine(todo.title)}」→ 移出聚焦区，排在「接下来」第 1 位`);
      }
      case 'delete': {
        const id = this.todoId(o.id);
        const w = this.where(id);
        if (w.kind === 'trash') return this.noop(`delete ${this.f0.sid(id)}：已经在回收站`);
        const { todo, profileId } = this.visible(id);
        const r = this.run(O.removeTodo(this.st, this.ctx(profileId), id));
        this.count(op);
        const extra = r && r.count > 1 ? `（含 ${r.count - 1} 个子项）` : '';
        return this.out.push((f) => `delete ${f.sid(id)}「${oneLine(todo.title)}」→ 回收站${extra}`);
      }
      case 'restore': {
        const id = this.todoId(o.id);
        const w = this.where(id);
        if (w.kind === 'visible') return this.noop(`restore ${this.f0.sid(id)}：没在回收站`);
        if (w.kind !== 'trash') throw new OpError(this.describeGone(id, w));
        const list = this.run(O.restoreFromTrash(this.st, this.ctx(w.profileId), id));
        this.count(op);
        const t = oneLine(w.entry.items[0].title);
        return this.out.push((f) => `restore ${f.sid(id)}「${t}」→ 回到 ${list ? LABEL[list] : '原处'}`);
      }
      case 'purge': {
        const id = this.todoId(o.id);
        const w = this.where(id);
        if (w.kind === 'visible') throw new OpError(`「${oneLine(w.todo.title)}」不在回收站：先用 focus_apply 的 delete 删除，再彻底删除`);
        if (w.kind !== 'trash') throw new OpError(this.describeGone(id, w));
        this.run(O.purgeTrashEntry(this.st, this.ctx(w.profileId), id));
        this.count(op);
        const t = oneLine(w.entry.items[0].title);
        const n = w.entry.items.length;
        return this.out.push((f) => `purge ${f.sid(id)}「${t}」${n > 1 ? `（含 ${n - 1} 个子项）` : ''}→ 彻底删除`);
      }
      case 'empty_trash': {
        const pid = o.profile === undefined ? this.defaultProfile : this.profileId(o.profile);
        if (!pid) throw new OpError('缺少 profile');
        const n = viewOf(this.st.doc, pid).trash.length;
        if (!n) return this.noop(`empty_trash ${this.pname(pid)}：回收站本来就是空的`);
        this.run(O.emptyTrash(this.st, this.ctx(pid)));
        this.count(op);
        return this.out.push(() => `empty_trash ${this.pname(pid)} → 彻底删除 ${n} 条`);
      }
      case 'profile_create': {
        const name = cleanProfileName(this.str(o, 'name'));
        if (!name) throw new OpError('名字不能为空');
        if (D.visibleProfiles(this.st.doc).some((p) => p.name.trim().toLowerCase() === name.toLowerCase()))
          throw new OpError(`已经有叫「${name}」的 profile`);
        const id = this.env.newId();
        this.ref(o, { kind: 'profile', id });
        this.runDoc(D.createProfile(this.st.doc, this.st.clock, { id, name }, this.env.now));
        this.count(op);
        return this.out.push((f) => `profile_create → ${name} [${f.pid(id)}]`);
      }
      case 'profile_rename': {
        const pid = this.profileId(o.profile);
        const name = cleanProfileName(this.str(o, 'name'));
        if (!name) throw new OpError('名字不能为空');
        if (this.pname(pid) === name) return this.noop(`profile_rename ${name}：名字没变`);
        if (D.visibleProfiles(this.st.doc).some((p) => p.id !== pid && p.name.trim().toLowerCase() === name.toLowerCase()))
          throw new OpError(`已经有叫「${name}」的 profile`);
        const old = this.pname(pid);
        this.runDoc(D.updateProfile(this.st.doc, this.st.clock, pid, { name }, this.env.now));
        this.count(op);
        return this.out.push(() => `profile_rename ${old} → ${name}`);
      }
      case 'profile_delete': {
        const pid = this.profileId(o.profile);
        if (D.visibleProfiles(this.st.doc).length <= 1) throw new OpError('至少要保留一个 profile');
        const name = this.pname(pid);
        this.runDoc(D.setProfileDeleted(this.st.doc, this.st.clock, pid, true, this.env.now));
        this.count(op);
        return this.out.push(() => `profile_delete ${name} → 已删除（数据还在，可 profile_restore）`);
      }
      case 'profile_restore': {
        const pid = this.profileId(o.profile, true);
        const name = this.pname(pid);
        this.runDoc(D.setProfileDeleted(this.st.doc, this.st.clock, pid, false, this.env.now));
        this.count(op);
        return this.out.push(() => `profile_restore ${name} → 已恢复`);
      }
      case 'resolve_title': {
        const id = this.todoId(o.id);
        this.conflict('title', id);
        const title = this.title(this.str(o, 'title'));
        this.runDoc(D.resolveTitle(this.st.doc, this.st.clock, id, title, this.env.now));
        this.count(op);
        return this.out.push((f) => `resolve_title ${f.sid(id)} → 用「${title}」`);
      }
      case 'keep_all_titles': {
        const id = this.todoId(o.id);
        const c = this.conflict('title', id) as Extract<D.Conflict, { kind: 'title' }>;
        const others = [...new Set(c.options.map((x) => x.v))].filter((v) => v !== c.current).map((title) => ({ id: this.env.newId(), title }));
        this.runDoc(D.keepAllTitles(this.st.doc, this.st.clock, id, c.current, others, this.env.now));
        this.count(op);
        return this.out.push(
          (f) => `keep_all_titles ${f.sid(id)} → 保留「${c.current}」，另存 ${others.map((x) => `${f.sid(x.id)}「${x.title}」`).join('、')}`,
        );
      }
      case 'resolve_delete': {
        const id = this.todoId(o.id);
        this.conflict('delete', id);
        const choice = this.choice(o);
        this.runDoc(D.resolveDelete(this.st.doc, this.st.clock, id, choice, this.env.now));
        this.count(op);
        return this.out.push((f) => `resolve_delete ${f.sid(id)} → ${choice === 'restore' ? '恢复' : '保持删除'}`);
      }
      case 'resolve_profile': {
        const pid = this.profileId(o.profile, false);
        const c = D.findConflicts(this.st.doc).find((x) => x.kind === 'profile' && x.profileId === pid);
        if (!c) throw new OpError(`profile「${this.pname(pid)}」没有删除冲突`);
        const choice = this.choice(o);
        if (choice === 'delete' && D.visibleProfiles(this.st.doc).length <= 1) throw new OpError('至少要保留一个 profile');
        const name = this.pname(pid);
        this.runDoc(D.resolveProfile(this.st.doc, this.st.clock, pid, choice, this.env.now));
        this.count(op);
        return this.out.push(() => `resolve_profile ${name} → ${choice === 'restore' ? '恢复' : '确认删除'}`);
      }
      case 'show': {
        const pid = o.profile === undefined ? this.defaultProfile : this.profileId(o.profile, false, false);
        if (!pid) throw new OpError('缺少 profile');
        let view: ViewId | undefined;
        const sec = this.str(o, 'section', true);
        if (sec !== undefined) {
          view = sec.trim().toLowerCase() as ViewId;
          if (!VIEW_IDS.includes(view)) throw new OpError(`section 只能是 focus / verify / inbox / goal / history，收到「${sec}」`);
        }
        this.ui.show = { profileId: pid, view };
        return this.out.push(() => `show → 桌面切到 ${this.pname(pid)}${view ? ` / ${view === 'history' ? 'HISTORY' : LABEL[view]}` : ''}`);
      }
      case 'collapse':
      case 'expand': {
        const id = this.todoId(o.id, 'id', false);
        const { todo, profileId } = this.visible(id);
        const want = op === 'collapse';
        if (!viewOf(this.st.doc, profileId).todos.some((t) => t.parentId === id)) return this.noop(`${op} ${this.f0.sid(id)}：没有子项`);
        if (!!this.st.collapsed[id] === want) return this.noop(`${op} ${this.f0.sid(id)}：已经${want ? '折叠' : '展开'}`);
        this.run(O.setCollapsed(this.st, this.ctx(profileId), id, want));
        return this.out.push((f) => `${op} ${f.sid(id)}「${oneLine(todo.title)}」→ ${want ? '折叠' : '展开'}`);
      }
      case 'sync_now':
        this.ui.syncNow = true;
        return this.out.push(() => 'sync_now → 已请求立即同步');
      default:
        throw new OpError(`不认识的 op「${op}」`);
    }
  }

  private pname(pid: string) {
    return this.st.doc.profiles[pid]?.meta?.v.name ?? pid;
  }

  private choice(o: Record<string, unknown>): 'restore' | 'delete' {
    const c = this.str(o, 'choice');
    if (c !== 'restore' && c !== 'delete') throw new OpError('choice 只能是 restore 或 delete');
    return c;
  }

  private conflict(kind: 'title' | 'delete', id: string): D.Conflict {
    const c = D.findConflicts(this.st.doc).find((x) => x.kind === kind && x.id === id);
    if (!c) throw new OpError(`「${titleOf(this.st.doc, id)}」没有${kind === 'title' ? '标题' : '删除'}冲突`);
    return c;
  }

  private add(o: Record<string, unknown>) {
    const title = this.title(this.str(o, 'title'));
    const listRaw = this.str(o, 'list', true);
    let profileId: string;
    let parentId: string | null = null;
    let list: ListId;
    if (o.parent !== undefined && o.parent !== null && o.parent !== '') {
      parentId = this.todoId(o.parent, 'parent', false);
      const p = this.visible(parentId);
      profileId = p.profileId;
      list = p.todo.list;
      if (o.profile !== undefined && this.profileId(o.profile, false, false) !== profileId)
        throw new OpError('子任务和父项必须在同一个 profile');
      if (listRaw !== undefined && this.list(listRaw) !== list)
        throw new OpError(`子任务跟随父项所在的列表（父项在 ${LABEL[list]}），不用再给 list`);
    } else {
      const pid = o.profile !== undefined ? this.profileId(o.profile, false, false) : this.defaultProfile;
      if (!pid) throw new OpError('还没有任何 profile，先 profile_create');
      profileId = pid;
      list = listRaw !== undefined ? this.list(listRaw) : 'inbox';
    }
    const id = this.env.newId();
    this.ref(o, { kind: 'todo', id });
    this.run(O.addTodo(this.st, this.ctx(profileId), { id, title, list, parentId }));
    // 新建项排在最前；同一批里加到同一处的多条保持给出的顺序
    const group = parentId ?? `${profileId}:${list}`;
    const prev = this.lastAdded.get(group);
    if (prev) {
      const todos = viewOf(this.st.doc, profileId).todos;
      const me = todos.find((t) => t.id === id)!;
      const rest = M.siblingsOf(todos, me).filter((t) => !t.done && t.id !== id);
      const at = rest.findIndex((t) => t.id === prev);
      if (at >= 0) this.run(O.reorderTodo(this.st, this.ctx(profileId), id, at + 1));
    }
    this.lastAdded.set(group, id);
    this.count('add');
    this.out.push((f) => `add → ${f.sid(id)}「${title}」${parentId ? `↳${f.sid(parentId)}` : LABEL[list]}`);
  }

  private move(o: Record<string, unknown>) {
    const id = this.todoId(o.id);
    const { todo, profileId } = this.visible(id);
    const hasList = o.list !== undefined && o.list !== null && o.list !== '';
    const hasParent = o.parent !== undefined && o.parent !== null && o.parent !== '';
    if (hasList === hasParent) throw new OpError('move 要给 list（换列表）或 parent（改挂到别的父项下），二选一');
    if (hasList) {
      const list = this.list(this.str(o, 'list'));
      if (todo.parentId === null && todo.list === list) return this.noop(`move ${this.f0.sid(id)}：已经在 ${LABEL[list]}`);
      this.run(O.moveTodo(this.st, this.ctx(profileId), id, list));
      this.count('move');
      const note = todo.parentId !== null ? '（脱离原父项，成为顶层）' : list === 'verify' ? '（待测）' : '';
      return this.out.push((f) => `move ${f.sid(id)}「${oneLine(todo.title)}」→ ${LABEL[list]}${note}`);
    }
    const parentId = this.todoId(o.parent, 'parent', false);
    const p = this.visible(parentId);
    if (p.profileId !== profileId) throw new OpError('不能挂到别的 profile 的条目下');
    if (parentId === id) throw new OpError('不能挂到自己下面');
    if (M.descendantIds(viewOf(this.st.doc, profileId).todos, id).has(parentId)) throw new OpError('不能挂到自己的子孙下面');
    if (todo.parentId === parentId) return this.noop(`move ${this.f0.sid(id)}：已经在这个父项下`);
    this.run(O.reparentTodo(this.st, this.ctx(profileId), id, parentId));
    this.count('move');
    return this.out.push((f) => `move ${f.sid(id)}「${oneLine(todo.title)}」→ ↳${f.sid(parentId)}「${oneLine(p.todo.title)}」（${LABEL[p.todo.list]}）`);
  }

  /** 放进 FOCUS 的聚焦区，默认排最后；to: top / bottom 或 index（聚焦区里从 0 起） */
  private focus(o: Record<string, unknown>) {
    const id = this.todoId(o.id);
    const { todo, profileId } = this.visible(id);
    const todos = viewOf(this.st.doc, profileId).todos;
    const zone = M.zoneOf(todos).filter((t) => t.id !== id);
    const has = (k: string) => o[k] !== undefined && o[k] !== null && o[k] !== '';
    if (has('to') && has('index')) throw new OpError('focus 的 to 和 index 只给一个');
    let at = zone.length;
    if (has('to')) {
      const v = this.str(o, 'to');
      if (v !== 'top' && v !== 'bottom') throw new OpError('to 只能是 top 或 bottom');
      at = v === 'top' ? 0 : zone.length;
    } else if (has('index')) {
      const v = o.index;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new OpError('index 要是从 0 起的整数');
      at = Math.min(v, zone.length);
    }
    if (M.inZone(todo) && M.zoneOf(todos).findIndex((t) => t.id === id) === at) return this.noop(`focus ${this.f0.sid(id)}：已经在聚焦区第 ${at + 1} 位`);
    this.run(O.focusTodo(this.st, this.ctx(profileId), id, at));
    this.count('focus');
    const from = todo.list !== 'focus' ? `（从 ${LABEL[todo.list]} 移过来）` : todo.parentId !== null ? '（脱离原父项）' : '';
    return this.out.push((f) => `focus ${f.sid(id)}「${oneLine(todo.title)}」→ 聚焦区第 ${at + 1} 位${from}${todo.done ? '，恢复为未完成' : ''}`);
  }

  private reorder(o: Record<string, unknown>) {
    const id = this.todoId(o.id);
    const { todo, profileId } = this.visible(id);
    const todos = viewOf(this.st.doc, profileId).todos;
    // FOCUS 顶层：聚焦区和「接下来」各排各的，进出聚焦区用 focus / unfocus
    const zoned = M.isFocusRoot(todo) && !todo.done;
    const group = M.siblingsOf(todos, todo).filter((t) => t.done === todo.done && (!zoned || !!t.focused === !!todo.focused));
    const offset = zoned && !todo.focused ? M.zoneOf(todos).length : 0;
    const rest = group.filter((t) => t.id !== id);
    const given = ['before', 'after', 'to', 'index'].filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== '');
    if (given.length !== 1) throw new OpError('reorder 要给 before / after（另一条的 id）、to（top / bottom）或 index（从 0 起）其中一个');
    let to: number;
    if (given[0] === 'before' || given[0] === 'after') {
      const other = this.todoId(o[given[0]], given[0], false);
      if (other === id) throw new OpError('不能排在自己前后');
      const at = rest.findIndex((t) => t.id === other);
      if (at < 0)
        throw new OpError(
          `${given[0]} 的那一条不在同一组里（排序只在同一个父项 / 列表、同为未完成或已完成的条目之间；FOCUS 顶层的聚焦区和「接下来」分开排，进出聚焦区用 focus / unfocus）`,
        );
      to = given[0] === 'before' ? at : at + 1;
    } else if (given[0] === 'to') {
      const v = this.str(o, 'to');
      if (v !== 'top' && v !== 'bottom') throw new OpError('to 只能是 top 或 bottom');
      to = v === 'top' ? 0 : rest.length;
    } else {
      const v = o.index;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new OpError('index 要是从 0 起的整数');
      to = Math.min(v, rest.length);
    }
    const from = group.findIndex((t) => t.id === id);
    if (from === to) return this.noop(`reorder ${this.f0.sid(id)}：位置没变`);
    this.run(O.reorderTodo(this.st, this.ctx(profileId), id, offset + to, zoned ? !!todo.focused : undefined));
    this.count('reorder');
    const where = todo.parentId ? '同级' : zoned ? (todo.focused ? '聚焦区' : '接下来') : `${LABEL[todo.list]} `;
    return this.out.push((f) => `reorder ${f.sid(id)}「${oneLine(todo.title)}」→ ${where}第 ${to + 1} 位（共 ${group.length}）`);
  }
}

/**
 * 执行一批操作：按顺序在内存里执行，任何一条失败整批都不生效。
 * 文档变化只来自 ops.ts / doc.ts 的写入函数，经 state.clock 打戳。
 */
export function applyOps(state: AgentState, input: ApplyInput, env: ApplyEnv): ApplyResult {
  if (!isObj(input)) return { ok: false, error: '参数要是对象' };
  const ops = input.ops;
  if (!Array.isArray(ops) || ops.length === 0) return { ok: false, error: 'ops 要是非空数组' };
  if (ops.length > 500) return { ok: false, error: '一批最多 500 项' };
  let since: VV | null = null;
  if (input.if_unchanged_since !== undefined && input.if_unchanged_since !== null && input.if_unchanged_since !== '') {
    since = parseCursor(input.if_unchanged_since);
    if (!since) return { ok: false, error: 'if_unchanged_since 不是有效的 cursor（用 focus_read 返回的 cursor）' };
  }
  const b = new Batch(state, env, since);
  try {
    b.setDefaultProfile(input.profile);
  } catch (e) {
    if (e instanceof OpError) return { ok: false, error: e.message };
    throw e;
  }
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    const name = isObj(o) && typeof o.op === 'string' ? o.op.trim().toLowerCase() : '';
    try {
      if (!name) throw new OpError('每一项要是带 op 字段的对象');
      b.exec(name, o as Record<string, unknown>);
    } catch (e) {
      if (e instanceof OpError) return { ok: false, error: `第 ${i + 1} 项（${name || '?'}）：${e.message}` };
      throw e;
    }
  }
  const f = makeFmt(b.st.doc);
  return {
    ok: true,
    state: b.st,
    lines: b.out.map((line, i) => `${i + 1} ${line(f)}`),
    cursor: cursorOf(b.st.doc),
    changed: b.st.doc !== state.doc || b.st.collapsed !== state.collapsed,
    ui: b.ui,
    counts: b.counts,
  };
}

const COUNT_LABEL: Record<string, string> = {
  add: '新增',
  rename: '改名',
  complete: '完成',
  uncomplete: '取消完成',
  move: '移动',
  test: '标待测',
  untest: '取消待测',
  reorder: '排序',
  focus: '放进聚焦区',
  unfocus: '移出聚焦区',
  delete: '删除',
  restore: '恢复',
  purge: '彻底删除',
  empty_trash: '清空回收站',
  profile_create: '新建 profile',
  profile_rename: '改 profile 名',
  profile_delete: '删除 profile',
  profile_restore: '恢复 profile',
  resolve_title: '处理冲突',
  keep_all_titles: '处理冲突',
  resolve_delete: '处理冲突',
  resolve_profile: '处理冲突',
};

/** 给桌面提示条用：「AI：新增 2 · 完成 1」，最多列 3 类，多了写「等 N 处」；没有实际改动时返回 null */
export function summarize(counts: Record<string, number>): string | null {
  const merged = new Map<string, number>();
  let total = 0;
  for (const [op, n] of Object.entries(counts)) {
    const label = COUNT_LABEL[op];
    if (!label) continue;
    merged.set(label, (merged.get(label) ?? 0) + n);
    total += n;
  }
  if (!merged.size) return null;
  const top = [...merged].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return `AI：${top.map(([l, n]) => `${l} ${n}`).join(' · ')}${merged.size > 3 ? ` 等 ${total} 处` : ''}`;
}

// ---------- 读取 ----------

export interface ReadInput {
  profile?: unknown;
  sections?: unknown;
  history_days?: unknown;
  trash?: unknown;
  query?: unknown;
  since?: unknown;
  format?: unknown;
}

type Section = ListId | 'history' | 'trash';
const SECTIONS: Section[] = [...LIST_IDS, 'history', 'trash'];

interface ReadOpts {
  profileId: string | null;
  sections: Set<Section>;
  historyDays: number | 'all';
  trashFull: boolean;
  query: string | null;
  since: VV | null;
  sinceRaw: string;
  json: boolean;
}

function parseRead(doc: D.SyncDoc, r: ReadInput): ReadOpts {
  if (!isObj(r)) throw new OpError('参数要是对象');
  const empty = (v: unknown) => v === undefined || v === null || v === '';
  let profileId: string | null = null;
  if (!empty(r.profile)) {
    if (typeof r.profile !== 'string') throw new OpError('profile 要是字符串');
    profileId = resolveProfileIn(doc, r.profile, false);
  }
  let sections = new Set<Section>(SECTIONS);
  if (!empty(r.sections)) {
    const arr = typeof r.sections === 'string' ? r.sections.split(/[\s,]+/).filter(Boolean) : r.sections;
    if (!Array.isArray(arr)) throw new OpError('sections 要是数组，例如 ["focus","inbox"]');
    sections = new Set();
    for (const s of arr) {
      const v = String(s).trim().toLowerCase() as Section;
      if (!SECTIONS.includes(v)) throw new OpError(`sections 只能是 ${SECTIONS.join(' / ')}，收到「${s}」`);
      sections.add(v);
    }
  }
  let historyDays: number | 'all' = 7;
  if (!empty(r.history_days)) {
    if (r.history_days === 'all') historyDays = 'all';
    else if (typeof r.history_days === 'number' && Number.isInteger(r.history_days) && r.history_days >= 0) historyDays = r.history_days;
    else throw new OpError('history_days 要是 ≥0 的整数或 "all"');
  }
  if (!empty(r.trash) && r.trash !== 'summary' && r.trash !== 'full') throw new OpError('trash 只能是 summary 或 full');
  if (!empty(r.query) && typeof r.query !== 'string') throw new OpError('query 要是字符串');
  let since: VV | null = null;
  if (!empty(r.since)) {
    since = parseCursor(r.since);
    if (!since) throw new OpError('since 不是有效的 cursor（用上一次返回的 cursor）');
  }
  if (!empty(r.format) && r.format !== 'text' && r.format !== 'json') throw new OpError('format 只能是 text 或 json');
  return {
    profileId,
    sections,
    historyDays,
    trashFull: r.trash === 'full',
    query: typeof r.query === 'string' && r.query.trim() ? r.query.trim().toLowerCase() : null,
    since,
    sinceRaw: typeof r.since === 'string' ? r.since : '',
    json: r.format === 'json',
  };
}

interface Node {
  id: string;
  title: string;
  done: boolean;
  testing: boolean;
  /** FOCUS 的聚焦区 */
  focused: boolean;
  kids: Node[];
}

interface HistNode {
  id: string;
  title: string;
  at: number;
  from?: ListId;
  parent?: { id: string; title: string };
  kids: HistNode[];
}

interface ProfileBlock {
  id: string;
  name: string;
  current: boolean;
  lists: { list: ListId; items: Node[]; done: number }[];
  history: { days: { day: number; items: HistNode[] }[]; shown: number; total: number } | null;
  trash: { entry: TrashEntry; kids: Node[] }[] | null;
  conflicts: D.Conflict[];
}

function activeOf(doc: D.SyncDoc, meta: Meta): string | null {
  const ps = D.visibleProfiles(doc);
  return meta.activeProfileId && ps.some((p) => p.id === meta.activeProfileId) ? meta.activeProfileId : (ps[0]?.id ?? null);
}

function buildProfile(doc: D.SyncDoc, p: D.VisibleProfile, o: ReadOpts, meta: Meta, conflicts: D.Conflict[]): ProfileBlock {
  const view = viewOf(doc, p.id);
  const idx = M.buildIndex(view.todos);
  const q = o.query;
  // 搜索：匹配项连同祖先（上下文）和子孙
  let keep: Set<string> | null = null;
  if (q) {
    keep = new Set();
    const byId = new Map(view.todos.map((t) => [t.id, t]));
    for (const t of view.todos) {
      if (!t.title.toLowerCase().includes(q)) continue;
      keep.add(t.id);
      for (const d of M.descendantIds(view.todos, t.id)) keep.add(d);
      let cur = t.parentId ? byId.get(t.parentId) : undefined;
      while (cur && !keep.has(cur.id)) {
        keep.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
  }
  const node = (t: Todo): Node => ({
    id: t.id,
    title: oneLine(t.title),
    done: t.done,
    testing: !!t.testing,
    focused: M.inZone(t),
    kids: M.childrenOf(idx, t.id)
      .filter((k) => !keep || keep.has(k.id))
      .map(node),
  });
  const hasOpen = (id: string): boolean => M.childrenOf(idx, id).some((k) => !k.done || hasOpen(k.id));

  const lists: ProfileBlock['lists'] = [];
  for (const list of LIST_IDS) {
    if (!o.sections.has(list)) continue;
    const roots = M.rootsOf(idx, list);
    // 列表里列未完成的顶层项；已完成的顶层项放到 HISTORY，除非下面还有没完成的子项
    const shown = roots.filter((t) => (!t.done || hasOpen(t.id)) && (!keep || keep.has(t.id)));
    const done = roots.filter((t) => t.done && !hasOpen(t.id)).length;
    lists.push({ list, items: shown.map(node), done });
  }

  let history: ProfileBlock['history'] = null;
  if (o.sections.has('history') && o.historyDays !== 0) {
    const from = o.historyDays === 'all' ? -Infinity : addDays(dayStart(meta.now), -(o.historyDays - 1));
    const total = view.todos.filter((t) => t.done && t.completedAt !== null).length;
    const byId = new Map(view.todos.map((t) => [t.id, t]));
    const hnode = (h: HistoryItem): HistNode | null => {
      const kids = h.children.map(hnode).filter((x): x is HistNode => !!x);
      if (q && !h.todo.title.toLowerCase().includes(q) && !kids.length) return null;
      const n: HistNode = { id: h.todo.id, title: oneLine(h.todo.title), at: h.todo.completedAt!, kids };
      if (h.todo.parentId === null || h.parentTitle !== null) n.from = h.todo.completedFrom ?? h.todo.list;
      const parent = h.todo.parentId ? byId.get(h.todo.parentId) : undefined;
      if (h.parentTitle !== null && parent) n.parent = { id: parent.id, title: oneLine(parent.title) };
      return n;
    };
    const days = groupByDay(view.todos)
      .filter((d) => d.day >= from)
      .map((d) => ({ day: d.day, items: d.items.map(hnode).filter((x): x is HistNode => !!x) }))
      .filter((d) => d.items.length);
    const countDeep = (ns: HistNode[]): number => ns.reduce((s, n) => s + 1 + countDeep(n.kids), 0);
    history = { days, shown: days.reduce((s, d) => s + countDeep(d.items), 0), total };
  }

  let trash: ProfileBlock['trash'] = null;
  if (o.sections.has('trash')) {
    trash = [...view.trash]
      .sort((a, b) => b.deletedAt - a.deletedAt)
      .filter((e) => !q || e.items.some((t) => t.title.toLowerCase().includes(q)))
      .map((entry) => {
        if (!o.trashFull) return { entry, kids: [] };
        const ti = M.buildIndex(entry.items);
        const tnode = (t: Todo): Node => ({ id: t.id, title: oneLine(t.title), done: t.done, testing: !!t.testing, focused: false, kids: M.childrenOf(ti, t.id).map(tnode) });
        return { entry, kids: M.childrenOf(ti, entry.id).map(tnode) };
      });
  }

  return {
    id: p.id,
    name: p.name,
    current: p.id === activeOf(doc, meta),
    lists,
    history,
    trash,
    conflicts: conflicts.filter((c) => c.profileId === p.id),
  };
}

function modeText(mode: Mode) {
  return mode === 'live' ? '实时（桌面开着，改动立刻显示）' : '离线（桌面没开：改动先存在本机，桌面下次启动时并入）';
}

function syncText(s: SyncInfo | null | undefined, now: number): string | null {
  if (!s) return null;
  if (!s.enabled) return '同步 关';
  const at = s.lastSyncAt ? ` ${dayStart(s.lastSyncAt) === dayStart(now) ? '' : `${md(s.lastSyncAt)} `}${hm(s.lastSyncAt)}` : '';
  const state: Record<string, string> = { idle: `已同步${at}`, syncing: '同步中', offline: '离线', error: '出错', auth: '账号或密码有误', ratelimit: '坚果云限流' };
  const base = s.state ? (state[s.state] ?? s.state) : `开（上次${at || '：还没有'}）`;
  return `同步 ${base}${s.pending ? '（有改动待上传）' : ''}`;
}

function header(doc: D.SyncDoc, meta: Meta, extra: string[] = []) {
  return ['FOCUS', modeText(meta.mode), syncText(meta.sync, meta.now), `${md(meta.now)} ${hm(meta.now)}`, ...extra, `cursor ${cursorOf(doc)}`]
    .filter(Boolean)
    .join(' · ');
}

function conflictText(c: D.Conflict, f: Fmt): string {
  if (c.kind === 'title') {
    const opts = [...new Set(c.options.map((x) => x.v))].map((v) => `「${oneLine(v)}」`).join(' ');
    return `- 标题冲突 ${f.sid(c.id)}：现在「${oneLine(c.current)}」，候选 ${opts} → resolve_title / keep_all_titles`;
  }
  if (c.kind === 'delete') {
    const what = [...new Set(c.edits.map((e) => (e.what === 'child' ? `子项「${oneLine(e.title)}」` : REG_NAME[e.what])))].join('、');
    return `- 删除 vs 修改 ${f.sid(c.id)}「${oneLine(c.title)}」：一边${c.purged ? '彻底删除' : '删除'}了，另一边同时改了${what}；现在在回收站 → resolve_delete restore / delete`;
  }
  return `- 整个 profile 被删除，但另一边同时在里面改了 ${c.edits} 处 → resolve_profile restore / delete`;
}

function renderText(doc: D.SyncDoc, blocks: ProfileBlock[], o: ReadOpts, meta: Meta): string {
  const f = makeFmt(doc);
  const out: string[] = [header(doc, meta, o.query ? [`搜索「${o.query}」`] : [])];
  if (meta.note) out.push(meta.note);
  const ps = D.visibleProfiles(doc);
  const cur = activeOf(doc, meta);
  out.push(`profile：${ps.map((p) => `${p.name} [${f.pid(p.id)}]${p.id === cur ? '（当前）' : ''}`).join(' · ') || '无'}`);
  const tree = (ns: Node[], depth: number) => {
    for (const n of ns) {
      out.push(`${'  '.repeat(depth)}- [${n.done ? 'x' : ' '}] ${f.sid(n.id)} ${n.title}${n.testing ? ' #待测' : ''}${n.focused ? ' #聚焦' : ''}`);
      tree(n.kids, depth + 1);
    }
  };
  for (const b of blocks) {
    // 搜索时跳过没有匹配的 profile
    if (o.query && !b.lists.some((l) => l.items.length) && !b.history?.shown && !b.trash?.length) continue;
    out.push(`# ${b.name} [${f.pid(b.id)}]${b.current ? '（当前）' : ''}`);
    for (const l of b.lists) {
      if (o.query && !l.items.length) continue;
      const done = l.done && !o.query ? ` · 另有 ${l.done} 条已完成（见 HISTORY）` : '';
      const zone = l.list === 'focus' ? l.items.filter((n) => n.focused).length : 0;
      out.push(`## ${LABEL[l.list]} · ${l.items.length || (l.done ? 0 : '空')}${zone ? `（聚焦 ${zone}）` : ''}${done}`);
      tree(l.items, 0);
    }
    if (b.history && !(o.query && !b.history.shown)) {
      const range =
        o.historyDays === 'all' ? `全部 ${b.history.shown} 条` : b.history.shown ? `近 ${o.historyDays} 天 ${b.history.shown} 条` : `近 ${o.historyDays} 天没有完成记录`;
      const total = o.historyDays === 'all' || o.query || !b.history.total ? '' : ` · 共 ${b.history.total} 条`;
      out.push(`## HISTORY · ${range}${total}`);
      const today = dayStart(meta.now);
      const hist = (ns: HistNode[], depth: number) => {
        for (const n of ns) {
          const from = n.from ? ` ←${LABEL[n.from]}` : '';
          const parent = n.parent ? ` ↑${f.sid(n.parent.id)}「${n.parent.title}」` : '';
          out.push(`${'  '.repeat(depth)}${hm(n.at)} ${f.sid(n.id)} ${n.title}${from}${parent}`);
          hist(n.kids, depth + 1);
        }
      };
      for (const d of b.history.days) {
        const rel = d.day === today ? '（今天）' : d.day === addDays(today, -1) ? '（昨天）' : '';
        out.push(`${md(d.day)} ${weekday(d.day)}${rel}`);
        hist(d.items, 1);
      }
    }
    if (b.trash && !(o.query && !b.trash.length)) {
      out.push(`## 回收站 · ${b.trash.length || '空'}`);
      for (const { entry: e, kids } of b.trash) {
        const n = e.items.length - 1;
        const parent = e.parentId && doc.todos[e.parentId] ? ` · 原父项 ${f.sid(e.parentId)}` : '';
        out.push(`- ${f.sid(e.id)} ${oneLine(e.items[0].title)} · ${LABEL[e.list]} · ${md(e.deletedAt)} 删除${n ? ` · 含 ${n} 个子项` : ''}${parent}`);
        tree(kids, 1);
      }
    }
    if (b.conflicts.length) {
      out.push(`## 冲突 · ${b.conflicts.length}`);
      for (const c of b.conflicts) out.push(conflictText(c, f));
    }
  }
  if (!o.profileId) {
    const gone = deletedProfiles(doc);
    if (gone.length) out.push(`已删除的 profile：${gone.map((p) => `${p.name} [${f.pid(p.id)}]`).join(' · ')}（可 profile_restore）`);
  }
  return out.join('\n');
}

function renderJson(doc: D.SyncDoc, blocks: ProfileBlock[], o: ReadOpts, meta: Meta): string {
  const f = makeFmt(doc);
  const node = (n: Node): Record<string, unknown> => {
    const x: Record<string, unknown> = { id: f.sid(n.id), t: n.title };
    if (n.done) x.done = 1;
    if (n.testing) x.test = 1;
    if (n.focused) x.focus = 1;
    if (n.kids.length) x.kids = n.kids.map(node);
    return x;
  };
  const hnode = (n: HistNode): Record<string, unknown> => {
    const x: Record<string, unknown> = { id: f.sid(n.id), t: n.title, at: hm(n.at) };
    if (n.from) x.from = n.from;
    if (n.parent) x.parent = f.sid(n.parent.id);
    if (n.kids.length) x.kids = n.kids.map(hnode);
    return x;
  };
  const conflict = (c: D.Conflict) =>
    c.kind === 'title'
      ? { kind: 'title', id: f.sid(c.id), current: c.current, options: [...new Set(c.options.map((x) => x.v))] }
      : c.kind === 'delete'
        ? { kind: 'delete', id: f.sid(c.id), title: c.title, purged: c.purged, edits: c.edits.map((e) => e.what) }
        : { kind: 'profile', edits: c.edits };
  const out = {
    mode: meta.mode,
    note: meta.note ?? undefined,
    now: `${md(meta.now)} ${hm(meta.now)}`,
    sync: meta.sync ?? null,
    cursor: cursorOf(doc),
    profiles: blocks.map((b) => {
      const p: Record<string, unknown> = { id: f.pid(b.id), name: b.name };
      if (b.current) p.current = 1;
      const lists: Record<string, unknown> = {};
      for (const l of b.lists) lists[l.list] = { items: l.items.map(node), done: l.done };
      p.lists = lists;
      if (b.history) p.history = { total: b.history.total, days: b.history.days.map((d) => ({ day: md(d.day), items: d.items.map(hnode) })) };
      if (b.trash)
        p.trash = b.trash.map(({ entry: e, kids }) => {
          const x: Record<string, unknown> = { id: f.sid(e.id), t: oneLine(e.items[0].title), list: e.list, deleted: md(e.deletedAt), kids: e.items.length - 1 };
          if (kids.length) x.items = kids.map(node);
          return x;
        });
      if (b.conflicts.length) p.conflicts = b.conflicts.map(conflict);
      return p;
    }),
    deletedProfiles: o.profileId ? undefined : deletedProfiles(doc).map((p) => ({ id: f.pid(p.id), name: p.name })),
  };
  return JSON.stringify(out);
}

function renderChanges(doc: D.SyncDoc, o: ReadOpts, meta: Meta): string {
  const since = o.since!;
  const f = makeFmt(doc);
  const live = new Set(D.visibleProfiles(doc).map((p) => p.id));
  const pname = (id: string) => doc.profiles[id]?.meta?.v.name ?? id;
  type Change = { key: string; text: string; json: Record<string, unknown> };
  const changes: Change[] = [];
  for (const p of Object.values(doc.profiles)) {
    if (o.profileId && p.id !== o.profileId) continue;
    const present = (['meta', 'del'] as const).filter((n) => p[n]);
    const regs = present.filter((n) => !dominates(since, p[n]!.s.vv));
    if (!regs.length) continue;
    const gone = !live.has(p.id);
    const sym = gone ? '-' : regs.length === present.length ? '+' : '~';
    const what = [regs.includes('meta') ? '名字' : '', regs.includes('del') ? (gone ? '删除' : '恢复') : ''].filter(Boolean).join('、');
    changes.push({
      key: `0${pname(p.id)}`,
      text: `${sym} profile ${pname(p.id)} [${f.pid(p.id)}]${sym === '~' || sym === '-' ? `（${what}）` : ''}`,
      json: { kind: 'profile', op: sym, id: f.pid(p.id), name: pname(p.id), fields: regs },
    });
  }
  for (const r of Object.values(doc.todos)) {
    if (o.profileId && r.p !== o.profileId) continue;
    const regs = changedRegs(r, since);
    if (!regs.length) continue;
    const present = D.TODO_REGS.filter((n) => r[n]).length;
    const w = locate(doc, r.id);
    const title = oneLine(r.title?.v.title ?? '');
    const where = `${pname(r.p)}/`;
    let text: string;
    let op: string;
    if (w?.kind === 'visible') {
      const t = w.todo;
      op = regs.length === present ? '+' : '~';
      const parent = t.parentId ? ` ↳${f.sid(t.parentId)}` : '';
      const fields = op === '~' ? `（${regs.map((n) => (n === 'del' ? '恢复' : REG_NAME[n])).join('、')}）` : '';
      text = `${op} ${where}${LABEL[t.list]} [${t.done ? 'x' : ' '}] ${f.sid(r.id)} ${title}${t.testing ? ' #待测' : ''}${M.inZone(t) ? ' #聚焦' : ''}${parent}${fields}`;
    } else {
      op = '-';
      const state =
        w?.kind === 'trash' ? '进了回收站' : w?.kind === 'inTrash' ? `随「${oneLine(w.entry.items[0].title)}」进了回收站` : w?.kind === 'profileGone' ? '所在 profile 已删除' : '彻底删除';
      text = `- ${where.slice(0, -1)} ${f.sid(r.id)} ${title} → ${state}`;
    }
    changes.push({ key: `1${pname(r.p)}\u0000${op === '-' ? 2 : op === '+' ? 0 : 1}${title}`, text, json: { kind: 'todo', op, id: f.sid(r.id), t: title, fields: regs } });
  }
  changes.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const conflicts = D.findConflicts(doc).filter((c) => !o.profileId || c.profileId === o.profileId);
  if (o.json)
    return JSON.stringify({ mode: meta.mode, since: o.sinceRaw, cursor: cursorOf(doc), changes: changes.map((c) => c.json), conflicts: conflicts.length });
  const out = [header(doc, meta, [`自 ${o.sinceRaw} 以来 ${changes.length ? `${changes.length} 处变化` : '没有变化'}`])];
  if (meta.note) out.push(meta.note);
  for (const c of changes) out.push(c.text);
  if (conflicts.length) {
    out.push(`## 冲突 · ${conflicts.length}`);
    for (const c of conflicts) out.push(`${conflictText(c, f)}（${pname(c.profileId)}）`);
  }
  return out.join('\n');
}

/** 生成 focus_read 的输出：全量快照，或传了 since 时只给变化 */
export function read(doc: D.SyncDoc, input: ReadInput, meta: Meta): { ok: true; text: string } | { ok: false; error: string } {
  let o: ReadOpts;
  try {
    o = parseRead(doc, input ?? {});
  } catch (e) {
    if (e instanceof OpError) return { ok: false, error: e.message };
    throw e;
  }
  if (o.since) return { ok: true, text: renderChanges(doc, o, meta) };
  const conflicts = D.findConflicts(doc);
  const ps = D.visibleProfiles(doc).filter((p) => !o.profileId || p.id === o.profileId);
  const blocks = ps.map((p) => buildProfile(doc, p, o, meta, conflicts));
  return { ok: true, text: o.json ? renderJson(doc, blocks, o, meta) : renderText(doc, blocks, o, meta) };
}
