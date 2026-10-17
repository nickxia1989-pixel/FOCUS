import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { deleteWithUndo, goView, moveTodoTo, sendToFocus, sendToVerify, setNow, startAddChild, toggleTodo, undoDelete } from '../actions';
import { countsByDay, streak } from '../history';
import { completedSince, nowOf } from '../model';
import { isMac } from '../platform';
import { useData, useUi } from '../store';
import type { ListId, Todo } from '../types';
import { VIEW_COPY } from './copy';
import { CheckIcon, ChevronRightIcon, EditIcon, EyeCheckIcon, ListIcons, MoveIcon, SparkFilledIcon, SubtaskIcon, TrashIcon, UndoIcon, UpIcon } from './icons';
import { startEdit } from './TodoNode';
import { useTodayStart } from './useToday';

const EASE = [0.2, 0.8, 0.2, 1] as const;

/** 「移到」能去哪：不含 VERIFY（走「送去验证」）；子项可以选自己的列表 = 提升为顶层项 */
function moveTargets(todo: Todo): { list: ListId; label: string }[] {
  const lists: ListId[] = ['focus', 'inbox', 'goal'];
  return lists
    .filter((l) => l !== todo.list || todo.parentId !== null)
    .map((l) => ({ list: l, label: l === todo.list ? '提升为顶层项' : VIEW_COPY[l].en }));
}

/** 条目的右键 / ⋯ 菜单：完成、编辑、添加子任务 | 设为现在、送去验证、移到 › | 删除 */
export function ContextMenu() {
  const menu = useUi((s) => s.menu);
  const todo = useData((s) => (menu ? s.todos.find((t) => t.id === menu.todoId) : undefined));
  const isNowItem = useData((s) => !!todo && nowOf(s.todos)?.id === todo.id);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: -999, y: -999 });
  const [sub, setSub] = useState<{ x: number; y: number; left: boolean } | null>(null);

  const close = () => useUi.getState().set({ menu: null });

  useLayoutEffect(() => {
    setSub(null);
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const pad = 6;
    // 从 ⋯ 打开时右对齐按钮；靠边时翻转，保证完整显示
    let x = menu.x;
    let y = menu.y;
    if (x + r.width > window.innerWidth - pad) x = Math.max(pad, x - r.width);
    if (y + r.height > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - pad - r.height);
    setPos({ x, y });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: Event) => {
      if (!(e.target as Element).closest?.('.ctx')) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      // ⌫ / Delete：删除这一条
      if ((e.key === 'Backspace' || e.key === 'Delete') && todo) {
        e.preventDefault();
        close();
        deleteWithUndo(todo);
      }
    };
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
  }, [menu, todo]);

  if (!menu || !todo) return null;

  const run = (fn: () => void) => () => {
    close();
    fn();
  };

  const verifyRoot = todo.parentId === null && todo.list === 'verify';
  const testing = !!todo.testing && !todo.done;
  const targets = moveTargets(todo);

  const openSub = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const w = 168;
    const left = r.right + w > window.innerWidth - 6;
    setSub({ x: left ? r.left - w + 4 : r.right - 4, y: Math.min(r.top - 6, window.innerHeight - 6 - (targets.length * 32 + 12)), left });
  };

  return (
    <>
      <motion.div
        ref={ref}
        className="pop ctx"
        role="menu"
        style={{ left: pos.x, top: pos.y }}
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.12, ease: EASE }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <button className="mi" onMouseEnter={() => setSub(null)} onClick={run(() => toggleTodo(todo))}>
          {todo.done ? <UndoIcon /> : <CheckIcon />}
          {todo.done ? '恢复为未完成' : verifyRoot ? '测完了' : '完成'}
        </button>
        <button className="mi" onMouseEnter={() => setSub(null)} onClick={run(() => startEdit(todo))}>
          <EditIcon />
          编辑
          <kbd>双击</kbd>
        </button>
        <button className="mi" onMouseEnter={() => setSub(null)} onClick={run(() => startAddChild(todo))}>
          <SubtaskIcon />
          添加子任务
        </button>
        <div className="msep" />
        {!isNowItem && (
          <button className="mi" onMouseEnter={() => setSub(null)} onClick={run(() => setNow(todo))}>
            <UpIcon />
            设为现在
          </button>
        )}
        {verifyRoot ? (
          <button className="mi" onMouseEnter={() => setSub(null)} onClick={run(() => sendToFocus(todo))}>
            <SparkFilledIcon />
            退回 FOCUS
          </button>
        ) : (
          <button className="mi" onMouseEnter={() => setSub(null)} onClick={run(() => sendToVerify(todo))}>
            <EyeCheckIcon />
            {testing ? '取消待验证' : todo.parentId ? '送去验证（留在原处）' : '送去验证'}
          </button>
        )}
        <button
          className={`mi ${sub ? 'hl' : ''}`}
          aria-haspopup="menu"
          aria-expanded={!!sub}
          onMouseEnter={(e) => openSub(e.currentTarget)}
          onClick={(e) => (sub ? setSub(null) : openSub(e.currentTarget))}
        >
          <MoveIcon />
          移到
          <em>
            {targets
              .slice(0, 2)
              .map((t) => (t.label === '提升为顶层项' ? '顶层' : t.label))
              .join(' · ')}
          </em>
          <ChevronRightIcon className="chev" />
        </button>
        <div className="msep" />
        <button className="mi bad" onMouseEnter={() => setSub(null)} onClick={run(() => deleteWithUndo(todo))}>
          <TrashIcon />
          删除
          <kbd>⌫</kbd>
        </button>
      </motion.div>
      {sub && (
        <motion.div
          className="pop ctx"
          role="menu"
          style={{ left: sub.x, top: sub.y, width: 168, minWidth: 0 }}
          initial={{ opacity: 0, x: sub.left ? 4 : -4 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.12, ease: EASE }}
        >
          {targets.map((t) => {
            const Icon = ListIcons[t.list];
            return (
              <button key={t.list} className="mi" onClick={run(() => moveTodoTo(todo, t.list))}>
                <Icon />
                {t.label}
              </button>
            );
          })}
        </motion.div>
      )}
    </>
  );
}

