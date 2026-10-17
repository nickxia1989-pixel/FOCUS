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

/** 侧边栏上的分区：四个列表 + 完成记录 */
export type ViewId = ListId | 'history';

export const VIEW_IDS: ViewId[] = [...LIST_IDS, 'history'];

export const HISTORY_META = {
  id: 'history' as const,
  label: 'HISTORY',
  hint: '完成记录',
  empty: '还没有完成记录。\n完成的事会按日期出现在这里。',
};

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
  /** 完成时所在的列表（FOCUS / VERIFY 的顶层项完成后会移到 INBOX，这里留下原列表给完成记录用） */
  completedFrom?: ListId;
  /** 手动排序键，越大越靠前；新建时取创建时间 */
  order: number;
  /** 子 TODO 是否折叠 */
  collapsed?: boolean;
  /** 原地标为待测（子项用：留在父项下，不换页签；顶层项标待测则直接进 VERIFY） */
  testing?: boolean;
}

/** 回收站里的一次删除：根条目连同它的子孙 */
export interface TrashEntry {
  id: string;
  deletedAt: number;
  rootId: string;
  /** 删除时根条目的父项与列表，用于恢复到原处 */
  parentId: string | null;
  list: ListId;
  items: Todo[];
}

/** 每个 profile 各自的界面偏好 */
export interface Prefs {
  activeView: ViewId;
  /** 各列表"已完成"分组是否折叠 */
  doneCollapsed: Partial<Record<ListId, boolean>>;
}

/** 一个 profile 的全部数据，存成一个独立文件 */
export interface AppData {
  version: 1;
  todos: Todo[];
  prefs: Prefs;
  trash: TrashEntry[];
}

/** 互相独立的数据空间，例如"工作""生活" */
export interface Profile {
  id: string;
  name: string;
  createdAt: number;
}

/** 所有 profile 共用的设置 */
export interface Settings {
  sound: boolean;
}

/** profile 列表与全局设置，单独存一个文件 */
export interface ProfilesData {
  version: 1;
  activeId: string;
  profiles: Profile[];
  settings: Settings;
}

/** 升级前就有的那份数据归到这个 profile，文件位置不变 */
export const DEFAULT_PROFILE_ID = 'default';
