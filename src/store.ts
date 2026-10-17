import { create } from 'zustand';
import * as M from './model';
import { api, backupStore, loadLegacyData, loadLegacyProfiles, loadStore, saveStore, saveStoreSync } from './platform';
import { newClock, type ClockState, type VV } from './sync/clock';
import {
  createProfile as docCreateProfile,
  emptyDoc,
  expireTrash,
  findConflicts,
  keepAllTitles,
  resolveDelete,
  resolveProfile,
  resolveTitle,
  setProfileDeleted,
  updateProfile,
  viewProfile,
  visibleProfiles,
  type Conflict,
  type SyncDoc,
} from './sync/doc';
import { emptyMeta, normalizeMeta, type SyncMeta, type SyncStatus } from './sync/engine';
import { parseDoc } from './sync/file';
import { migrateLegacy, type LegacyProfile } from './sync/migrate';
import * as O from './sync/ops';
import { sanitizeTrash } from './trash';
import { DEFAULT_PROFILE_ID, VIEW_IDS, type ListId, type Prefs, type Profile, type Settings, type Todo, type TrashEntry, type ViewId } from './types';

const DEFAULT_PREFS: Prefs = { activeView: 'focus', doneCollapsed: {} };
const DEFAULT_SETTINGS: Settings = { sound: true };
const PROFILE_NAME_MAX = 24;

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** 设备 id：10 位小写字母数字 */
function newDeviceId() {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ').slice(0, PROFILE_NAME_MAX);

/** 第一次打开时放几条上手提示，删掉即可 */
function seedTodos(now: number): Todo[] {
  let s: Todo[] = [];
  const add = (title: string, list: ListId, parentId: string | null = null, offset = 0) => {
    const id = newId();
    s = M.createTodo(s, { id, title, list, parentId, now: now + offset });
    return id;
  };
  add('右键或点 ⋯ 查看更多操作，双击文字可以编辑', 'inbox', null, 1);
  add('拖动条目可以排序；拖到左侧栏的列表图标上可以移到那个列表', 'inbox', null, 2);
  add('点右边的 ◎ 按钮，把这条一键送进 FOCUS', 'inbox', null, 3);
  const g = add('写下一个长期目标', 'goal', null, 4);
  add('点 + 把它拆成小步骤', 'goal', g, 5);
  add('做完但还要测试？点右边的烧瓶，把它送进 VERIFY 待测', 'focus', null, 6);
  add('勾选完成，体验一下完成动画 ✦', 'focus', null, 7);
  return s;
}

// ---------- 只属于本机的状态（不同步） ----------

export interface LocalState {
  version: 2;
  /** 本份安装的随机数，写进云端文件头，用来发现"别的安装冒用同一个设备 id" */
  nonce: string;
  clock: ClockState;
  activeProfileId: string;
  /** 每个 profile 各自的界面偏好 */
  prefs: Record<string, Prefs>;
  /** 折叠状态只存本机 */
  collapsed: Record<string, true>;
  settings: Settings;
  /** 还只有上手示例、没动过：第一次加入已有数据的云端时直接以云端为准 */
  pristine: boolean;
  /** replacePending：选了「以云端为准」，第一次读到云端数据时用它整个替换本机文档 */
  sync: { enabled: boolean; meta: SyncMeta; replacePending?: boolean };
  /** 已经自动弹出过的冲突，不重复弹 */
  prompted: string[];
}

function parsePrefs(raw: unknown): Prefs {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<Prefs> & { activeList?: string };
  const view = (p.activeView ?? p.activeList) as ViewId | undefined;
  return {
    activeView: view && VIEW_IDS.includes(view) ? view : 'focus',
    doneCollapsed: p.doneCollapsed && typeof p.doneCollapsed === 'object' ? p.doneCollapsed : {},
  };
}

function parseLocal(raw: unknown): LocalState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<LocalState>;
  if (r.version !== 2 || !r.clock || typeof r.clock.deviceId !== 'string') return null;
  const prefs: Record<string, Prefs> = {};
  for (const [k, v] of Object.entries(r.prefs ?? {})) prefs[k] = parsePrefs(v);
  return {
    version: 2,
    nonce: typeof r.nonce === 'string' && r.nonce ? r.nonce : newDeviceId(),
    clock: { ...newClock(r.clock.deviceId), ...r.clock },
    activeProfileId: typeof r.activeProfileId === 'string' ? r.activeProfileId : DEFAULT_PROFILE_ID,
    prefs,
    collapsed: r.collapsed && typeof r.collapsed === 'object' ? r.collapsed : {},
    settings: { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) },
    pristine: !!r.pristine,
    sync: { enabled: !!r.sync?.enabled, meta: normalizeMeta(r.sync?.meta), replacePending: !!r.sync?.replacePending },
    prompted: Array.isArray(r.prompted) ? r.prompted.filter((x) => typeof x === 'string').slice(-200) : [],
  };
}

