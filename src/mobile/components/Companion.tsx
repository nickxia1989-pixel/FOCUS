// 双页布局（iPhone Duo 展开的内屏、手机横屏）的右页：比外屏多出来的那一层信息。
// 左页始终是当前分区本身（和外屏同一份内容，开合时原地保留）；右页跟着左页变：
// - 四个列表：这个列表的完成记录（做完的事按天排）；
// - HISTORY：统计（左页的同一张统计卡在双页时挪到这里，点柱子让左页跳到那天）。
import { useMemo } from 'react';
import { startOfToday } from '../../model';
import { LISTS, type ListId } from '../../types';
import { DAY, historyDays, listHistoryDays, originList, type Section } from '../data';
import { HistoryIcon, SectionIcons } from '../icons';
import { useTodos } from '../store';
import { DaySection, StatsCard } from './HistoryContent';

export function Companion({ section }: { section: Section }) {
  return (
    <div className="page-right" data-page="right">
      {section === 'history' ? <HistoryStats /> : <ListRecord list={section} />}
      <div className="screen-bottom" />
    </div>
  );
}

function PageHead({ eyebrow, title, sub, target }: { eyebrow: string; title: string; sub: string; target?: Section }) {
  return (
    <header className="large-title page-head">
      <p className="eyebrow">{eyebrow}</p>
      {/* 双页时「完成」的东西飞到这里（见 actions.ts 的 sectionTarget） */}
      <h1 data-target={target}>{title}</h1>
      <p className="subtitle">{sub}</p>
    </header>
  );
}

function ListRecord({ list }: { list: ListId }) {
  const todos = useTodos();
  const now = useMemo(() => Date.now(), [todos]);
  const days = useMemo(() => listHistoryDays(todos, list), [todos, list]);
  const meta = LISTS.find((l) => l.id === list)!;
  const Icon = SectionIcons[list];
  const total = days.reduce((n, d) => n + d.total, 0);
  const today = days[0]?.day === startOfToday(now) ? days[0].total : 0;
  return (
    <>
      <PageHead
        eyebrow={`${meta.label} · 完成记录`}
        title="DONE"
        sub={total ? `今天 ${today} 项 · 一共 ${total} 项` : '还没有完成记录'}
        target="history"
      />
      {days.length ? (
        days.map((d) => <DaySection key={d.day} day={d} now={now} />)
      ) : (
        <div className="empty page-empty">
          <div className="empty-icon">
            <Icon width={30} height={30} />
          </div>
          <p>{`在 ${meta.label} 里勾掉的事\n会按天记在这一页。`}</p>
        </div>
      )}
    </>
  );
}

function HistoryStats() {
  const todos = useTodos();
  const now = useMemo(() => Date.now(), [todos]);
  const days = useMemo(() => historyDays(todos), [todos]);
  // 让左页的 HISTORY 列表滚到那天
  const jump = (day: number) =>
    document
      .querySelector(`.screen [data-anchor="day-${day}"]`)
      ?.closest('.history-day')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <>
      <PageHead eyebrow="HISTORY · 统计" title="STATS" sub={`一共完成 ${days.reduce((n, d) => n + d.total, 0)} 项`} />
      {days.length ? (
        <>
          <StatsCard todos={todos} now={now} days={days} onJump={jump} />
          <ByList now={now} />
        </>
      ) : (
        <div className="empty page-empty">
          <div className="empty-icon">
            <HistoryIcon width={30} height={30} />
          </div>
          <p>{'完成第一件事后，\n这里会有每天的统计。'}</p>
        </div>
      )}
    </>
  );
}

/** 按列表分：近 7 天、一共完成了多少（按条目原本所在的列表算） */
function ByList({ now }: { now: number }) {
  const todos = useTodos();
  const rows = useMemo(() => {
    const byId = new Map(todos.map((t) => [t.id, t]));
    const since = startOfToday(now) - 6 * DAY;
    const out = Object.fromEntries(LISTS.map((l) => [l.id, { week: 0, total: 0 }])) as Record<
      ListId,
      { week: number; total: number }
    >;
    for (const t of todos) {
      if (!t.done || t.completedAt === null) continue;
      const r = out[originList(t, byId)];
      r.total++;
      if (t.completedAt >= since) r.week++;
    }
    return out;
  }, [todos, now]);
  const max = Math.max(1, ...LISTS.map((l) => rows[l.id].week));
  return (
    <div className="card by-list">
      <h2 className="by-list-head">
        <span>按列表</span>
        <span>近 7 天 / 一共</span>
      </h2>
      {LISTS.map((l) => {
        const Icon = SectionIcons[l.id];
        const r = rows[l.id];
        return (
          <div key={l.id} className="by-list-row" style={{ '--c': `var(--c-${l.id})` } as React.CSSProperties}>
            <Icon width={18} height={18} className="by-list-icon" />
            <span className="by-list-label">{l.label}</span>
            <span className="by-list-bar">
              <span style={{ width: `${(r.week / max) * 100}%` }} />
            </span>
            <span className="by-list-num">
              {r.week} / {r.total}
            </span>
          </div>
        );
      })}
    </div>
  );
}