/** 底部提示条：删除后 5 秒可撤销，左侧圆环倒计时，右侧荧光绿「撤销」 */
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
          role="status"
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
          transition={{ duration: 0.22, ease: EASE }}
        >
          {toast.undoEntry && (
            <svg className="ring" viewBox="0 0 22 22" aria-hidden>
              <circle className="bg" cx="11" cy="11" r="9" />
              <circle className="fg" cx="11" cy="11" r="9" />
            </svg>
          )}
          <span>{toast.text}</span>
          {toast.undoEntry && (
            <button onClick={undoDelete} title={`撤销（${isMac ? '⌘' : 'Ctrl+'}Z）`}>
              撤销
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** 底栏：星芒 + 「今天 N 件 · 连续 N 天」+ 5 段小进度（今天完成数） */
export function Footer() {
  const todos = useData((s) => s.todos);
  const today = useTodayStart();
  const n = useMemo(() => completedSince(todos, today), [todos, today]);
  const days = useMemo(() => streak(countsByDay(todos), today), [todos, today]);

  return (
    <button className="ft" title={`查看完成记录（${isMac ? '⌘' : 'Ctrl+'}5）`} onClick={() => goView('history')}>
      <SparkFilledIcon />
      今天{' '}
      <motion.b key={`n${n}`} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        {n}
      </motion.b>{' '}
      件 · 连续{' '}
      <motion.b key={`d${days}`} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        {days}
      </motion.b>{' '}
      天
      <span className="dots" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <i key={i} className={i < n ? 'on' : ''} />
        ))}
      </span>
    </button>
  );
}
