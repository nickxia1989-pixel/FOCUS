// 桌面界面上各列表的文案和配色（设计 F「一件事」）。iOS 版用 src/types.ts 里的 LISTS，互不影响
import type { ListId, ViewId } from '../types';

export interface ViewCopy {
  id: ViewId;
  /** 英文名，Bricolage 显示 */
  en: string;
  /** 中文副标 */
  cn: string;
  placeholder: string;
  /** 空状态：大标题 + 一句话 */
  emptyTitle: string;
  emptyText: string;
}

export const VIEW_COPY: Record<ViewId, ViewCopy> = {
  focus: {
    id: 'focus',
    en: 'FOCUS',
    cn: '当下要做',
    placeholder: '接下来要做…',
    emptyTitle: 'Nothing now.',
    emptyText: 'FOCUS 空了。从 INBOX 挑一件当「现在」，或者写下此刻最要紧的那件事。',
  },
  verify: {
    id: 'verify',
    en: 'VERIFY',
    cn: '做完待测',
    placeholder: '做完了、还要测一下的事…',
    emptyTitle: 'All checked.',
    emptyText: '做完但还要再看一眼的事会出现在这里。测完勾掉，它会进 INBOX 的已完成。',
  },
  inbox: {
    id: 'inbox',
    en: 'INBOX',
    cn: '随手记',
    placeholder: '想到什么，先丢进来…',
    emptyTitle: 'Inbox zero.',
    emptyText: '脑子清空了。想到什么先丢进来，要做的时候点星芒送进 FOCUS。',
  },
  goal: {
    id: 'goal',
    en: 'GOAL',
    cn: '长期目标',
    placeholder: '一个长期目标…',
    emptyTitle: 'Dream big.',
    emptyText: '写下一个长期目标，提醒自己往哪儿走。做到了再自己勾掉。',
  },
  history: {
    id: 'history',
    en: 'HISTORY',
    cn: '完成记录',
    placeholder: '',
    emptyTitle: 'Not yet.',
    emptyText: '还没有完成记录。完成的事会按天出现在这里。',
  },
};

export const listName = (list: ListId) => VIEW_COPY[list].en;

/** 列表色（行的勾选圈、圆点）。FOCUS 用正文色，荧光绿只给 NOW */
export const LIST_COLOR: Record<ViewId, string> = {
  focus: 'var(--tx)',
  verify: 'var(--verify)',
  inbox: 'var(--inbox)',
  goal: 'var(--goal)',
  history: 'var(--hist)',
};

/** 列表的浅色底（悬停、选中） */
export const LIST_SOFT: Record<ViewId, string> = {
  focus: 'var(--hi)',
  verify: 'var(--verify-s)',
  inbox: 'var(--inbox-s)',
  goal: 'var(--goal-s)',
  history: 'var(--hist-s)',
};

/** 页签胶囊选中时的图标色（浅色：近黑底上），深色模式下是选中底色 */
export const LIST_ON: Record<ViewId, string> = {
  focus: 'var(--lime)',
  verify: '#B8A6FF',
  inbox: '#8FD3FF',
  goal: '#FF8A65',
  history: '#F2E2B8',
};
