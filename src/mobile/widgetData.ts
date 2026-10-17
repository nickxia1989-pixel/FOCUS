// 主屏小组件要显示的数据：从各空间的 todos 派生出一份精简快照。
// 由 widget.ts 写进 App Group，小组件（ios/App/FocusWidget/）只读这份 JSON，不碰同步文档的结构。
import { buildIndex, childrenOf, completedSince, openCount, rootsOf, startOfToday } from '../model';
import { PROFILE_TINTS, type Profile } from './data';

/** 每个空间最多带几条：大号小组件一屏也放不下这么多，再多的只计数（「还有 N 条」） */
export const WIDGET_ITEM_LIMIT = 12;
const TITLE_MAX = 120;

export interface WidgetItem {
  id: string;
  title: string;
  /** 直接子任务的完成数 / 总数，和列表里的 `1/3` 胶囊一致；没有子任务时都是 0 */
  subDone: number;
  subTotal: number;
}

export interface WidgetProfile {
  id: string;
  name: string;
  /** 头像颜色 */
  color: string;
  /** FOCUS 里未完成的条数（含子任务），和 App 里 FOCUS 的页头、页签角标一致 */
  open: number;
  /** 未完成的顶层项总数：小组件按行列出的是它们，放不下的算进「还有 N 条」 */
  roots: number;
  /** 前 WIDGET_ITEM_LIMIT 个顶层项，顺序和列表里一样 */
  items: WidgetItem[];
  /** 今天完成的数量（含子任务，和导航栏「今天完成 N 项」一致） */
  doneToday: number;
}

export interface WidgetSnapshot {
  version: 1;
  /** App 当前所在的空间；小组件选「跟随 App」时显示它 */
  activeId: string;
  /** 写入那天的 0 点（本地时间）。过了这一天还没新数据，小组件就把今天完成数当成 0 */
  day: number;
  profiles: WidgetProfile[];
}

const cleanTitle = (title: string) => {
  const one = title.replace(/\s+/g, ' ').trim();
  return one.length > TITLE_MAX ? `${one.slice(0, TITLE_MAX - 1)}…` : one;
};

export function widgetProfile(p: Profile, today: number): WidgetProfile {
  const index = buildIndex(p.todos);
  const roots = rootsOf(index, 'focus').filter((t) => !t.done);
  return {
    id: p.id,
    name: p.name,
    color: PROFILE_TINTS[p.tint] ?? PROFILE_TINTS[0],
    open: openCount(p.todos, 'focus'),
    roots: roots.length,
    items: roots.slice(0, WIDGET_ITEM_LIMIT).map((t) => {
      const kids = childrenOf(index, t.id);
      return { id: t.id, title: cleanTitle(t.title), subDone: kids.filter((k) => k.done).length, subTotal: kids.length };
    }),
    doneToday: completedSince(p.todos, today),
  };
}

export function widgetSnapshot(profiles: Profile[], activeId: string, now: number): WidgetSnapshot {
  const day = startOfToday(now);
  return { version: 1, activeId, day, profiles: profiles.map((p) => widgetProfile(p, day)) };
}
