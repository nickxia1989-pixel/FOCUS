import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { deleteWithUndo, describeMove, moveTodoTo, startAddChild, toggleTest, toggleTodo, undoDelete } from '../actions';
import { completedSince, startOfToday } from '../model';
import { useData, useUi } from '../store';
import { LISTS } from '../types';
import { CheckIcon, EditIcon, FlaskIcon, ListIcons, SparkIcon, SubtaskIcon, TrashIcon, UndoIcon } from './icons';

/** 条目的右键 / ⋯ 菜单 */
export function ContextMenu() {
  const menu = useUi((s) => s.menu);
  const todo = useData((s) => (menu ? s.todos.find((t) => t.id === menu.todoId) : undefined));
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const close = () => useUi.getState().set({ menu: null });

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const pad = 6;
    // 从按钮打开时右对齐按钮；靠边时翻转，保证完整显示
    let x = menu.x;
    let y = menu.y;
    if (x + r.width > window.innerWidth - pad) x = Math.max(pad, x - r.width);
    if (y + r.height > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - pad - r.height);
    setPos({ x, y });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
      window.removeEventListener('wheel', close);
    };
  }, [menu]);

  if (!menu || !todo) return null;

  const run = (fn: () => void) => () => {
    close();
    fn();
  };

  return (
    <div ref={ref} className="menu ctx-menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      <button className="menu-item" onClick={run(() => toggleTodo(todo))}>
        <span className="menu-check">
          <CheckIcon />
        </span>
        {todo.done ? '标记为未完成' : '完成'}
      </button>
      {/* VERIFY 的顶层项本身就是待测，不再提供 */}
      {!(todo.parentId === null && todo.list === 'verify') && (
        <button className="menu-item menu-move-verify" onClick={run(() => toggleTest(todo))}>
          <span className="menu-check">
            <FlaskIcon />
          </span>
          {todo.testing && !todo.done ? '取消待测' : todo.parentId ? '标为待测（留在原处）' : '标为待测'}
        </button>
      )}
      <button className="menu-item" onClick={run(() => useUi.getState().set({ editingId: todo.id }))}>
        <span className="menu-check">
          <EditIcon />
        </span>
        编辑
      </button>
      <button className="menu-item" onClick={run(() => startAddChild(todo))}>
        <span className="menu-check">
          <SubtaskIcon />
        </span>
        添加子任务
      </button>
      <div className="menu-sep" />
      {/* 移进 VERIFY 统一走上面的"标为待测"；同列表的子项可提升为顶层 */}
      {LISTS.filter((l) => (l.id === todo.list ? todo.parentId !== null : l.id !== 'verify')).map((l) => {
        const Icon = ListIcons[l.id];
        const label = l.id === todo.list ? '提升为顶层项' : describeMove(l.id);
        return (
          <button
            key={l.id}
            className={`menu-item menu-move menu-move-${l.id}`}
            onClick={run(() => moveTodoTo(todo, l.id))}
          >
            <span className="menu-check">
              <Icon />
            </span>
            {label}
          </button>
        );
      })}
      <div className="menu-sep" />
      <button className="menu-item menu-danger" onClick={run(() => deleteWithUndo(todo))}>
        <span className="menu-check">
          <TrashIcon />
        </span>
        删除
      </button>
    </div>
  );
}

/** 底部浮出的提示条，删除后可撤销 */
export function Toast() {
  const toast = useUi((s) => s.toast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      if (useUi.getState().toast?.key === toast.key) useUi.getState().set({ toast: null });
    }, 5000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.key}
          className="toast"
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
        >
          <span className="toast-text">{toast.text}</span>
          {toast.undo && (
            <button className="toast-undo" onClick={undoDelete}>
              <UndoIcon width={13} height={13} />
              撤销
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** 底栏：今日完成数 */
export function Footer() {
  const todos = useData((s) => s.todos);
  const [today, setToday] = useState(() => startOfToday(Date.now()));
  useEffect(() => {
    const t = setInterval(() => setToday(startOfToday(Date.now())), 60_000);
    return () => clearInterval(t);
  }, []);
  const n = useMemo(() => completedSince(todos, today), [todos, today]);

  return (
    <footer className={`footer ${n > 0 ? 'has-done' : ''}`}>
      <SparkIcon width={12} height={12} className="footer-spark" />
      <span>
        今天完成了{' '}
        <motion.b key={n} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="footer-num">
          {n}
        </motion.b>{' '}
        件事
      </span>
    </footer>
  );
}
