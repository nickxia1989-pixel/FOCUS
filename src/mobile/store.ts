// iOS 版的状态：多个 profile，各自一份 todos + 回收站；所有列表操作都转给 ../model 与 ../trash。
import { create } from 'zustand';
import * as M from '../model';
import { purgeTrash, restoreEntry, trashSubtree } from '../trash';
import type { ListId, Todo } from '../types';
import {
  DEFAULT_PREFS,
  PROFILE_TINTS,
  emptyProfile,
  newId,
  sanitizeSnapshot,
  seedSnapshot,
  type MobilePrefs,
  type MobileSnapshot,
  type Profile,
  type Section,
} from './data';
import { setHapticsEnabled } from './native';
import { storage } from './storage';

interface DataState {
  loaded: boolean;
  profiles: Profile[];
  activeId: string;
  prefs: MobilePrefs;
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
  rename(id: string, title: string): void;
  setCollapsed(id: string, collapsed: boolean): void;
  /** 删除到回收站，返回回收站条目 id */
  remove(id: string): string | null;
  restoreTrash(entryId: string): ListId | null;
  purgeTrashEntry(entryId: string): void;
  emptyTrash(): void;
}

export const activeOf = (s: Pick<DataState, 'profiles' | 'activeId'>) =>
  s.profiles.find((p) => p.id === s.activeId) ?? s.profiles[0];

export const useData = create<DataState>((set, get) => {
  /** 只改当前 profile */
  const patch = (fn: (p: Profile) => Partial<Profile>) =>
    set((s) => ({ profiles: s.profiles.map((p) => (p.id === s.activeId ? { ...p, ...fn(p) } : p)) }));
  const setTodos = (fn: (todos: Todo[]) => Todo[]) => patch((p) => ({ todos: fn(p.todos) }));
  const todos = () => activeOf(get()).todos;

  return {
    loaded: false,
    profiles: [],
    activeId: '',
    prefs: DEFAULT_PREFS,

    async init() {
      const now = Date.now();
      const snap = sanitizeSnapshot(await storage.load(), now);
      const s = snap ?? seedSnapshot(now);
      set({ loaded: true, profiles: s.profiles, activeId: s.activeProfileId, prefs: s.prefs });
      setHapticsEnabled(s.prefs.haptics);
      if (!snap) void storage.save(snapshot());
    },

    setPrefs(p) {
      set({ prefs: { ...get().prefs, ...p } });
    },

    setSection(section) {
      if (get().prefs.section !== section) set({ prefs: { ...get().prefs, section } });
    },

    switchProfile(id) {
      if (get().profiles.some((p) => p.id === id)) set({ activeId: id });
    },

    addProfile(name) {
      const used = new Set(get().profiles.map((p) => p.tint));
      const tint = PROFILE_TINTS.findIndex((_, i) => !used.has(i));
      const p = emptyProfile(name, tint < 0 ? get().profiles.length % PROFILE_TINTS.length : tint, Date.now());
      set({ profiles: [...get().profiles, p], activeId: p.id });
      return p.id;
    },

    renameProfile(id, name) {
      const clean = name.trim();
      if (!clean) return;
      set({ profiles: get().profiles.map((p) => (p.id === id ? { ...p, name: clean } : p)) });
    },

    deleteProfile(id) {
      const rest = get().profiles.filter((p) => p.id !== id);
      if (rest.length === 0) return;
      set({ profiles: rest, activeId: get().activeId === id ? rest[0].id : get().activeId });
    },

    add(title, list, parentId = null) {
      if (!title.trim()) return null;
      const id = newId();
      setTodos((t) => M.createTodo(t, { id, title, list, parentId, now: Date.now() }));
      return id;
    },

    complete(id) {
      const r = M.completeTodo(todos(), id, Date.now());
      setTodos(() => r.todos);
      return r.movedTo;
    },

    uncomplete(id) {
      setTodos((t) => M.uncompleteTodo(t, id));
    },

    move(id, list) {
      setTodos((t) => M.moveTodo(t, id, list));
    },

    markForTest(id) {
      setTodos((t) => M.markForTest(t, id));
    },

    unmarkTest(id) {
      setTodos((t) => M.unmarkTest(t, id));
    },

    rename(id, title) {
      setTodos((t) => M.renameTodo(t, id, title));
    },

    setCollapsed(id, collapsed) {
      setTodos((t) => M.setCollapsed(t, id, collapsed));
    },

    remove(id) {
      const now = Date.now();
      const p = activeOf(get());
      const r = trashSubtree(p.todos, id, now, newId());
      if (!r.entry) return null;
      patch(() => ({ todos: r.todos, trash: purgeTrash([r.entry!, ...p.trash], now) }));
      return r.entry.id;
    },

    restoreTrash(entryId) {
      const p = activeOf(get());
      const entry = p.trash.find((e) => e.id === entryId);
      if (!entry) return null;
      const next = restoreEntry(p.todos, entry);
      patch(() => ({ todos: next, trash: p.trash.filter((e) => e.id !== entryId) }));
      return next.find((t) => t.id === entry.rootId)?.list ?? null;
    },

    purgeTrashEntry(entryId) {
      patch((p) => ({ trash: p.trash.filter((e) => e.id !== entryId) }));
    },

    emptyTrash() {
      patch(() => ({ trash: [] }));
    },
  };
});

/** 当前 profile 的 todos（引用稳定，可直接当 selector 用） */
export const useTodos = () => useData((s) => activeOf(s)?.todos ?? EMPTY);
const EMPTY: Todo[] = [];

// ---------- 持久化：改动后稍等合并写入，切到后台时立即落盘 ----------

const snapshot = (): MobileSnapshot => {
  const { profiles, activeId, prefs } = useData.getState();
  return { version: 1, activeProfileId: activeId, profiles, prefs };
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  void storage.save(snapshot());
}

useData.subscribe((s, prev) => {
  if (!s.loaded || !prev.loaded) return;
  if (s.prefs.haptics !== prev.prefs.haptics) setHapticsEnabled(s.prefs.haptics);
  if (s.profiles === prev.profiles && s.activeId === prev.activeId && s.prefs === prev.prefs) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void storage.save(snapshot());
  }, 300);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});
window.addEventListener('pagehide', flush);