const freshLocal = (deviceId: string, nonce: string): LocalState => ({
  version: 2,
  nonce,
  clock: newClock(deviceId),
  activeProfileId: DEFAULT_PROFILE_ID,
  prefs: {},
  collapsed: {},
  settings: DEFAULT_SETTINGS,
  pristine: false,
  sync: { enabled: false, meta: emptyMeta() },
  prompted: [],
});

/** v1（每个 profile 一个文件 + 回收站）→ 迁移用的中间形式 */
async function readLegacy(local: LocalState): Promise<LegacyProfile[]> {
  const out: LegacyProfile[] = [];
  const idx = (await loadLegacyProfiles()) as {
    activeId?: string;
    profiles?: { id?: unknown; name?: unknown; createdAt?: unknown }[];
    settings?: Partial<Settings>;
  } | null;
  const list =
    idx && Array.isArray(idx.profiles) && idx.profiles.length
      ? idx.profiles.filter((p): p is { id: string; name?: unknown; createdAt?: unknown } => typeof p?.id === 'string')
      : [{ id: DEFAULT_PROFILE_ID, name: '默认', createdAt: Date.now() }];
  for (const p of list) {
    const raw = (await loadLegacyData(p.id)) as { todos?: unknown; trash?: unknown; prefs?: { sound?: unknown } } | null;
    if (!raw && list.length === 1 && !idx) return [];
    out.push({
      id: p.id,
      name: (typeof p.name === 'string' && cleanName(p.name)) || '默认',
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
      todos: M.sanitize(raw?.todos),
      trash: sanitizeTrash(raw?.trash),
    });
    if (raw?.prefs) local.prefs[p.id] = parsePrefs(raw.prefs);
    if (!idx && typeof raw?.prefs?.sound === 'boolean') local.settings = { ...local.settings, sound: raw.prefs.sound };
  }
  if (idx?.settings) local.settings = { ...local.settings, ...idx.settings };
  if (typeof idx?.activeId === 'string') local.activeProfileId = idx.activeId;
  return out;
}

// ---------- 数据状态 ----------

interface Derived {
  profileId: string;
  profiles: Profile[];
  todos: Todo[];
  trash: TrashEntry[];
  prefs: Prefs;
  settings: Settings;
  conflicts: Conflict[];
}

function derive(doc: SyncDoc, local: LocalState): Derived {
  const ps = visibleProfiles(doc);
  const profileId = ps.some((p) => p.id === local.activeProfileId) ? local.activeProfileId : (ps[0]?.id ?? '');
  const view = profileId ? viewProfile(doc, profileId, local.collapsed) : { todos: [], trash: [] };
  return {
    profileId,
    profiles: ps.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt })),
    todos: view.todos,
    trash: view.trash,
    prefs: local.prefs[profileId] ?? DEFAULT_PREFS,
    settings: local.settings,
    conflicts: findConflicts(doc),
  };
}

const conflictKey = (c: Conflict) =>
  c.kind === 'title'
    ? `t:${c.id}:${c.options.map((o) => o.t).join(',')}`
    : c.kind === 'delete'
      ? `d:${c.id}:${c.deletedT}:${c.edits.length}`
      : `p:${c.profileId}:${c.deletedT}`;

type OpResult<R> = O.DocState & { collapsed: O.Collapsed; result: R };

