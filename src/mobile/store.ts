// iOS 版的状态：数据以可同步的文档为准（../sync），列表操作全部走 ../sync/ops，与桌面端同一条路径。
// 对界面仍然暴露原来的形状：profiles（各自带可见 todos 与回收站）、activeId、prefs。
import { create } from 'zustand';
import { newClock, type ClockState, type VV } from '../sync/clock';
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
} from '../sync/doc';
import { emptyMeta, normalizeMeta, type SyncMeta, type SyncStatus } from '../sync/engine';
import { parseDoc } from '../sync/file';
import { migrateLegacy } from '../sync/migrate';
import * as O from '../sync/ops';
import type { ListId, Todo } from '../types';
import { DEFAULT_PREFS, PROFILE_TINTS, newId, sanitizeSnapshot, seedSnapshot, type MobilePrefs, type Profile, type Section } from './data';
import { keychainGet, keychainSet } from './focusNative';
import { setHapticsEnabled } from './native';
import { backupDoc, loadDoc, loadLegacy, loadLocal, saveDoc, saveLocal } from './storage';

// ---------- 只属于本机的状态 ----------

export interface MobileLocal {
  version: 2;
  nonce: string;
  clock: ClockState;
  activeProfileId: string;
  prefs: MobilePrefs;
  collapsed: Record<string, true>;
  /** 还只有上手示例：第一次加入已有数据的云端时直接以云端为准 */
  pristine: boolean;
  /** replacePending：选了「以云端为准」，第一次读到云端数据时用它整个替换本机文档 */
  sync: { enabled: boolean; meta: SyncMeta; replacePending?: boolean };
  prompted: string[];
}

const randomId = (n: number) => {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
};

function parseLocal(raw: unknown): MobileLocal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<MobileLocal>;
  if (r.version !== 2 || !r.clock || typeof r.clock.deviceId !== 'string') return null;
  return {
    version: 2,
    nonce: typeof r.nonce === 'string' ? r.nonce : randomId(16),
    clock: { ...newClock(r.clock.deviceId), ...r.clock },
    activeProfileId: typeof r.activeProfileId === 'string' ? r.activeProfileId : '',
    prefs: { ...DEFAULT_PREFS, ...(r.prefs ?? {}) },
    collapsed: r.collapsed && typeof r.collapsed === 'object' ? r.collapsed : {},
    pristine: !!r.pristine,
    sync: { enabled: !!r.sync?.enabled, meta: normalizeMeta(r.sync?.meta), replacePending: !!r.sync?.replacePending },
    prompted: Array.isArray(r.prompted) ? r.prompted.slice(-200) : [],
  };
}

/**
 * 设备身份存在钥匙串（ThisDeviceOnly）：从备份恢复到新手机时钥匙串里没有它，
 * 就会生成新的设备 id，新旧两台手机不会写同一个云端文件。
 */
async function deviceIdentity(): Promise<{ deviceId: string; nonce: string }> {
  try {
    const raw = await keychainGet('device-identity');
    const v = raw ? JSON.parse(raw) : null;
    if (v && typeof v.deviceId === 'string' && typeof v.nonce === 'string') return v;
  } catch {}
  const v = { deviceId: randomId(10), nonce: randomId(16) };
  await keychainSet('device-identity', JSON.stringify(v));
  return v;
}

const tintFor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % PROFILE_TINTS.length;
};

interface Derived {
  profiles: Profile[];
  activeId: string;
  prefs: MobilePrefs;
  conflicts: Conflict[];
}

function derive(doc: SyncDoc, local: MobileLocal): Derived {
  const profiles = visibleProfiles(doc).map((p) => {
    const v = viewProfile(doc, p.id, local.collapsed);
    return { id: p.id, name: p.name, tint: p.tint ?? tintFor(p.id), createdAt: p.createdAt, todos: v.todos, trash: v.trash };
  });
  const activeId = profiles.some((p) => p.id === local.activeProfileId) ? local.activeProfileId : (profiles[0]?.id ?? '');
  return { profiles, activeId, prefs: local.prefs, conflicts: findConflicts(doc) };
}

const conflictKey = (c: Conflict) =>
  c.kind === 'title'
    ? `t:${c.id}:${c.options.map((o) => o.t).join(',')}`
    : c.kind === 'delete'
      ? `d:${c.id}:${c.deletedT}:${c.edits.length}`
      : `p:${c.profileId}:${c.deletedT}`;

type OpResult<R> = O.DocState & { collapsed: O.Collapsed; result: R };

interface DataState extends Derived {
  loaded: boolean;
  doc: SyncDoc;
  clock: ClockState;
  local: MobileLocal;
  syncStatus: SyncStatus | null;
  init(): Promise<void>;
  setPrefs(p: Partial<MobilePrefs>): void;
  setSection(section: Section): void;

  switchProfile(id: string): void;
  addProfile(name: string): string;
  renameProfile(id: string, name: string): void;
  /** 至少保留一个 profile */
  deleteProfile(id: string): void;

