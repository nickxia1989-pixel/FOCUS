import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { addDays, countSince, countsByDay, groupByDay, heatmap, streak, weekStart, type HistoryItem } from '../history';
import { showToast, useData } from '../store';
import type { Todo } from '../types';
import { LIST_COLOR, VIEW_COPY } from './copy';
import { UndoIcon } from './icons';
import { EmptyState, ListHead } from './ListView';
import { useTodayStart } from './useToday';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const pad = (n: number) => String(n).padStart(2, '0');
const hm = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const weekday = (day: number) => `周${WEEK[new Date(day).getDay()]}`;
const monthDay = (day: number, today: number) => {
  const d = new Date(day);
  const year = d.getFullYear() === new Date(today).getFullYear() ? '' : `${d.getFullYear()}年`;
  return `${year}${d.getMonth() + 1}月${d.getDate()}日`;
};

// 热力图：至少 16 周；窗口宽时格子不超过 24px，多出来的宽度换成更多周
const GAP = 3;
const MAX_CELL = 24;
const MIN_WEEKS = 16;

function Heatmap({ counts, today, onPick }: { counts: Map<number, number>; today: number; onPick(day: number): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [weeks, setWeeks] = useState(MIN_WEEKS);
  const [selected, setSelected] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setWeeks(Math.max(MIN_WEEKS, Math.min(52, Math.floor((w + GAP) / (MAX_CELL + GAP)))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = useMemo(() => heatmap(counts, today, weeks), [counts, today, weeks]);

  return (
    <div className="heat">
      <div className="hd">
        <span>最近 {weeks} 周</span>
        <span>点一天看那天</span>
      </div>
      <div className="hm" ref={ref} style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}>
        {cols.flat().map((c) => (
          <button
            key={c.day}
            className={`l${c.level} ${c.future ? 'fut' : ''} ${c.day === today ? 't' : ''} ${selected === c.day && c.day !== today ? 'sel' : ''}`}
            disabled={c.future || c.count === 0}
            title={c.future ? undefined : `${monthDay(c.day, today)} ${weekday(c.day)} · ${c.count ? `完成 ${c.count} 件` : '没有完成'}`}
            onClick={() => {
              setSelected(c.day);
              onPick(c.day);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function restore(todo: Todo) {
  useData.getState().uncomplete(todo.id);
  showToast(`已恢复为未完成 · ${VIEW_COPY[todo.list].en}`);
}

function HistoryRow({ item }: { item: HistoryItem }) {
  const [open, setOpen] = useState(false);
  const t = item.todo;
  const from = t.completedFrom ?? t.list;
  const kids = item.children;
  const notes: ReactNode[] = [];
  if (item.parentTitle) notes.push(`${item.parentTitle} › 子项`);
  else if (from !== 'focus') notes.push(`在 ${VIEW_COPY[from].en} 完成`);
  if (kids.length)
    notes.push(
      <button key="k" onClick={() => setOpen((v) => !v)} title={open ? '收起子项' : '看看是哪几个'}>
        含 {kids.length} 个子项
      </button>,
    );

  return (
    <>
      <div className="hr" style={{ '--c': LIST_COLOR[from] } as CSSProperties}>
        <time>{hm(t.completedAt!)}</time>
        <i />
        <span className="hx">
          {t.title}
          {notes.length > 0 && (
            <small>
              {notes.map((n, i) => (
                <span key={i}>
                  {i > 0 && ' · '}
                  {n}
                </span>
              ))}
            </small>
          )}
        </span>
        <button className="hundo" title="恢复为未完成" onClick={() => restore(t)}>
          <UndoIcon />
          恢复
        </button>
      </div>
      {open && kids.length > 0 && (
        <ul className="hkids">
          {flatten(kids).map((k) => (
            <li key={k.id}>
              <span>{k.title}</span>
              <button className="hundo" onClick={() => restore(k)}>
                恢复
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const flatten = (items: HistoryItem[]): Todo[] => items.flatMap((i) => [i.todo, ...flatten(i.children)]);

/** HISTORY：今天 / 本周 / 连续天数，热力图，按天分组 */
export function HistoryView() {
  const todos = useData((s) => s.todos);
  const today = useTodayStart();
  const days = useMemo(() => groupByDay(todos), [todos]);
  const counts = useMemo(() => countsByDay(todos), [todos]);
  const rootRef = useRef<HTMLDivElement>(null);

  const stats = [
    { label: '今天', value: counts.get(today) ?? 0, cls: 'f' },
    { label: '本周', value: countSince(counts, weekStart(today)), cls: '' },
    { label: '连续天数', value: streak(counts, today), cls: '' },
  ];

  const pick = (day: number) => {
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-day="${day}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    const hi = getComputedStyle(document.documentElement).getPropertyValue('--hi').trim() || '#D6FF3D';
    el.animate([{ backgroundColor: hi }, { backgroundColor: 'transparent' }], { duration: 1200, easing: 'ease-out' });
  };

  return (
    <div ref={rootRef}>
      <ListHead view="history" />
      {days.length === 0 ? (
        <EmptyState view="history" small />
      ) : (
        <>
          <div className="stats">
            {stats.map((s) => (
              <div key={s.label} className={`st ${s.cls}`}>
                <b>{s.value}</b>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
          <Heatmap counts={counts} today={today} onPick={pick} />
          {days.map((d) => {
            const label = d.day === today ? '今天' : d.day === addDays(today, -1) ? '昨天' : null;
            return (
              <section key={d.day}>
                <div className="day" data-day={d.day}>
                  <b>{label ?? monthDay(d.day, today)}</b>
                  {label ? `${monthDay(d.day, today)} ` : ''}
                  {weekday(d.day)} · {d.count} 件
                </div>
                {d.items.map((item) => (
                  <HistoryRow key={item.todo.id} item={item} />
                ))}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
