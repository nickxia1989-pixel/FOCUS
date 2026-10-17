// HISTORY：今天 / 近 7 天 / 连续天数，近 7 天柱状图（双页时换成 16 周热力图），按天分组的完成记录
import { useMemo, useRef } from 'react';
import { startOfToday } from '../../model';
import { LISTS, type ListId, type Todo } from '../../types';
import { DAY, historyDays, originList, recentCounts, streak, type HistoryDay, type HistoryItem } from '../data';
import { useTodos } from '../store';
import { rectOf, useUi } from '../ui';
import { Panes } from './Chrome';
import { Empty } from './Empty';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const pad = (n: number) => String(n).padStart(2, '0');
const labelOf = (l: ListId) => LISTS.find((x) => x.id === l)!.label;

export function dayTitle(day: number, now: number) {
  const today = startOfToday(now);
  if (day === today) return '今天';
  if (day === startOfToday(today - DAY / 2)) return '昨天';
  return `周${WEEK[new Date(day).getDay()]}`;
}

function dayLine(day: number, now: number) {
  const d = new Date(day);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return `${sameYear ? '' : `${d.getFullYear()}年`}${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}`;
}

/** 让 HISTORY 列表滚到某一天（在哪一页就滚哪一页） */
export function jumpToDay(day: number) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelector(`[data-anchor="day-${day}"]`)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

/** 三格统计：今天 / 近 7 天 / 连续天数 */
export function Stats({
  todos,
  now,
  hiToday,
  labels,
}: {
  todos: Todo[];
  now: number;
  hiToday?: boolean;
  labels?: [string, string, string];
}) {
  const recent = useMemo(() => recentCounts(todos, now, 7), [todos, now]);
  const run = useMemo(() => streak(todos, now), [todos, now]);
  const today = recent[recent.length - 1]?.count ?? 0;
  const week = recent.reduce((s, d) => s + d.count, 0);
  const [a, b, c] = labels ?? ['今天', '近 7 天', '连续天数'];
  return (
    <div className="stats">
      <div className={`st ${hiToday ? 'hi' : ''}`}>
        <b>{today}</b>
        <span>{a}</span>
      </div>
      <div className="st">
        <b>{week}</b>
        <span>{b}</span>
      </div>
      <div className="st">
        <b>{run}</b>
        <span>{c}</span>
      </div>
    </div>
  );
}

/** 近 7 天柱状图（今天荧光绿），点柱子跳到那天 */
function WeekBars({ todos, now, days }: { todos: Todo[]; now: number; days: HistoryDay[] }) {
  const recent = useMemo(() => recentCounts(todos, now, 7), [todos, now]);
  const max = Math.max(1, ...recent.map((d) => d.count));
  const today = startOfToday(now);
  return (
    <div className="week only-compact">
      <div className="week-hd">
        <span>最近 7 天</span>
        <span>点柱子跳到那天</span>
      </div>
      <div className="bars" role="list" aria-label="近 7 天每天完成数">
        {recent.map((d) => {
          const has = days.some((x) => x.day === d.day);
          return (
            <button
              key={d.day}
              role="listitem"
              className={`bar ${d.day === today ? 'on' : ''}`}
              disabled={!has}
              aria-label={`${dayLine(d.day, now)} 完成 ${d.count} 件`}
              onClick={() => jumpToDay(d.day)}
            >
              <i style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }} />
              {d.day === today ? '今' : WEEK[new Date(d.day).getDay()]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 16 周热力图（双页的左页），点一天右页跳到那天 */
function Heatmap({ todos, now, days }: { todos: Todo[]; now: number; days: HistoryDay[] }) {
  const cells = useMemo(() => {
    const today = startOfToday(now);
    const counts = new Map<number, number>();
    for (const t of todos) {
      if (!t.done || t.completedAt === null) continue;
      const d = startOfToday(t.completedAt);
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    // 最后一列以今天所在的那一周结束（周一起），今天之后的格子留空
    const weekday = (new Date(today).getDay() + 6) % 7;
    const start = startOfToday(today - (15 * 7 + weekday) * DAY + DAY / 2);
    const out: { day: number; cls: string }[] = [];
    for (let i = 0; i < 16 * 7; i++) {
      const day = startOfToday(start + i * DAY + DAY / 2);
      const n = counts.get(day) ?? 0;
      const lv = n === 0 ? '' : n === 1 ? 'l1' : n <= 3 ? 'l2' : n <= 5 ? 'l3' : 'l4';
      out.push({ day, cls: [lv, day === today && 't', day > today && 'f'].filter(Boolean).join(' ') });
    }
    return out;
  }, [todos, now]);
  const has = new Set(days.map((d) => d.day));
  return (
    <div className="week only-spread">
      <div className="week-hd">
        <span>最近 16 周</span>
        <span>点一天，右页跳到那天</span>
      </div>
      <div className="heat">
        {cells.map((c) => (
          <i key={c.day} className={c.cls} onClick={() => has.has(c.day) && jumpToDay(c.day)} />
        ))}
      </div>
    </div>
  );
}

/** 按天分组的完成记录 */
export function DayGroups({ days, now }: { days: HistoryDay[]; now: number }) {
  const todos = useTodos();
  const byId = useMemo(() => new Map(todos.map((t) => [t.id, t])), [todos]);
  return (
    <>
      {days.map((d) => (
        <section key={d.day} className="history-day">
          <h2 className="day" data-anchor={`day-${d.day}`}>
            <b>{dayTitle(d.day, now)}</b>
            {dayLine(d.day, now)} · {d.total} 件
          </h2>
          {d.items.map((it) => (
            <HistoryRow key={it.todo.id} item={it} origin={originList(it.todo, byId)} />
          ))}
        </section>
      ))}
    </>
  );
}

function HistoryRow({ item, origin }: { item: HistoryItem; origin: ListId }) {
  const { todo, path, folded } = item;
  const ref = useRef<HTMLButtonElement>(null);
  const t = new Date(todo.completedAt!);
  const open = () => {
    if (ref.current) useUi.getState().set({ menu: { todoId: todo.id, rect: rectOf(ref.current), from: 'history' } });
  };
  const sub = [
    path.length
      ? `${path.join(' › ')} › 子项`
      : origin === 'verify' || origin === 'goal'
        ? `在 ${labelOf(origin)} 完成`
        : '',
    folded > 0 ? `含 ${folded} 个子项` : '',
  ].filter(Boolean);
  return (
    <button
      ref={ref}
      className="hr"
      data-node-id={todo.id}
      data-anchor={todo.id}
      style={{ '--c': `var(--c-${origin})` } as React.CSSProperties}
      onClick={open}
    >
      <time>
        {pad(t.getHours())}:{pad(t.getMinutes())}
      </time>
      <span className="hr-dot" />
      <span className="hr-text">
        {todo.title}
        {sub.length > 0 && <small>{sub.join(' · ')}</small>}
      </span>
    </button>
  );
}

export function HistoryContent() {
  const todos = useTodos();
  // 跨过零点后重新渲染时会刷新
  const now = useMemo(() => Date.now(), [todos]);
  const days = useMemo(() => historyDays(todos), [todos]);

  if (days.length === 0) return <Panes section="history" left={<Empty section="history" />} />;

  return (
    <Panes
      section="history"
      left={
        <>
          <Stats todos={todos} now={now} hiToday />
          <WeekBars todos={todos} now={now} days={days} />
          <Heatmap todos={todos} now={now} days={days} />
        </>
      }
      right={<DayGroups days={days} now={now} />}
    />
  );
}
