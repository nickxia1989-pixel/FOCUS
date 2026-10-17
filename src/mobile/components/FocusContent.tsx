// FOCUS：一次只做一件。最上面那件放大成荧光绿的 NOW 卡，其余排在「接下来」，序号 02、03…，越往后越淡。
// 双页时左页 = NOW 卡 + 统计，右页 = 新建框 + 接下来 + 今天已完成。
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { buildIndex, childrenOf, rootsOf, startOfToday, type TreeIndex } from '../../model';
import type { Todo } from '../../types';
import { completeNow, openComposer, sendToVerify, startEdit, toggleTest, toggleTodo } from '../actions';
import { listHistoryDays } from '../data';
import { CheckIcon, ChevronDownIcon, EyeCheckIcon, PlusIcon } from '../icons';
import { haptic } from '../native';
import { useTodos } from '../store';
import { rectOf, toggleExpanded, useUi } from '../ui';
import { Panes } from './Chrome';
import { Empty } from './Empty';
import { DayGroups, Stats } from './HistoryContent';
import { SwipeRow } from './SwipeRow';
import { rowSwipes, TitleEditor, TodoNode } from './TodoNode';

/** 接下来的行逐行变淡 */
const FADE = [1, 0.84, 0.68, 0.52];
const pad2 = (n: number) => String(n).padStart(2, '0');
/** NOW 卡上最多列几条子任务 */
const SUBS_SHOWN = 3;

/** 打开长按菜单（以元素当前的位置为准） */
function openMenu(todo: Todo, el: Element | null, moveFirst = false) {
  if (!el) return;
  useUi.getState().set({ menu: { todoId: todo.id, rect: rectOf(el), from: 'list', moveFirst }, swipedId: null });
}

/** 长按：460ms 不动就算（按在按钮上不算） */
function useLongPress(onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
  };
  return {
    onPointerDown: (e: PointerEvent) => {
      fired.current = false;
      if ((e.target as HTMLElement).closest('button, textarea, input')) return;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        haptic.medium();
        onLong();
      }, 460);
    },
    onPointerMove: (e: PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 9) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (e: React.MouseEvent) => {
      if (fired.current) {
        e.stopPropagation();
        fired.current = false;
      }
    },
  };
}

export function FocusContent() {
  const todos = useTodos();
  const index = useMemo(() => buildIndex(todos), [todos]);
  const open = rootsOf(index, 'focus').filter((t) => !t.done);
  const [now, ...queue] = open;
  const today = useMemo(() => Date.now(), [todos]);

  return (
    <Panes
      section="focus"
      left={
        <>
          {now ? (
            <NowCard key={now.id} todo={now} index={index} total={open.length} />
          ) : (
            <Empty section="focus" />
          )}
          <div className="only-spread" style={{ marginTop: now ? 14 : 24 }}>
            <Stats todos={todos} now={today} labels={['今天完成', '近 7 天', '连续天数']} />
          </div>
        </>
      }
      right={
        <>
          <button className="addbox only-spread" onClick={() => openComposer('focus')}>
            <PlusIcon />
            接下来要做…
          </button>
          {queue.length > 0 && (
            <>
              <div className="q-head">
                <b>接下来</b>
                <span>{queue.length}</span>
              </div>
              <AnimatePresence initial={false}>
                {queue.map((t, i) => (
                  <QueueNode key={t.id} todo={t} no={i + 2} fade={FADE[i] ?? FADE[FADE.length - 1]} index={index} />
                ))}
              </AnimatePresence>
            </>
          )}
          <TodayDone todos={todos} now={today} />
        </>
      }
    />
  );
}

// ---------- NOW 卡 ----------

function NowCard({ todo, index, total }: { todo: Todo; index: TreeIndex; total: number }) {
  const kids = childrenOf(index, todo.id);
  const editing = useUi((s) => s.editingId === todo.id);
  const handoff = useUi((s) => s.handoff === todo.id);
  const menuOpen = useUi((s) => s.menu?.todoId === todo.id);
  const [showAll, setShowAll] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const press = useLongPress(() => openMenu(todo, ref.current));
  const shown = showAll ? kids : kids.slice(0, SUBS_SHOWN);
  const more = kids.length - shown.length;

  return (
    <motion.div
      ref={ref}
      layoutId={`todo-${todo.id}`}
      layout="position"
      className={`now ${handoff ? 'is-handoff' : ''} ${menuOpen ? 'lifted' : ''}`}
      data-node-id={todo.id}
      data-anchor={todo.id}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      {...press}
    >
      <div className="now-top">
        <span>
          NOW<span className="now-top-more"> · 现在就做这件</span>
        </span>
        <span>
          {pad2(1)} / {pad2(total)}
        </span>
      </div>
      <h2 className="now-title" onClick={() => !editing && !handoff && startEdit(todo.id)}>
        {editing ? <TitleEditor todo={todo} /> : <span className="strike">{todo.title}</span>}
      </h2>
      {kids.length > 0 && (
        <>
          <div className="now-bar" aria-hidden>
            {kids.map((k) => (
              <i key={k.id} className={k.done ? 'on' : ''} />
            ))}
          </div>
          <div className="now-subs">
            {shown.map((k) => (
              <NowSub key={k.id} todo={k} />
            ))}
            {more > 0 && (
              <button className="now-more" onClick={() => setShowAll(true)}>
                还有 {more} 条
              </button>
            )}
          </div>
        </>
      )}
      <div className="now-act">
        <button className="now-done" aria-label="完成" onClick={(e) => completeNow(todo, e.currentTarget)}>
          <CheckIcon />
        </button>
        <b>完成</b>
        <button className="now-vb" onClick={(e) => sendToVerify(todo, e.currentTarget)}>
          <EyeCheckIcon />
          送去验证
        </button>
      </div>
    </motion.div>
  );
}

