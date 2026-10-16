import { motion } from 'motion/react';
import { useEffect, useMemo, useRef } from 'react';
import { openCount } from '../model';
import { useData, useUi } from '../store';
import { LISTS, type ListId } from '../types';

function Tab({ id, label, active, count }: { id: ListId; label: string; active: boolean; count: number }) {
  const pulse = useUi((s) => s.tabPulse[id]);
  const dropTarget = useUi((s) => s.dragOverTab === id);
  const ref = useRef<HTMLButtonElement>(null);
  const firstPulse = useRef(pulse);

  // 有东西"飞进来"时页签弹一下
  useEffect(() => {
    if (pulse === firstPulse.current || !ref.current) return;
    ref.current.querySelector('.tab-count')?.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.45)' }, { transform: 'scale(0.92)' }, { transform: 'scale(1)' }],
      { duration: 520, easing: 'cubic-bezier(.3,1.5,.5,1)' },
    );
    ref.current.querySelector('.tab-label')?.animate(
      [{ transform: 'translateY(0)' }, { transform: 'translateY(-2px)' }, { transform: 'translateY(0)' }],
      { duration: 420, easing: 'ease-out' },
    );
  }, [pulse]);

  return (
    <button
      ref={ref}
      data-tab-id={id}
      className={`tab ${active ? 'is-active' : ''} ${dropTarget ? 'is-drop' : ''}`}
      onClick={() => useData.getState().setPrefs({ activeList: id })}
      role="tab"
      aria-selected={active}
    >
      <span className="tab-label">{label}</span>
      <motion.span
        key={count}
        className={`tab-count ${count === 0 ? 'is-zero' : ''}`}
        initial={{ y: -3, opacity: 0.4 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.22 }}
      >
        {count}
      </motion.span>
      {active && <motion.span layoutId="tab-underline" className="tab-underline" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
    </button>
  );
}

export function Tabs() {
  const todos = useData((s) => s.todos);
  const active = useData((s) => s.prefs.activeList);
  const counts = useMemo(
    () => Object.fromEntries(LISTS.map((l) => [l.id, openCount(todos, l.id)])) as Record<ListId, number>,
    [todos],
  );
  return (
    <nav className="tabs" role="tablist">
      {LISTS.map((l) => (
        <Tab key={l.id} id={l.id} label={l.label} active={l.id === active} count={counts[l.id]} />
      ))}
    </nav>
  );
}