interface DataStore extends Derived {
  loaded: boolean;
  doc: SyncDoc;
  clock: ClockState;
  local: LocalState;
  syncStatus: SyncStatus | null;
  init(): Promise<void>;
  setPrefs(p: Partial<Prefs>): void;
  setSettings(p: Partial<Settings>): void;
  switchProfile(id: string): Promise<void>;
  createProfile(name: string): Promise<string | null>;
  renameProfile(id: string, name: string): void;
  deleteProfile(id: string): Promise<void>;
  add(title: string, list: ListId, parentId?: string | null): string | null;
  complete(id: string): ListId | null;
  uncomplete(id: string): void;
  move(id: string, list: ListId): void;
  markForTest(id: string): void;
  unmarkTest(id: string): void;
  reorder(id: string, toIndex: number): void;
  remove(id: string): string | null;
  restoreTrash(entryId: string): ListId | null;
  purgeTrashEntry(entryId: string): void;
  emptyTrash(): void;
  /** base：开始编辑时的 clock.knowledge，编辑期间远端也改了标题时变成冲突 */
  rename(id: string, title: string, base?: VV | null): void;
  setCollapsed(id: string, collapsed: boolean): void;
  // ---- 冲突 ----
  resolveTitle(id: string, title: string): void;
  keepAllTitles(id: string, keep: string, others: string[]): void;
  resolveDelete(id: string, choice: 'restore' | 'delete'): void;
  resolveProfile(id: string, choice: 'restore' | 'delete'): void;
  // ---- 同步（由同步引擎调用） ----
  mergeRemote(doc: SyncDoc, knowledge: VV): void;
  setSyncMeta(meta: SyncMeta): void;
  setSyncEnabled(enabled: boolean): void;
  /** 加入云端时选「以云端为准」：本机文档先备份再清空 */
  resetForCloud(): Promise<void>;
  /** 云端发现别的安装在用本机的设备 id：换一个 */
  regenerateDeviceId(): Promise<void>;
}

/** 本机有改动时通知同步引擎（由同步模块注册，避免循环依赖） */
let onLocalChange: () => void = () => {};
export function setLocalChangeListener(fn: () => void) {
  onLocalChange = fn;
}

