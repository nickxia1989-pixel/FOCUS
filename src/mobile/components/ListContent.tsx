import { AnimatePresence, motion } from 'motion/react';
import { useMemo } from 'react';
import { buildIndex, rootsOf } from '../../model';
import { LISTS, type ListId } from '../../types';
import { ChevronDownIcon, SectionIcons } from '../icons';
import { useData, useTodos } from '../store';
import { TodoNode } from './TodoNode';

export function ListContent({ list }: { list: ListId }) {
  const todos = useTodos();
  const doneCollapsed = useData((s) => !!s.prefs.doneCollapsed[list]);
  const index = useMemo(() => buildIndex(todos), [todos]);
  const roots = rootsOf(index, list);
  const open = roots.filter((t) => !t.done);
  const done = roots.filter((t) => t.done);
  const meta = LISTS.find((l) => l.id === list)!;
  const Icon = SectionIcons[list];

  const toggleDone = () => {
    const prefs = useData.getState().prefs;
    useData.getState().setPrefs({ doneCollapsed: { ...prefs.doneCollapsed, [list]: !doneCollapsed } });
  };

  if (roots.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">
          <Icon width={30} height={30} />
        </div>
        <p>{meta.empty}</p>
      </div>
    );
  }

  return (
    <div className="list">
      {open.length > 0 ? (
        <div className="card">
          <AnimatePresence initial={false}>
            {open.map((t) => (
              <TodoNode key={t.id} todo={t} depth={0} index={index} />
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <div className="all-clear">这里的事都做完了 ✦</div>
      )}

      {done.length > 0 && (
        <>
          <button
            className={`group-head ${doneCollapsed ? 'is-collapsed' : ''}`}
            data-anchor="done-head"
            onClick={toggleDone}
          >
            <span>已完成</span>
            <span className="group-count">{done.length}</span>
            <ChevronDownIcon width={16} height={16} />
          </button>
          <AnimatePresence initial={false}>
            {!doneCollapsed && (
              <motion.div
                key="done"
                className="card card-done"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.28, ease: [0.3, 0.7, 0.2, 1] }}
              >
                <AnimatePresence initial={false}>
                  {done.map((t) => (
                    <TodoNode key={t.id} todo={t} depth={0} index={index} />
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
