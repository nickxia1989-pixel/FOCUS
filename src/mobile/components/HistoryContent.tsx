// HISTORY：按日期回看哪天完成了哪些事
import { useMemo, useRef } from 'react';
import { startOfToday } from '../../model';
import { LISTS, type Todo } from '../../types';
import { DAY, historyDays, recentCounts, streak, type HistoryDay, type HistoryItem } from '../data';
import { HistoryIcon, SectionIcons } from '../icons';
import { useTodos } from '../store';
import { rectOf, useUi } from '../ui';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const pad = (n: number) => String(n).padStart(2, '0');

export function dayTitle(day: number, now: number) {
  const today = startOfToday(now);
  if (day === today) return '今天';
  if (day === startOfToday(today - DAY / 2)) return '昨天';
  const d = new Date(day);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return `${sameYear ? '' : `${d.getFullYear()}年`}${d.getMonth() + 1}月${d.getDate()}日`;
}

export function HistoryContent() {
  const todos = useTodos();
  // 跨过零点后重新渲染时会刷新
  const now = useMemo(() => Date.now(), [todos]);
  const days = useMemo(() => historyDays(todos), [todos]);
  const sectionRefs = useRef(new Map<number, HTMLElement>());

  if (days.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">
          <HistoryIcon width={30} height={30} />
        </div>
        <p>{'完成的事会按日期记在这里。\n去勾掉第一件吧。'}</p>
      </div>
    );
  }

  const jump = (day: number) => {
    sectionRefs.current.get(day)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="history">
      {/* 双页布局时统计挪到右页（Companion），这里藏起来 */}
      <StatsCard todos={todos} now={now} days={days} onJump={jump} className="history-stats" />
      {days.map((d) => (
        <DaySection
          key={d.day}
          day={d}
          now={now}
          ref={(el) => {
            if (el) sectionRefs.current.set(d.day, el);
            else sectionRefs.current.delete(d.day);
          }}
        />
      ))}
    </div>
  );
}

/** 今天 / 近 7 天 / 连续天数，加 7 天柱状图（点柱子跳到那天） */
export function StatsCard({
  todos,
  now,
  days,
  onJump,
  className = '',
}: {
  todos: Todo[];
  now: number;
  days: HistoryDay[];
  onJump(day: number): void;
  className?: string;
}) {
  const recent = useMemo(() => recentCounts(todos, now, 7), [todos, now]);
  const run = useMemo(() => streak(todos, now), [todos, now]);
  const max = Math.max(1, ...recent.map((d) => d.count));
  const today = recent[recent.length - 1]?.count ?? 0;
  const week = recent.reduce((s, d) => s + d.count, 0);
  return (
    <div className={`card stats ${className}`} data-anchor="stats">
      <div className="stats-nums">
        <Stat value={today} label="今天" />
        <Stat value={week} label="近 7 天" />
        <Stat value={run} label="连续天数" />
      </div>
      <div className="bars" role="list" aria-label="近 7 天每天完成数">
        {recent.map((d) => {
          const isToday = d.day === startOfToday(now);
          const has = days.some((x) => x.day === d.day);
          return (
            <button
              key={d.day}
              role="listitem"
              className={`bar ${isToday ? 'is-today' : ''}`}
              disabled={!has}
              aria-label={`${dayTitle(d.day, now)} 完成 ${d.count} 项`}
              onClick={() => onJump(d.day)}
            >
              <span className="bar-count">{d.count || ''}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ height: `${(d.count / max) * 100}%` }} />
              </span>
              <span className="bar-label">{isToday ? '今' : WEEK[new Date(d.day).getDay()]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 一天的完成记录：日期标题 + 卡片 */
export function DaySection({ day: d, now, ref }: { day: HistoryDay; now: number; ref?: React.Ref<HTMLElement> }) {
  return (
    <section className="history-day" ref={ref}>
      <h2 className="day-head" data-anchor={`day-${d.day}`}>
        <span className="day-title">{dayTitle(d.day, now)}</span>
        <span className="day-week">周{WEEK[new Date(d.day).getDay()]}</span>
        <span className="day-count">{d.total} 项</span>
      </h2>
      <div className="card">
        {d.items.map((it) => (
          <HistoryRow key={it.todo.id} item={it} />
        ))}
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export function HistoryRow({ item }: { item: HistoryItem }) {
  const { todo, path, folded } = item;
  const ref = useRef<HTMLButtonElement>(null);
  const meta = LISTS.find((l) => l.id === todo.list)!;
  const Icon = SectionIcons[todo.list];
  const t = new Date(todo.completedAt!);
  const open = () => {
    if (ref.current) useUi.getState().set({ menu: { todoId: todo.id, rect: rectOf(ref.current), from: 'history' } });
  };
  return (
    <button ref={ref} className="h-row" data-node-id={todo.id} data-anchor={todo.id} onClick={open}>
      <span className="h-check">
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="m6.5 12.5 3.7 3.7 7.4-8" />
        </svg>
      </span>
      <span className="h-main">
        <span className="h-title">{todo.title}</span>
        {(todo.list !== 'inbox' || path.length > 0 || folded > 0) && (
          <span className="h-meta">
            {/* FOCUS / VERIFY 的顶层项完成后都落在 INBOX，标出来没有信息量 */}
            {todo.list !== 'inbox' && (
              <span className="h-list" style={{ color: `var(--c-${todo.list})` }}>
                <Icon width={12} height={12} />
                {meta.label}
              </span>
            )}
            {path.length > 0 && <span className="h-path">{path.join(' › ')}</span>}
            {folded > 0 && <span className="h-folded">含 {folded} 个子项</span>}
          </span>
        )}
      </span>
      <span className="h-time">
        {pad(t.getHours())}:{pad(t.getMinutes())}
      </span>
    </button>
  );
}