  add(title: string, list: ListId, parentId?: string | null): string | null;
  complete(id: string): ListId | null;
  uncomplete(id: string): void;
  move(id: string, list: ListId): void;
  markForTest(id: string): void;
  unmarkTest(id: string): void;
  /** base：开始编辑时的 clock.knowledge，编辑期间远端也改了标题时变成冲突 */
  rename(id: string, title: string, base?: VV | null): void;
  setCollapsed(id: string, collapsed: boolean): void;
  /** 删除到回收站，返回回收站条目 id */
  remove(id: string): string | null;
  restoreTrash(entryId: string): ListId | null;
  purgeTrashEntry(entryId: string): void;
  emptyTrash(): void;

  resolveTitle(id: string, title: string): void;
  keepAllTitles(id: string, keep: string, others: string[]): void;
  resolveDelete(id: string, choice: 'restore' | 'delete'): void;
  resolveProfile(id: string, choice: 'restore' | 'delete'): void;

  mergeRemote(doc: SyncDoc, knowledge: VV): void;
  setSyncMeta(meta: SyncMeta): void;
  setSyncEnabled(enabled: boolean): void;
  resetForCloud(): Promise<void>;
  regenerateDeviceId(): Promise<void>;
}

export const activeOf = (s: Pick<DataState, 'profiles' | 'activeId'>) => s.profiles.find((p) => p.id === s.activeId) ?? s.profiles[0];

let onLocalChange: () => void = () => {};
export function setLocalChangeListener(fn: () => void) {
  onLocalChange = fn;
}
/** 新冲突出现时（由界面注册：弹出冲突面板） */
let onNewConflicts: () => void = () => {};
export function setNewConflictListener(fn: () => void) {
  onNewConflicts = fn;
}

