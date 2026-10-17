import { create } from 'zustand';
import * as M from './model';
import { archiveProfile, loadData, loadProfiles, saveData, saveDataSync, saveProfiles } from './platform';
import { purgeTrash, restoreEntry, sanitizeTrash, trashSubtree } from './trash';
import {
  DEFAULT_PROFILE_ID,
  VIEW_IDS,
  type AppData,
  type ListId,
  type Prefs,
  type Profile,
  type ProfilesData,
  type Settings,
  type Todo,
  type TrashEntry,
  type ViewId,
} from './types';

const DEFAULT_PREFS: Prefs = { activeView: 'focus', doneCollapsed: {} };
const DEFAULT_SETTINGS: Settings = { sound: true };
const PROFILE_NAME_MAX = 24;

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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

// ---------- 读入外部数据时的清洗 ----------

interface ProfileContent {
  todos: Todo[];
  prefs: Prefs;
  trash: TrashEntry[];
}

const emptyContent = (): ProfileContent => ({ todos: [], prefs: DEFAULT_PREFS, trash: [] });

function parseContent(raw: unknown): ProfileContent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Omit<AppData, 'prefs'>> & { prefs?: Partial<Prefs> & { activeList?: string } };
  const p: Partial<Prefs> & { activeList?: string } = r.prefs ?? {};
  // 旧版本叫 activeList
  const view = (p.activeView ?? p.activeList) as ViewId | undefined;
  const prefs: Prefs = {
    activeView: view && VIEW_IDS.includes(view) ? view : 'focus',
    doneCollapsed: p.doneCollapsed && typeof p.doneCollapsed === 'object' ? p.doneCollapsed : {},
  };
  return {
    todos: M.sanitize(r.todos),
    prefs,
    trash: purgeTrash(sanitizeTrash(r.trash), Date.now()),
  };
}

const PROFILE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function cleanName(name: string) {
  return name.trim().replace(/\s+/g, ' ').slice(0, PROFILE_NAME_MAX);
}

function parseProfiles(raw: unknown): ProfilesData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<ProfilesData>;
  const seen = new Set<string>();
  const profiles: Profile[] = [];
  for (const p of Array.isArray(r.profiles) ? r.profiles : []) {
    if (!p || typeof p.id !== 'string' || !PROFILE_ID_RE.test(p.id) || seen.has(p.id)) continue;
    seen.add(p.id);
    profiles.push({
      id: p.id,
      name: (typeof p.name === 'string' && cleanName(p.name)) || '未命名',
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
    });
  }
  if (profiles.length === 0) return null;
  const settings = { ...DEFAULT_SETTINGS, ...(r.settings && typeof r.settings === 'object' ? r.settings : {}) };
  const activeId = profiles.some((p) => p.id === r.activeId) ? r.activeId! : profiles[0].id;
  return { version: 1, activeId, profiles, settings };
}

// ---------- 数据状态 ----------

interface DataStore {
  loaded: boolean;
  /** 当前 profile */
  profileId: string;
  profiles: Profile[];
  settings: Settings;
  todos: Todo[];
  prefs: Prefs;
  trash: TrashEntry[];
  init(): Promise<void>;
  setPrefs(p: Partial<Prefs>): void;
  setSettings(p: Partial<Settings>): void;
  switchProfile(id: string): Promise<void>;
  /** 新建并切换过去，返回新 profile 的 id */
  createProfile(name: string): Promise<string | null>;
  renameProfile(id: string, name: string): void;
  /** 至少保留一个；删掉当前的会先切到别的 */
  deleteProfile(id: string): Promise<void>;
  add(title: string, list: ListId, parentId?: string | null): string | null;
  complete(id: string): ListId | null;
  uncomplete(id: string): void;
  move(id: string, list: ListId): void;
  markForTest(id: string): void;
  unmarkTest(id: string): void;
  reorder(id: string, toIndex: number): void;
  /** 删除到回收站，返回回收站条目 id */
  remove(id: string): string | null;
  /** 从回收站恢复，返回恢复到的列表 */
  restoreTrash(entryId: string): ListId | null;
  purgeTrashEntry(entryId: string): void;
  emptyTrash(): void;
  rename(id: string, title: string): void;
  setCollapsed(id: string, collapsed: boolean): void;
}

/** 切换 profile 期间不接受新的切换 */
let switching = false;

