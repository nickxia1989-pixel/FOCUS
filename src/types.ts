export type ListId = 'focus' | 'inbox' | 'goal';

export interface ListMeta {
  id: ListId;
  label: string;
  placeholder: string;
  empty: string;
}

export const LISTS: ListMeta[] = [
  { id: 'focus', label: 'FOCUS', placeholder: '现在要做的事…', empty: '专注当下。\n从 INBOX 挑一件事放进来吧。' },
  { id: 'inbox', label: 'INBOX', placeholder: '想到什么，先丢进来…', empty: '脑子清空了。\n想到什么随手记下来。' },
  { id: 'goal', label: 'GOAL', placeholder: '一个长期目标…', empty: '写下一个长期目标，\n再把它拆成小步骤。' },
];

export const LIST_IDS: ListId[] = LISTS.map((l) => l.id);

export interface Todo {
  id: string;
  title: string;
  done: boolean;
  list: ListId;
  /** 父 TODO 的 id；顶层为 null。子 TODO 的 list 总是与父相同 */
  parentId: string | null;
  createdAt: number;
  completedAt: number | null;
  /** 手动排序键，越大越靠前；新建时取创建时间 */
  order: number;
  /** 子 TODO 是否折叠 */
  collapsed?: boolean;
}

export interface Prefs {
  activeList: ListId;
  sound: boolean;
  /** 各列表"已完成"分组是否折叠 */
  doneCollapsed: Partial<Record<ListId, boolean>>;
}

export interface AppData {
  version: 1;
  todos: Todo[];
  prefs: Prefs;
}
