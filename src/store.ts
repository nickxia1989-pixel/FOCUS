import { create } from 'zustand';
import * as M from './model';
import { loadData, saveData, saveDataSync } from './platform';
import { LIST_IDS, type AppData, type ListId, type Prefs, type Todo } from './types';

const DEFAULT_PREFS: Prefs = { activeList: 'focus', sound: true, doneCollapsed: {} };

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
  add('拖动条目可以排序；拖到顶部页签上可以移到那个列表', 'inbox', null, 2);
  add('点右边的 ◎ 按钮，把这条一键送进 FOCUS', 'inbox', null, 3);
  const g = add('写下一个长期目标', 'goal', null, 4);
  add('点 + 把它拆成小步骤', 'goal', g, 5);
  add('做完但还要测试？点右边的烧瓶，把它送进 VERIFY 待测', 'focus', null, 6);
  add('勾选完成，体验一下完成动画 ✦', 'focus', null, 7);
  return s;
}

interface DataStore {
  loaded: boolean;
  dataPath: string;
  todos: Todo[];
  prefs: Prefs;
  init(): Promise<void>;
  setPrefs(p: Partial<Prefs>): void;
  add(title: string, list: ListId, parentId?: string | null): string | null;
  complete(id: string): ListId | null;
  uncomplete(id: string): void;
  move(id: string, list: ListId): void;
  reorder(id: string, toIndex: number): void;
  remove(id: string): Todo[];
  restore(todos: Todo[]): void;
  rename(id: string, title: string): void;
  setCollapsed(id: string, collapsed: boolean): void;
}

export const useData = create<DataStore>((set, get) => ({
  loaded: false,
  dataPath: '',
  todos: [],
  prefs: DEFAULT_PREFS,

  async init() {
    const raw = (await loadData()) as Partial<AppData> | null;
    if (raw && typeof raw === 'object') {
      const prefs = { ...DEFAULT_PREFS, ...(raw.prefs ?? {}) };
      if (!LIST_IDS.includes(prefs.activeList)) prefs.activeList = 'focus';
      set({ loaded: true, todos: M.sanitize(raw.todos), prefs });
    } else {
      set({ loaded: true, todos: seedTodos(Date.now()), prefs: DEFAULT_PREFS });
      void saveData(snapshot());
    }
  },

  setPrefs(p) {
    set({ prefs: { ...get().prefs, ...p } });
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

  reorder(id, toIndex) {
    set({ todos: M.reorderTodo(get().todos, id, toIndex) });
  },

  remove(id) {
    const before = get().todos;
    set({ todos: M.deleteTodo(before, id) });
    return before;
  },

  restore(todos) {
    set({ todos });
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
  const { todos, prefs } = useData.getState();
  return { version: 1, todos, prefs };
};

useData.subscribe((s, prev) => {
  if (!s.loaded || !prev.loaded) return;
  if (s.todos === prev.todos && s.prefs === prev.prefs) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveData(snapshot());
  }, 250);
});

window.addEventListener('beforeunload', () => {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  saveDataSync(snapshot());
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
  undo?: Todo[];
}

interface UiStore {
  editingId: string | null;
  addingChildOf: string | null;
  /** 正在播放完成动画、还没写入数据的项 */
  completing: Record<string, true>;
  menu: MenuState | null;
  toast: ToastState | null;
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
  tabPulse: { focus: 0, verify: 0, inbox: 0, goal: 0 },
  dragOverTab: null,
  set: (p) => set(p),
}));

export function pulseTab(list: ListId) {
  const cur = useUi.getState().tabPulse;
  useUi.getState().set({ tabPulse: { ...cur, [list]: cur[list] + 1 } });
}

let toastKey = 0;
export function showToast(text: string, undo?: Todo[]) {
  useUi.getState().set({ toast: { key: ++toastKey, text, undo } });
}