function NowSub({ todo }: { todo: Todo }) {
  const completing = useUi((s) => !!s.completing[todo.id]);
  const editing = useUi((s) => s.editingId === todo.id);
  const checked = todo.done || completing;
  const testing = !!todo.testing && !checked;
  const ref = useRef<HTMLDivElement>(null);
  const press = useLongPress(() => openMenu(todo, ref.current));
  return (
    <div ref={ref} className={`now-sub ${checked ? 'done' : ''}`} data-node-id={todo.id} {...press}>
      <button
        className={`sc ${checked ? 'd' : testing ? 'v' : ''}`}
        role="checkbox"
        aria-checked={checked}
        aria-label={checked ? '标记为未完成' : '完成这个子任务'}
        onClick={() => toggleTodo(todo)}
      />
      <span className="now-sub-text" onClick={() => !editing && startEdit(todo.id)}>
        {editing ? <TitleEditor todo={todo} /> : todo.title}
        {testing && !editing && (
          <button
            className="chip-v"
            onClick={(e) => {
              e.stopPropagation();
              toggleTest(todo);
            }}
          >
            待验证
          </button>
        )}
      </span>
    </div>
  );
}

// ---------- 接下来 ----------

function QueueNode({ todo, no, fade, index }: { todo: Todo; no: number; fade: number; index: TreeIndex }) {
  const kids = childrenOf(index, todo.id);
  const completing = useUi((s) => !!s.completing[todo.id]);
  const editing = useUi((s) => s.editingId === todo.id);
  const menuOpen = useUi((s) => s.menu?.todoId === todo.id);
  const expanded = useUi((s) => !!s.expanded[todo.id]);
  const isNew = useUi((s) => !!s.added[todo.id]);
  const rowRef = useRef<HTMLDivElement>(null);
  const open = (moveFirst = false) => openMenu(todo, rowRef.current, moveFirst);
  const { leading, trailing } = rowSwipes(todo, completing, open);
  const doneKids = kids.filter((k) => k.done).length;

  return (
    <motion.div
      layoutId={`todo-${todo.id}`}
      layout="position"
      className={`q-node ${isNew ? 'is-new' : ''}`}
      data-node-id={todo.id}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1], delay: 0 }}
    >
      <SwipeRow id={todo.id} leading={leading} trailing={trailing} onLongPress={() => open()} disabled={editing}>
        <div
          ref={rowRef}
          data-anchor={todo.id}
          className={`q-row ${completing ? 'done' : ''} ${menuOpen ? 'lifted' : ''}`}
          style={{ opacity: completing ? 1 : fade } as CSSProperties}
        >
          <span className="q-no">{pad2(no)}</span>
          <span className="q-title" onClick={() => !editing && startEdit(todo.id)}>
            {editing ? <TitleEditor todo={todo} /> : <span className="strike">{todo.title}</span>}
          </span>
          {kids.length > 0 && !editing && (
            <button
              className={`pg ${expanded ? 'is-open' : ''}`}
              aria-label={expanded ? '收起子任务' : '展开子任务'}
              onClick={() => toggleExpanded(todo.id)}
            >
              {doneKids}/{kids.length}
            </button>
          )}
        </div>
      </SwipeRow>
      {expanded && kids.length > 0 && (
        <div className="q-kids">
          <AnimatePresence initial={false}>
            {kids.map((c) => (
              <TodoNode key={c.id} todo={c} depth={0} index={index} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}

// ---------- 今天已完成（双页右页底下） ----------

function TodayDone({ todos, now }: { todos: Todo[]; now: number }) {
  const [open, setOpen] = useState(false);
  const days = useMemo(
    () => listHistoryDays(todos, 'focus').filter((d) => d.day === startOfToday(now)),
    [todos, now],
  );
  const total = days[0]?.total ?? 0;
  if (!total) return null;
  return (
    <div className="only-spread">
      <button className={`grp ${open ? '' : 'is-collapsed'}`} onClick={() => setOpen((v) => !v)}>
        <ChevronDownIcon />
        今天已完成 · {total}
      </button>
      {open && <DayGroups days={days} now={now} />}
    </div>
  );
}
