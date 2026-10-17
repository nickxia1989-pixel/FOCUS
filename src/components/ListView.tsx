import { AnimatePresence, motion } from 'motion/react';
import { useMemo } from 'react';
import { buildIndex, rootsOf } from '../model';
import { useData } from '../store';
import { LISTS, type ListId } from '../types';
import { AddBar } from './Inputs';
import { ChevronIcon, ListIcons } from './icons';
import { nodeMotion } from './motionPresets';
import { TodoNode } from './TodoNode';
import { ViewHead } from './ViewHead';

export function ListView({ list, dir }: { list: ListId; dir: number }) {
  const todos = useData((s) => s.todos);
  const doneCollapsed = useData((s) => !!s.prefs.doneCollapsed[list]);
  const index = useMemo(() => buildIndex(todos), [todos]);
  const roots = rootsOf(index, list);
  const open = roots.filter((t) => !t.done);
  const done = roots.filter((t) => t.done);
  const meta = LISTS.find((l) => l.id === list)!;
  const Icon = ListIcons[list];

  const toggleDone = () => {
    const prefs = useData.getState().prefs;
    useData.getState().setPrefs({ doneCollapsed: { ...prefs.doneCollapsed, [list]: !doneCollapsed } });
  };

  return (
    <motion.section
      className="listview"
      initial={{ opacity: 0, x: dir * 18 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <ViewHead title={meta.label} hint={meta.hint} />
      <AddBar list={list} />
      <motion.div className="list-scroll" layoutScroll>
        {roots.length === 0 && (
          <div className="empty">
            <Icon className="empty-icon" width={34} height={34} />
            <p>{meta.empty}</p>
          </div>
        )}
        <AnimatePresence initial={false}>
          {open.map((t) => (
            <TodoNode key={t.id} todo={t} depth={0} index={index} siblings={roots} />
          ))}
          {done.length > 0 && (
            <motion.div key="__done-divider" {...nodeMotion} className="done-divider">
              <button onClick={toggleDone} className={doneCollapsed ? 'is-collapsed' : ''}>
                已完成 · {done.length}
                <ChevronIcon width={12} height={12} />
              </button>
              <span className="done-divider-line" />
            </motion.div>
          )}
          {!doneCollapsed &&
            done.map((t) => <TodoNode key={t.id} todo={t} depth={0} index={index} siblings={roots} />)}
        </AnimatePresence>
        <div className="list-bottom-space" />
      </motion.div>
    </motion.section>
  );
}