export const useData = create<DataStore>((set, get) => {
  /** 写入新的文档 / 本机状态并重新派生界面数据 */
  const commit = (doc: SyncDoc, clock: ClockState, local: LocalState, localEdit: boolean) => {
    const prevDoc = get().doc;
    const nextLocal = localEdit && doc !== prevDoc ? { ...local, pristine: false } : local;
    set({ doc, clock, local: nextLocal, ...derive(doc, nextLocal) });
    if (localEdit && doc !== prevDoc) onLocalChange();
  };

  /** 跑一个 ops 里的操作 */
  const run = <R,>(fn: (st: O.DocState, ctx: O.OpCtx) => OpResult<R>): R => {
    const s = get();
    if (!s.profileId) return undefined as R;
    const r = fn({ doc: s.doc, clock: s.clock }, { profileId: s.profileId, collapsed: s.local.collapsed, now: Date.now() });
    commit(r.doc, r.clock, r.collapsed === s.local.collapsed ? s.local : { ...s.local, collapsed: r.collapsed }, true);
    return r.result;
  };

  /** 跑一个直接改文档的操作（profile、冲突决定等） */
  const runDoc = (fn: (doc: SyncDoc, clock: ClockState, now: number) => { doc: SyncDoc; clock: ClockState }) => {
    const s = get();
    const e = fn(s.doc, s.clock, Date.now());
    commit(e.doc, e.clock, s.local, true);
  };

  /** 一个 profile 都不可见时（例如两台设备各删了一个），建一个空的"默认" */
  const ensureProfile = () => {
    if (get().profiles.length) return;
    runDoc((doc, clock, now) => docCreateProfile(doc, clock, { id: newId(), name: '默认' }, now));
  };

  return {
    loaded: false,
    doc: emptyDoc(),
    clock: newClock('local'),
    local: freshLocal('local', ''),
    syncStatus: null,
    profileId: '',
    profiles: [],
    todos: [],
    trash: [],
    prefs: DEFAULT_PREFS,
    settings: DEFAULT_SETTINGS,
    conflicts: [],

    async init() {
      const identity = api ? await api.syncIdentity() : null;
      let local = parseLocal(await loadStore('local'));
      let doc = parseDoc(await loadStore('doc'));
      if (!local) local = freshLocal(identity?.deviceId ?? newDeviceId(), identity?.nonce ?? newDeviceId());
      // 钥匙串里的身份和本机状态不一致：数据目录是从别的电脑拷来的，换成本机的身份，保留已知的知识
      if (identity && identity.deviceId !== local.clock.deviceId) {
        local = {
          ...local,
          nonce: identity.nonce,
          clock: { ...newClock(identity.deviceId), knowledge: { ...local.clock.knowledge } },
          sync: { ...local.sync, meta: emptyMeta() },
        };
      }
      let clock = local.clock;
      if (!doc) {
        const legacy = await readLegacy(local);
        if (legacy.length) {
          const m = migrateLegacy(legacy, clock, Date.now());
          doc = m.doc;
          clock = m.clock;
        } else {
          // 全新安装：一个"默认" profile 加几条上手提示
          const now = Date.now();
          let st: O.DocState = docCreateProfile(emptyDoc(), clock, { id: DEFAULT_PROFILE_ID, name: '默认' }, now);
          st = O.editTodos(st, DEFAULT_PROFILE_ID, {}, now, () => seedTodos(now));
          doc = st.doc;
          clock = st.clock;
          local = { ...local, pristine: true };
        }
      }
      // 回收站里超过 30 天的清掉
      const exp = expireTrash(doc, clock, Date.now());
      local = { ...local, clock: exp.clock };
      set({ loaded: true, doc: exp.doc, clock: exp.clock, local, ...derive(exp.doc, local) });
      ensureProfile();
      persistNow();
    },

    setPrefs(p) {
      const s = get();
      if (!s.profileId) return;
      const local = { ...s.local, prefs: { ...s.local.prefs, [s.profileId]: { ...s.prefs, ...p } } };
      commit(s.doc, s.clock, local, false);
    },

    setSettings(p) {
      const s = get();
      commit(s.doc, s.clock, { ...s.local, settings: { ...s.local.settings, ...p } }, false);
    },

    async switchProfile(id) {
      const s = get();
      if (id === s.profileId || !s.profiles.some((p) => p.id === id)) return;
      useUi.getState().set({
        editingId: null,
        addingChildOf: null,
        completing: {},
        menu: null,
        toast: null,
        trashOpen: false,
        dragOverTab: null,
      });
      commit(s.doc, s.clock, { ...s.local, activeProfileId: id }, false);
    },

    async createProfile(name) {
      const clean = cleanName(name);
      if (!clean) return null;
      const id = newId();
      runDoc((doc, clock, now) => docCreateProfile(doc, clock, { id, name: clean }, now));
      await get().switchProfile(id);
      return id;
    },

    renameProfile(id, name) {
      const clean = cleanName(name);
      if (!clean) return;
      runDoc((doc, clock, now) => updateProfile(doc, clock, id, { name: clean }, now));
    },

    async deleteProfile(id) {
      const s = get();
      if (s.profiles.length <= 1 || !s.profiles.some((p) => p.id === id)) return;
      if (id === s.profileId) {
        const idx = s.profiles.findIndex((p) => p.id === id);
        await get().switchProfile(s.profiles[idx + 1]?.id ?? s.profiles[idx - 1].id);
      }
      // 软删除：数据还在文档里，别的设备同时在里面改过时会弹冲突
      runDoc((doc, clock, now) => setProfileDeleted(doc, clock, id, true, now));
    },

    add: (title, list, parentId = null) => run((st, ctx) => O.addTodo(st, ctx, { id: newId(), title, list, parentId })),
    complete: (id) => run((st, ctx) => O.completeTodo(st, ctx, id)),
    uncomplete: (id) => run((st, ctx) => O.uncompleteTodo(st, ctx, id)),
    move: (id, list) => run((st, ctx) => O.moveTodo(st, ctx, id, list)),
    markForTest: (id) => run((st, ctx) => O.markForTest(st, ctx, id)),
    unmarkTest: (id) => run((st, ctx) => O.unmarkTest(st, ctx, id)),
    reorder: (id, toIndex) => run((st, ctx) => O.reorderTodo(st, ctx, id, toIndex)),
    remove: (id) => run((st, ctx) => O.removeTodo(st, ctx, id))?.entryId ?? null,
    restoreTrash: (entryId) => run((st, ctx) => O.restoreFromTrash(st, ctx, entryId)),
    purgeTrashEntry: (entryId) => run((st, ctx) => O.purgeTrashEntry(st, ctx, entryId)),
    emptyTrash: () => run((st, ctx) => O.emptyTrash(st, ctx)),
    rename: (id, title, base = null) => run((st, ctx) => O.renameTodo(st, ctx, id, title, base)),
    setCollapsed: (id, collapsed) => run((st, ctx) => O.setCollapsed(st, ctx, id, collapsed)),

    resolveTitle: (id, title) => runDoc((doc, clock, now) => resolveTitle(doc, clock, id, title, now)),
    keepAllTitles: (id, keep, others) =>
      runDoc((doc, clock, now) => keepAllTitles(doc, clock, id, keep, others.map((title) => ({ id: newId(), title })), now)),
    resolveDelete: (id, choice) => runDoc((doc, clock, now) => resolveDelete(doc, clock, id, choice, now)),
    resolveProfile: (id, choice) => {
      runDoc((doc, clock, now) => resolveProfile(doc, clock, id, choice, now));
      ensureProfile();
    },

    mergeRemote(remote, knowledge) {
      const s = get();
      const replace = !!s.local.sync.replacePending;
      const st = O.mergeRemote({ doc: replace ? emptyDoc() : s.doc, clock: s.clock }, remote, knowledge, Date.now());
      if (!replace && st.doc === s.doc && st.clock === s.clock) return;
      commit(st.doc, st.clock, replace ? { ...s.local, sync: { ...s.local.sync, replacePending: false } } : s.local, false);
      ensureProfile();
      // 新出现的冲突自动弹出一次
      const cur = get();
      const fresh = cur.conflicts.map(conflictKey).filter((k) => !cur.local.prompted.includes(k));
      if (fresh.length) {
        set({ local: { ...cur.local, prompted: [...cur.local.prompted, ...fresh].slice(-200) } });
        useUi.getState().set({ conflictsOpen: true });
      }
    },

    setSyncMeta(meta) {
      const s = get();
      set({ local: { ...s.local, sync: { ...s.local.sync, meta } } });
    },

    setSyncEnabled(enabled) {
      const s = get();
      set({ local: { ...s.local, sync: { ...s.local.sync, enabled } } });
    },

    async resetForCloud() {
      // 不立刻清空（界面会短暂没有任何 profile）：先备份，等第一次读到云端数据时整个替换
      const s = get();
      await backupStore({ doc: s.doc, local: s.local });
      set({ local: { ...s.local, pristine: false, sync: { ...s.local.sync, meta: emptyMeta(), replacePending: true } } });
    },

    async regenerateDeviceId() {
      const s = get();
      const identity = api ? await api.resetSyncIdentity() : null;
      const deviceId = identity?.deviceId ?? newDeviceId();
      const clock = { ...newClock(deviceId), knowledge: { ...s.clock.knowledge } };
      const local = { ...s.local, nonce: identity?.nonce ?? newDeviceId(), clock, sync: { ...s.local.sync, meta: emptyMeta() } };
      set({ clock, local });
      onLocalChange();
    },
  };
});