export const useData = create<DataState>((set, get) => {
  const commit = (doc: SyncDoc, clock: ClockState, local: MobileLocal, localEdit: boolean) => {
    const prevDoc = get().doc;
    const nextLocal = localEdit && doc !== prevDoc ? { ...local, pristine: false } : local;
    set({ doc, clock, local: nextLocal, ...derive(doc, nextLocal) });
    if (localEdit && doc !== prevDoc) onLocalChange();
  };

  const run = <R,>(fn: (st: O.DocState, ctx: O.OpCtx) => OpResult<R>): R => {
    const s = get();
    if (!s.activeId) return undefined as R;
    const r = fn({ doc: s.doc, clock: s.clock }, { profileId: s.activeId, collapsed: s.local.collapsed, now: Date.now() });
    commit(r.doc, r.clock, r.collapsed === s.local.collapsed ? s.local : { ...s.local, collapsed: r.collapsed }, true);
    return r.result;
  };

  const runDoc = (fn: (doc: SyncDoc, clock: ClockState, now: number) => { doc: SyncDoc; clock: ClockState }) => {
    const s = get();
    const e = fn(s.doc, s.clock, Date.now());
    commit(e.doc, e.clock, s.local, true);
  };

  const ensureProfile = () => {
    if (get().profiles.length) return;
    runDoc((doc, clock, now) => docCreateProfile(doc, clock, { id: newId(), name: '工作', tint: 0 }, now));
  };

  return {
    loaded: false,
    doc: emptyDoc(),
    clock: newClock('local'),
    local: {
      version: 2,
      nonce: '',
      clock: newClock('local'),
      activeProfileId: '',
      prefs: DEFAULT_PREFS,
      collapsed: {},
      pristine: false,
      sync: { enabled: false, meta: emptyMeta() },
      prompted: [],
    },
    syncStatus: null,
    profiles: [],
    activeId: '',
    prefs: DEFAULT_PREFS,
    conflicts: [],

    async init() {
      const identity = await deviceIdentity();
      let local = parseLocal(await loadLocal());
      let doc = parseDoc(await loadDoc());
      if (!local) {
        local = {
          version: 2,
          nonce: identity.nonce,
          clock: newClock(identity.deviceId),
          activeProfileId: '',
          prefs: DEFAULT_PREFS,
          collapsed: {},
          pristine: false,
          sync: { enabled: false, meta: emptyMeta() },
          prompted: [],
        };
      } else if (local.clock.deviceId !== identity.deviceId) {
        // 钥匙串里的身份不一样：从备份恢复到了新手机，换成新身份，保留已知的知识
        local = {
          ...local,
          nonce: identity.nonce,
          clock: { ...newClock(identity.deviceId), knowledge: { ...local.clock.knowledge } },
          sync: { ...local.sync, meta: emptyMeta() },
        };
      }
      let clock = local.clock;
      if (!doc) {
        const now = Date.now();
        const legacy = sanitizeSnapshot(await loadLegacy(), now);
        const snap = legacy ?? seedSnapshot(now);
        const m = migrateLegacy(snap.profiles, clock, now);
        doc = m.doc;
        clock = m.clock;
        local = { ...local, activeProfileId: snap.activeProfileId, prefs: snap.prefs, pristine: !legacy };
      }
      const exp = expireTrash(doc, clock, Date.now());
      local = { ...local, clock: exp.clock };
      set({ loaded: true, doc: exp.doc, clock: exp.clock, local, ...derive(exp.doc, local) });
      setHapticsEnabled(local.prefs.haptics);
      ensureProfile();
      persistNow();
    },

    setPrefs(p) {
      const s = get();
      commit(s.doc, s.clock, { ...s.local, prefs: { ...s.local.prefs, ...p } }, false);
    },

    setSection(section) {
      if (get().prefs.section !== section) get().setPrefs({ section });
    },

    switchProfile(id) {
      const s = get();
      if (s.profiles.some((p) => p.id === id)) commit(s.doc, s.clock, { ...s.local, activeProfileId: id }, false);
    },

    addProfile(name) {
      const used = new Set(get().profiles.map((p) => p.tint));
      const free = PROFILE_TINTS.findIndex((_, i) => !used.has(i));
      const tint = free < 0 ? get().profiles.length % PROFILE_TINTS.length : free;
      const id = newId();
      runDoc((doc, clock, now) => docCreateProfile(doc, clock, { id, name: name.trim() || '未命名', tint }, now));
      get().switchProfile(id);
      return id;
    },

    renameProfile(id, name) {
      const clean = name.trim();
      if (clean) runDoc((doc, clock, now) => updateProfile(doc, clock, id, { name: clean }, now));
    },

    deleteProfile(id) {
      const s = get();
      if (s.profiles.length <= 1) return;
      if (s.activeId === id) get().switchProfile(s.profiles.find((p) => p.id !== id)!.id);
      runDoc((doc, clock, now) => setProfileDeleted(doc, clock, id, true, now));
    },

    add: (title, list, parentId = null) => run((st, ctx) => O.addTodo(st, ctx, { id: newId(), title, list, parentId })),
    complete: (id) => run((st, ctx) => O.completeTodo(st, ctx, id)),
    uncomplete: (id) => run((st, ctx) => O.uncompleteTodo(st, ctx, id)),
    move: (id, list) => run((st, ctx) => O.moveTodo(st, ctx, id, list)),
    markForTest: (id) => run((st, ctx) => O.markForTest(st, ctx, id)),
    unmarkTest: (id) => run((st, ctx) => O.unmarkTest(st, ctx, id)),
    rename: (id, title, base = null) => run((st, ctx) => O.renameTodo(st, ctx, id, title, base)),
    setCollapsed: (id, collapsed) => run((st, ctx) => O.setCollapsed(st, ctx, id, collapsed)),
    remove: (id) => run((st, ctx) => O.removeTodo(st, ctx, id))?.entryId ?? null,
    restoreTrash: (entryId) => run((st, ctx) => O.restoreFromTrash(st, ctx, entryId)),
    purgeTrashEntry: (entryId) => run((st, ctx) => O.purgeTrashEntry(st, ctx, entryId)),
    emptyTrash: () => run((st, ctx) => O.emptyTrash(st, ctx)),

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
      const cur = get();
      const fresh = cur.conflicts.map(conflictKey).filter((k) => !cur.local.prompted.includes(k));
      if (fresh.length) {
        set({ local: { ...cur.local, prompted: [...cur.local.prompted, ...fresh].slice(-200) } });
        onNewConflicts();
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
      // 不立刻清空（界面会短暂没有任何空间）：先备份，等第一次读到云端数据时整个替换
      const s = get();
      await backupDoc({ doc: s.doc, local: s.local });
      set({ local: { ...s.local, pristine: false, sync: { ...s.local.sync, meta: emptyMeta(), replacePending: true } } });
    },

    async regenerateDeviceId() {
      const s = get();
      const v = { deviceId: randomId(10), nonce: randomId(16) };
      await keychainSet('device-identity', JSON.stringify(v));
      const clock = { ...newClock(v.deviceId), knowledge: { ...s.clock.knowledge } };
      set({ clock, local: { ...s.local, nonce: v.nonce, clock, sync: { ...s.local.sync, meta: emptyMeta() } } });
      onLocalChange();
    },
  };
});

/** 当前 profile 的 todos（引用稳定，可直接当 selector 用） */
export const useTodos = () => useData((s) => activeOf(s)?.todos ?? EMPTY);
const EMPTY: Todo[] = [];

// ---------- 持久化：改动后稍等合并写入，切到后台时立即落盘 ----------

let saveTimer: ReturnType<typeof setTimeout> | null = null;

const localSnapshot = () => {
  const s = useData.getState();
  return { ...s.local, clock: s.clock };
};

export function persistNow() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const s = useData.getState();
  void saveDoc(s.doc);
  void saveLocal(localSnapshot());
}

useData.subscribe((s, prev) => {
  if (!s.loaded || !prev.loaded) return;
  if (s.prefs.haptics !== prev.prefs.haptics) setHapticsEnabled(s.prefs.haptics);
  if (s.doc === prev.doc && s.local === prev.local && s.clock === prev.clock) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 300);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && saveTimer) persistNow();
});
window.addEventListener('pagehide', () => saveTimer && persistNow());
