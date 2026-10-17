// VERIFY / INBOX / GOAL：列表行（GOAL 每条一张卡，不显示任何进度），已完成折叠在「已完成 · N」下。
// 双页时右页是这个列表的完成记录。
import { AnimatePresence, motion } from 'motion/react';
import { useMemo } from 'react';
import { buildIndex, rootsOf, type TreeIndex } from '../../model';
import type { ListId, Todo } from '../../types';
import { listHistoryDays } from '../data';
import { ChevronDownIcon } from '../icons';
import { useData, useTodos } from '../store';
import { Panes } from './Chrome';
import { Empty } from './Empty';
import { DayGroups } from './HistoryContent';
import { TodoNode } from './TodoNode';

export function ListContent({ list }: { list: ListId }) {
  const todos = useTodos();
  const doneCollapsed = useData((s) => s.prefs.doneCollapsed[list] ?? true);
  const index = useMemo(() => buildIndex(todos), [todos]);
  const roots = rootsOf(index, list);
  const open = roots.filter((t) => !t.done);
  const done = roots.filter((t) => t.done);
  const now = useMemo(() => Date.now(), [todos]);
  const record = useMemo(() => listHistoryDays(todos, list), [todos, list]);

  const toggleDone = () => {
    const prefs = useData.getState().prefs;
    useData.getState().setPrefs({ doneCollapsed: { ...prefs.doneCollapsed, [list]: !doneCollapsed } });
  };

  const left =
    roots.length === 0 ? (
      <Empty section={list} />
    ) : (
      <>
        {open.length > 0 && <Rows list={list} items={open} index={index} />}
        {done.length > 0 && (
          <>
            <button
              className={`grp ${doneCollapsed ? 'is-collapsed' : ''}`}
              data-anchor="done-head"
              onClick={toggleDone}
            >
              <ChevronDownIcon />
              已完成 · {done.length}
            </button>
            <AnimatePresence initial={false}>
              {!doneCollapsed && (
                <motion.div
                  key="done"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  <Rows list={list} items={done} index={index} doneGroup />
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </>
    );

  return (
    <Panes
      section={list}
      left={left}
      right={
        <div className="only-spread">
          <div className="q-head">
            <b>完成记录</b>
            <span>{record.reduce((n, d) => n + d.total, 0)}</span>
          </div>
          {record.length ? (
            <DayGroups days={record} now={now} />
          ) : (
            <p className="note" style={{ padding: '8px 6px' }}>
              在这个列表里勾掉的事，会按天记在这一页。
            </p>
          )}
        </div>
      }
    />
  );
}

function Rows({ list, items, index, doneGroup }: { list: ListId; items: Todo[]; index: TreeIndex; doneGroup?: boolean }) {
  if (list === 'goal')
    return (
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <div key={t.id} className="goal-card">
            <TodoNode todo={t} depth={0} index={index} goal below={<div className="goal-meta">写下于 {written(t)}</div>} />
          </div>
        ))}
      </AnimatePresence>
    );
  return (
    <div className={`card ${doneGroup ? 'done-card' : ''}`}>
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <TodoNode key={t.id} todo={t} depth={0} index={index} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function written(t: Todo) {
  const d = new Date(t.createdAt);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${sameYear ? '' : `${d.getFullYear()} 年 `}${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}