export const useData = create<DataStore>((set, get) => ({
  loaded: false,
  profileId: DEFAULT_PROFILE_ID,
  profiles: [],
  settings: DEFAULT_SETTINGS,
  todos: [],
  prefs: DEFAULT_PREFS,
  trash: [],

  async init() {
    let pd = parseProfiles(await loadProfiles());
    const firstProfileRun = !pd;
    if (!pd) {
      // 第一次启用 profile：原来的数据就是"默认" profile
      pd = {
        version: 1,
        activeId: DEFAULT_PROFILE_ID,
        profiles: [{ id: DEFAULT_PROFILE_ID, name: '默认', createdAt: Date.now() }],
        settings: DEFAULT_SETTINGS,
      };
    }
    const raw = await loadData(pd.activeId);
    // 提示音原来存在数据文件里，迁移成全局设置
    const legacySound = (raw as { prefs?: { sound?: unknown } } | null)?.prefs?.sound;
    if (firstProfileRun && typeof legacySound === 'boolean') pd.settings = { ...pd.settings, sound: legacySound };

    let content = parseContent(raw);
    const seeded = !content && firstProfileRun && pd.activeId === DEFAULT_PROFILE_ID;
    if (!content) content = seeded ? { ...emptyContent(), todos: seedTodos(Date.now()) } : emptyContent();

    set({ loaded: true, profileId: pd.activeId, profiles: pd.profiles, settings: pd.settings, ...content });
    if (firstProfileRun) void saveProfiles(profilesSnapshot());
    if (!raw) void saveData(pd.activeId, snapshot());
  },

  setPrefs(p) {
    set({ prefs: { ...get().prefs, ...p } });
  },

  setSettings(p) {
    set({ settings: { ...get().settings, ...p } });
    void saveProfiles(profilesSnapshot());
  },

  async switchProfile(id) {
    if (switching || id === get().profileId || !get().profiles.some((p) => p.id === id)) return;
    switching = true;
    try {
      await flushSave();
      const raw = await loadData(id);
      const content = parseContent(raw) ?? emptyContent();
      // 只属于上一个 profile 的界面状态一并清掉
      useUi.getState().set({
        editingId: null,
        addingChildOf: null,
        completing: {},
        menu: null,
        toast: null,
        trashOpen: false,
        dragOverTab: null,
      });
      set({ profileId: id, ...content });
      void saveProfiles(profilesSnapshot());
      if (!raw) void saveData(id, snapshot());
    } finally {
      switching = false;
    }
  },

  async createProfile(name) {
    const clean = cleanName(name);
    if (!clean) return null;
    const profile: Profile = { id: newId(), name: clean, createdAt: Date.now() };
    set({ profiles: [...get().profiles, profile] });
    await saveData(profile.id, { version: 1, ...emptyContent() });
    await get().switchProfile(profile.id);
    return profile.id;
  },

  renameProfile(id, name) {
    const clean = cleanName(name);
    if (!clean) return;
    set({ profiles: get().profiles.map((p) => (p.id === id ? { ...p, name: clean } : p)) });
    void saveProfiles(profilesSnapshot());
  },

  async deleteProfile(id) {
    const { profiles, profileId } = get();
    if (profiles.length <= 1) return;
    const idx = profiles.findIndex((p) => p.id === id);
    if (idx < 0) return;
    if (id === profileId) {
      await get().switchProfile(profiles[idx + 1]?.id ?? profiles[idx - 1].id);
      if (get().profileId === id) return; // 没切成功就不删
    }
    set({ profiles: get().profiles.filter((p) => p.id !== id) });
    await saveProfiles(profilesSnapshot());
    await archiveProfile(id);
  },

  add(title, list, parentId = null) {
    if (!title.trim()) return null;
    const id = newId();
    set({ todos: M.createTodo(get().todos, { id, title, list, parentId, now: Date.now() }) });
    return id;
  },

  complete(id) {
    const r = M.completeTodo(get().todos, id, Date.now());
    set({ todos: r.todos });
    return r.movedTo;
  },

  uncomplete(id) {
    set({ todos: M.uncompleteTodo(get().todos, id) });
  },

  move(id, list) {
    set({ todos: M.moveTodo(get().todos, id, list) });
  },

  markForTest(id) {
    set({ todos: M.markForTest(get().todos, id) });
  },

  unmarkTest(id) {
    set({ todos: M.unmarkTest(get().todos, id) });
  },

  reorder(id, toIndex) {
    set({ todos: M.reorderTodo(get().todos, id, toIndex) });
  },

  remove(id) {
    const now = Date.now();
    const { todos, entry } = trashSubtree(get().todos, id, now, newId());
    if (!entry) return null;
    set({ todos, trash: purgeTrash([entry, ...get().trash], now) });
    return entry.id;
  },

  restoreTrash(entryId) {
    const entry = get().trash.find((e) => e.id === entryId);
    if (!entry) return null;
    const todos = restoreEntry(get().todos, entry);
    set({ todos, trash: get().trash.filter((e) => e.id !== entryId) });
    return todos.find((t) => t.id === entry.rootId)?.list ?? null;
  },

  purgeTrashEntry(entryId) {
    set({ trash: get().trash.filter((e) => e.id !== entryId) });
  },

  emptyTrash() {
    set({ trash: [] });
  },

  rename(id, title) {
    set({ todos: M.renameTodo(get().todos, id, title) });
  },

  setCollapsed(id, collapsed) {
    set({ todos: M.setCollapsed(get().todos, id, collapsed) });
  },
}));

// ---------- 持久化：改动后稍等合并写盘，关闭前同步落盘 ----------

let saveTimer: ReturnType<typeof setTimeout> | null = null;

const snapshot = (): AppData => {
  const { todos, prefs, trash } = useData.getState();
  return { version: 1, todos, prefs, trash };
};

const profilesSnapshot = (): ProfilesData => {
  const { profileId, profiles, settings } = useData.getState();
  return { version: 1, activeId: profileId, profiles, settings };
};

/** 立即写入还没落盘的改动（切换 profile 前用） */
async function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  await saveData(useData.getState().profileId, snapshot());
}

useData.subscribe((s, prev) => {
  if (!s.loaded || !prev.loaded) return;
  // 切换 profile 时载入的是别人的数据，不算改动
  if (s.profileId !== prev.profileId) return;
  if (s.todos === prev.todos && s.prefs === prev.prefs && s.trash === prev.trash) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveData(useData.getState().profileId, snapshot());
  }, 250);
});

window.addEventListener('beforeunload', () => {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  saveDataSync(useData.getState().profileId, snapshot());
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
