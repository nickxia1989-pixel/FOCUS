// 主屏小组件要显示的数据：从各空间的 todos 派生出一份精简快照。
// 由 widget.ts 写进 App Group，小组件（ios/App/FocusWidget/）只读这份 JSON，不碰同步文档的结构。
// NOW = FOCUS 里手动顺序排第一的未完成顶层项（../model 的 nowOf），其余按顺序是 NEXT。
import { countSince, countsByDay, dayStart, streak } from '../history';
import { buildIndex, childrenOf, rootsOf, type TreeIndex } from '../model';
import type { Todo } from '../types';
import type { Profile } from './data';

/** NEXT 最多带几条：大号只放得下 4 条，再多的只计数（「+N」） */
export const WIDGET_NEXT_LIMIT = 8;
/** NOW 卡上最多列几条子任务 */
export const WIDGET_SUB_LIMIT = 3;
/** FOCUS 空了时列出 INBOX 最上面几条 */
export const WIDGET_INBOX_LIMIT = 3;
const TITLE_MAX = 120;

export interface WidgetItem {
  id: string;
  title: string;
  /** 直接子任务的完成数 / 总数；没有子任务时都是 0 */
  subDone: number;
  subTotal: number;
}

export interface WidgetNow extends WidgetItem {
  /** 前几条直接子任务，未完成的在前（和 App 里的顺序一样） */
  subs: { title: string; done: boolean }[];
}

export interface WidgetProfile {
  id: string;
  name: string;
  /** 头像颜色的序号，小组件按定稿的空间头像配色取 */
  tint: number;
  /** 现在这一件；FOCUS 空了为 null */
  now: WidgetNow | null;
  /** NOW 之后的前 WIDGET_NEXT_LIMIT 件 */
  next: WidgetItem[];
  /** FOCUS 里未完成的顶层项总数（含 NOW），即「1/5」的 5 */
  open: number;
  /** INBOX 最上面几件未完成的顶层项（FOCUS 空了时给用户挑） */
  inbox: WidgetItem[];
  /** INBOX 未完成的顶层项总数 */
  inboxOpen: number;
  /** 今天完成的数量（含子任务，和 HISTORY 一致） */
  doneToday: number;
  /** 连续完成天数（../history 的 streak：今天还没完成时从昨天往回数） */
  streak: number;
}

export interface WidgetSnapshot {
  version: 2;
  /** App 当前所在的空间；小组件选「跟随 App」时显示它 */
  activeId: string;
  /** 写入那天的 0 点（本地时间）。过了这一天还没新数据，小组件自己把今天完成数清零、推算连续天数 */
  day: number;
  profiles: WidgetProfile[];
}

const cleanTitle = (title: string) => {
  const one = title.replace(/\s+/g, ' ').trim();
  return one.length > TITLE_MAX ? `${one.slice(0, TITLE_MAX - 1)}…` : one;
};

function item(index: TreeIndex, t: Todo): WidgetItem {
  const kids = childrenOf(index, t.id);
  return { id: t.id, title: cleanTitle(t.title), subDone: kids.filter((k) => k.done).length, subTotal: kids.length };
}

export function widgetProfile(p: Profile, now: number): WidgetProfile {
  const index = buildIndex(p.todos);
  const focus = rootsOf(index, 'focus').filter((t) => !t.done);
  const inbox = rootsOf(index, 'inbox').filter((t) => !t.done);
  const counts = countsByDay(p.todos);
  const first = focus[0];
  return {
    id: p.id,
    name: p.name,
    tint: p.tint,
    now: first
      ? {
          ...item(index, first),
          subs: childrenOf(index, first.id)
            .slice(0, WIDGET_SUB_LIMIT)
            .map((k) => ({ title: cleanTitle(k.title), done: k.done })),
        }
      : null,
    next: focus.slice(1, 1 + WIDGET_NEXT_LIMIT).map((t) => item(index, t)),
    open: focus.length,
    inbox: inbox.slice(0, WIDGET_INBOX_LIMIT).map((t) => item(index, t)),
    inboxOpen: inbox.length,
    doneToday: countSince(counts, dayStart(now)),
    streak: streak(counts, now),
  };
}

export function widgetSnapshot(profiles: Profile[], activeId: string, now: number): WidgetSnapshot {
  return { version: 2, activeId, day: dayStart(now), profiles: profiles.map((p) => widgetProfile(p, now)) };
}
