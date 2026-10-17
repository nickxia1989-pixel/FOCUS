import { motion } from 'motion/react';
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { addDays, countSince, countsByDay, groupByDay, heatmap, streak, weekStart, type HistoryItem } from '../history';
import { showToast, useData } from '../store';
import { HISTORY_META, LISTS, type Todo } from '../types';
import { CheckIcon, HistoryIcon, UndoIcon } from './icons';
import { useTodayStart } from './useToday';
import { ViewHead } from './ViewHead';

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
const listLabel = (id: string) => LISTS.find((l) => l.id === id)?.label ?? id;

// 热力图格子尺寸（px），列数随宽度自适应
const CELL = 12;
const GAP = 3;
const LABEL_W = 18;

function Heatmap(props: { counts: Map<number, number>; today: number; selected: number | null; onPick(day: number): void }) {
  const { counts, today, selected, onPick } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [weeks, setWeeks] = useState(15);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width - LABEL_W;
      setWeeks(Math.max(8, Math.min(30, Math.floor((w + GAP) / (CELL + GAP)))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = useMemo(() => heatmap(counts, today, weeks), [counts, today, weeks]);
  // 每列按周一所在月份标注；两个标签离得太近时去掉前一个（通常是只露出一点的月份）
  const months: string[] = [];
  let last = -1;
  cols.forEach((col, i) => {
    const m = new Date(col[0].day).getMonth();
    const prev = i > 0 ? new Date(cols[i - 1][0].day).getMonth() : -1;
    months.push('');
    if (m === prev || i === cols.length - 1) return;
    if (last >= 0 && i - last < 3) months[last] = '';
    months[i] = `${m + 1}月`;
    last = i;
  });
  const grid = { gridTemplateColumns: `repeat(${weeks}, ${CELL}px)`, gap: GAP } as CSSProperties;

  return (
    <div className="heat" ref={ref}>
      <div className="heat-months" style={{ ...grid, marginLeft: LABEL_W }}>
        {months.map((m, i) => (
          <span key={i}>{m}</span>
        ))}
      </div>
      <div className="heat-body">
        <div className="heat-days" style={{ width: LABEL_W, gap: GAP }}>
          {['一', '', '三', '', '五', '', ''].map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div className="heat-grid" style={{ ...grid, gridTemplateRows: `repeat(7, ${CELL}px)` }}>
          {cols.flat().map((c) => (
            <button
              key={c.day}
              className={`heat-cell l${c.level} ${c.future ? 'is-future' : ''} ${c.day === today ? 'is-today' : ''} ${
                selected === c.day ? 'is-selected' : ''
              }`}
              disabled={c.future || c.count === 0}
              title={c.future ? undefined : `${monthDay(c.day, today)} ${weekday(c.day)} · ${c.count ? `完成 ${c.count} 件` : '没有完成'}`}
              onClick={() => onPick(c.day)}
            />
          ))}
        </div>
      </div>
      <div className="heat-legend">
        少
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`heat-cell l${l}`} />
        ))}
        多
      </div>
    </div>
  );
}

function uncompleteFromHistory(todo: Todo) {
  useData.getState().uncomplete(todo.id);
  showToast(`已恢复为未完成 · ${listLabel(todo.list)}`);
}

function HistoryRow({ item, parentTime }: { item: HistoryItem; parentTime?: string }) {
  const t = item.todo;
  const from = t.completedFrom ?? t.list;
  const time = hm(t.completedAt!);
  return (
    <li>
      <div className="hrow" style={{ '--c': `var(--c-${from})` } as CSSProperties}>
        <span className="hcheck" title={`在 ${listLabel(from)} 完成`}>
          <CheckIcon width={10} height={10} strokeWidth={2.4} />
        </span>
        <div className="hmain">
          {item.parentTitle && <div className="hparent">{item.parentTitle}</div>}
          <div className="htitle">{t.title}</div>
        </div>
        {/* 和父项同一分钟完成的子项不重复显示时间 */}
        <span className="htime">{time === parentTime ? '' : time}</span>
        <button className="hundo" title="恢复为未完成" onClick={() => uncompleteFromHistory(t)}>
          <UndoIcon width={13} height={13} />
        </button>
      </div>
      {item.children.length > 0 && (
        <ul className="hkids">
          {item.children.map((c) => (
            <HistoryRow key={c.todo.id} item={c} parentTime={time} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** 完成记录：统计 + 热力图 + 按天分组的完成列表 */
export function HistoryView({ dir }: { dir: number }) {
  const todos = useData((s) => s.todos);
  const today = useTodayStart();
  const days = useMemo(() => groupByDay(todos), [todos]);
  const counts = useMemo(() => countsByDay(todos), [todos]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const stats = [
    { label: '今天', value: counts.get(today) ?? 0 },
    { label: '本周', value: countSince(counts, weekStart(today)) },
    { label: '连续天数', value: streak(counts, today) },
  ];

  const pick = (day: number) => {
    setSelected(day);
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-day="${day}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    const flash = getComputedStyle(document.documentElement).getPropertyValue('--flash').trim();
    el.animate([{ backgroundColor: flash }, { backgroundColor: 'transparent' }], { duration: 1200, easing: 'ease-out' });
  };

  return (
    <motion.section
      className="historyview"
      initial={{ opacity: 0, x: dir * 18 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <ViewHead title={HISTORY_META.label} hint={HISTORY_META.hint} />
      <div className="history-scroll" ref={scrollRef}>
        {days.length === 0 ? (
          <div className="empty">
            <HistoryIcon className="empty-icon" width={34} height={34} />
            <p>{HISTORY_META.empty}</p>
          </div>
        ) : (
          <>
            <div className="hstats">
              {stats.map((s) => (
                <div key={s.label} className="hstat">
                  <b>{s.value}</b>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
            <Heatmap counts={counts} today={today} selected={selected} onPick={pick} />
            {days.map((d) => (
              <section key={d.day} className="hday" data-day={d.day}>
                <header className="hday-head">
                  <span className="hday-title">{d.day === today ? '今天' : d.day === addDays(today, -1) ? '昨天' : monthDay(d.day, today)}</span>
                  <span className="hday-sub">
                    {d.day >= addDays(today, -1) ? `${monthDay(d.day, today)} ` : ''}
                    {weekday(d.day)}
                  </span>
                  <span className="hday-count">{d.count} 件</span>
                </header>
                <ul className="hitems">
                  {d.items.map((item) => (
                    <HistoryRow key={item.todo.id} item={item} />
                  ))}
                </ul>
              </section>
            ))}
            <div className="list-bottom-space" />
          </>
        )}
      </div>
    </motion.section>
  );
}
