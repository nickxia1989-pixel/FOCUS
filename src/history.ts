// 完成记录：按天分组、热力图、连续天数。纯函数，便于测试
import type { Todo } from './types';

/** 某个时间所在那天的 0 点（本地时区） */
export function dayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 从 day 起第 n 天的 0 点；用日历加减，避开夏令时 */
export function addDays(day: number, n: number): number {
  const d = new Date(day);
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 所在周的周一 0 点 */
export function weekStart(t: number): number {
  const day = dayStart(t);
  const dow = (new Date(day).getDay() + 6) % 7;
  return addDays(day, -dow);
}

export interface HistoryItem {
  todo: Todo;
  /** 同一天一起完成的子项挂在父项下面 */
  children: HistoryItem[];
  /** 父项没在当天完成时，显示父项标题作为上下文 */
  parentTitle: string | null;
}

export interface HistoryDay {
  /** 当天 0 点 */
  day: number;
  /** 当天完成的条目数（含子项） */
  count: number;
  items: HistoryItem[];
}

const isCompleted = (t: Todo): t is Todo & { completedAt: number } => t.done && t.completedAt !== null;

const byCompletion = (a: HistoryItem, b: HistoryItem) =>
  b.todo.completedAt! - a.todo.completedAt! || b.todo.order - a.todo.order;

/** 已完成的条目按完成日期分组，新的日期在前 */
export function groupByDay(todos: Todo[]): HistoryDay[] {
  const byId = new Map(todos.map((t) => [t.id, t]));
  const buckets = new Map<number, Todo[]>();
  for (const t of todos) {
    if (!isCompleted(t)) continue;
    const key = dayStart(t.completedAt);
    const arr = buckets.get(key);
    if (arr) arr.push(t);
    else buckets.set(key, [t]);
  }

  const days: HistoryDay[] = [];
  for (const [day, list] of buckets) {
    const items = new Map<string, HistoryItem>();
    for (const t of list) items.set(t.id, { todo: t, children: [], parentTitle: null });
    const roots: HistoryItem[] = [];
    for (const item of items.values()) {
      const pid = item.todo.parentId;
      const parentItem = pid ? items.get(pid) : undefined;
      if (parentItem) parentItem.children.push(item);
      else {
        if (pid) item.parentTitle = byId.get(pid)?.title ?? null;
        roots.push(item);
      }
    }
    const sortDeep = (arr: HistoryItem[]) => {
      arr.sort(byCompletion);
      for (const i of arr) sortDeep(i.children);
    };
    sortDeep(roots);
    days.push({ day, count: list.length, items: roots });
  }
  return days.sort((a, b) => b.day - a.day);
}

/** 每天完成数：当天 0 点 → 数量 */
export function countsByDay(todos: Todo[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const t of todos) {
    if (!isCompleted(t)) continue;
    const key = dayStart(t.completedAt);
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return m;
}

export interface HeatCell {
  day: number;
  count: number;
  /** 0 没有，1～4 由浅到深 */
  level: 0 | 1 | 2 | 3 | 4;
  future: boolean;
}

/** 最近 weeks 周的热力图，按列（周一到周日）排，最后一列是本周 */
export function heatmap(counts: Map<number, number>, now: number, weeks: number): HeatCell[][] {
  const today = dayStart(now);
  const first = addDays(weekStart(now), -(weeks - 1) * 7);
  const max = Math.max(1, ...[...counts].filter(([d]) => d >= first && d <= today).map(([, n]) => n));
  const cols: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(first, w * 7 + i);
      const count = counts.get(day) ?? 0;
      const level = count === 0 ? 0 : (Math.min(4, Math.ceil((count / max) * 4)) as 1 | 2 | 3 | 4);
      col.push({ day, count, level, future: day > today });
    }
    cols.push(col);
  }
  return cols;
}

/** 连续完成天数：今天还没完成时从昨天往回数，不算断 */
export function streak(counts: Map<number, number>, now: number): number {
  let day = dayStart(now);
  if (!counts.get(day)) day = addDays(day, -1);
  let n = 0;
  while (counts.get(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

export function countSince(counts: Map<number, number>, since: number): number {
  let n = 0;
  for (const [day, c] of counts) if (day >= since) n += c;
  return n;
}
