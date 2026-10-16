export type ListId = 'focus' | 'verify' | 'inbox' | 'goal';

export interface ListMeta {
  id: ListId;
  label: string;
  /** 页签上的中文说明（悬停提示） */
  hint: string;
  placeholder: string;
  empty: string;
}

export const LISTS: ListMeta[] = [
  {
    id: 'focus',
    label: 'FOCUS',
    hint: '当下要做',
    placeholder: '现在要做的事…',
    empty: '专注当下。\n从 INBOX 挑一件事放进来吧。',
  },
  {
    id: 'verify',
    label: 'VERIFY',
    hint: '待测',
    placeholder: '等着测试的事…',
    empty: '做完但还要测的，会出现在这里。\n测完勾掉，它会回到 INBOX 的已完成。',
  },
  {
    id: 'inbox',
    label: 'INBOX',
    hint: '随手记',
    placeholder: '想到什么，先丢进来…',
    empty: '脑子清空了。\n想到什么随手记下来。',
  },
  {
    id: 'goal',
    label: 'GOAL',
    hint: '长期目标',
    placeholder: '一个长期目标…',
    empty: '写下一个长期目标，\n再把它拆成小步骤。',
  },
];

export const LIST_IDS: ListId[] = LISTS.map((l) => l.id);

/** 顶层项在这些列表里完成后，会自动移到 INBOX 的已完成 */
export const COMPLETE_TO_INBOX: ReadonlySet<ListId> = new Set(['focus', 'verify']);

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
  /** 原地标为待测（子项用：留在父项下，不换页签；顶层项标待测则直接进 VERIFY） */
  testing?: boolean;
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