// ---------- 持久化：改动后稍等合并写盘，关闭前同步落盘 ----------

let saveTimer: ReturnType<typeof setTimeout> | null = null;

const localSnapshot = () => {
  const s = useData.getState();
  return { ...s.local, clock: s.clock };
};

function persistNow() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const s = useData.getState();
  void saveStore('doc', s.doc);
  void saveStore('local', localSnapshot());
}

useData.subscribe((s, prev) => {
  if (!s.loaded || !prev.loaded) return;
  if (s.doc === prev.doc && s.local === prev.local && s.clock === prev.clock) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 250);
});

window.addEventListener('beforeunload', () => {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const s = useData.getState();
  saveStoreSync('doc', s.doc);
  saveStoreSync('local', localSnapshot());
});

// ---------- 仅界面使用的临时状态 ----------

export interface MenuState {
  x: number;
  y: number;
  todoId: string;
}

export interface ToastState {
  key: number;
  text: string;
  /** 可撤销的删除：对应的回收站条目 */
  undoEntry?: string;
}

interface UiStore {
  editingId: string | null;
  addingChildOf: string | null;
  /** 正在播放完成动画、还没写入数据的项 */
  completing: Record<string, true>;
  menu: MenuState | null;
  toast: ToastState | null;
  /** 回收站面板是否打开 */
  trashOpen: boolean;
  /** profile 切换菜单是否打开 */
  profileMenuOpen: boolean;
  /** 同步设置面板 */
  syncOpen: boolean;
  /** 冲突处理面板 */
  conflictsOpen: boolean;
  /** 页签"收到东西"的脉冲计数，变化即触发动画 */
  tabPulse: Record<ListId, number>;
  dragOverTab: ListId | null;
  set(p: Partial<Omit<UiStore, 'set'>>): void;
}

export const useUi = create<UiStore>((set) => ({
  editingId: null,
  addingChildOf: null,
  completing: {},
  menu: null,
  toast: null,
  trashOpen: false,
  profileMenuOpen: false,
  syncOpen: false,
  conflictsOpen: false,
  tabPulse: { focus: 0, verify: 0, inbox: 0, goal: 0 },
  dragOverTab: null,
  set: (p) => set(p),
}));

export function pulseTab(list: ListId) {
  const cur = useUi.getState().tabPulse;
  useUi.getState().set({ tabPulse: { ...cur, [list]: cur[list] + 1 } });
}

let toastKey = 0;
export function showToast(text: string, undoEntry?: string) {
  useUi.getState().set({ toast: { key: ++toastKey, text, undoEntry } });
}
