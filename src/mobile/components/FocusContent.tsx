// FOCUS：一次只做一件。最上面那件放大成荧光绿的 NOW 卡，其余排在「接下来」，序号 02、03…，越往后越淡。
// 双页时左页 = NOW 卡 + 统计，右页 = 新建框 + 接下来 + 今天已完成。
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from 'react';
import { buildIndex, childrenOf, rootsOf, startOfToday, type TreeIndex } from '../../model';
import type { Todo } from '../../types';
import { completeNow, openComposer, sendToVerify, startEdit, toggleTest, toggleTodo } from '../actions';
import { listHistoryDays } from '../data';
import { CheckIcon, ChevronDownIcon, EyeCheckIcon, PlusIcon } from '../icons';
import { beginDrag, dragGroup, DRAG_SLOP, type DragSession } from '../drag';
import { draftAfter, draftFirstUnder } from '../edit';
import { haptic } from '../native';
import { useTodos } from '../store';
import { rectOf, toggleExpanded, useUi } from '../ui';
import { Panes } from './Chrome';
import { Empty } from './Empty';
import { DayGroups, Stats } from './HistoryContent';
import { DraftRow } from './EditRows';
import { SwipeRow } from './SwipeRow';
import { rowSwipes, TitleEditor, TodoNode } from './TodoNode';

/** 接下来的行逐行变淡 */
const FADE = [1, 0.84, 0.68, 0.52];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 打开长按菜单（以元素当前的位置为准）；NOW 卡上的子任务是另一组菜单 */
function openMenu(todo: Todo, el: Element | null, moveFirst = false, from: 'list' | 'sub' = 'list') {
  if (!el) return;
  useUi.getState().set({
    menu: { todoId: todo.id, rect: rectOf(el), from, moveFirst },
    swipedId: null,
  });
}

/**
 * 长按：460ms 不动就算（按在按钮上不算）。浮起后手指再移动超过 DRAG_SLOP 就进入拖动（给了 onDragStart 时）。
 * 浮起期间拦住 touchmove，页面不跟着滚。
 */
function useLongPress(
  ref: RefObject<HTMLElement | null>,
  onLong: () => void,
  onDragStart?: (x: number, y: number) => DragSession | null,
) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const fired = useRef(false);
  const drag = useRef<DragSession | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = (e: TouchEvent) => {
      if (fired.current && start.current) e.preventDefault();
    };
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => el.removeEventListener('touchmove', onMove);
  }, [ref]);
  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
  };
  const finish = (cancelled: boolean) => {
    const s = drag.current;
    drag.current = null;
    if (s) {
      if (cancelled) s.cancel();
      else s.end();
    }
    cancel();
  };
  return {
    onPointerDown: (e: PointerEvent) => {
      fired.current = false;
      if ((e.target as HTMLElement).closest('button, textarea, input')) return;
      e.stopPropagation();
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      timer.current = setTimeout(() => {
        fired.current = true;
        haptic.medium();
        try {
          ref.current?.setPointerCapture(e.pointerId);
        } catch {}
        onLong();
      }, 460);
    },
    onPointerMove: (e: PointerEvent) => {
      const s = start.current;
      if (!s || e.pointerId !== s.id) return;
      if (drag.current) {
        drag.current.move(e.clientX, e.clientY);
        return;
      }
      const d = Math.hypot(e.clientX - s.x, e.clientY - s.y);
      if (!fired.current) {
        if (d > 9) cancel();
        return;
      }
      if (onDragStart && d > DRAG_SLOP) {
        drag.current = onDragStart(s.x, s.y);
        drag.current?.move(e.clientX, e.clientY);
      }
    },
    onPointerUp: () => finish(false),
    onPointerCancel: () => finish(true),
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
  // 编辑 NOW 的标题时回车：空行排在 NOW 后面，也就是「接下来」的第一条
  const draftAfterNow = useUi((s) => !!now && draftAfter(s.draft, now));

  return (
    <Panes
      section="focus"
      left={
        <>
          {now ? <NowCard key={now.id} todo={now} index={index} total={open.length} /> : <Empty section="focus" />}
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
          {(queue.length > 0 || draftAfterNow) && (
            <>
              <div className="q-head">
                <b>接下来</b>
                <span>{queue.length}</span>
              </div>
              {draftAfterNow && <DraftRow kind="q" />}
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

/** 子任务多于这个数时可以收起（收起后只露前 3 条） */
const FOLD_AT = 5;

function NowCard({ todo, index, total }: { todo: Todo; index: TreeIndex; total: number }) {
  const kids = childrenOf(index, todo.id);
  const editing = useUi((s) => s.editingId === todo.id);
  const handoff = useUi((s) => s.handoff === todo.id);
  const menuOpen = useUi((s) => s.menu?.todoId === todo.id);
  const folded = useUi((s) => !!s.subsFolded[todo.id]) && kids.length > FOLD_AT;
  const draftChild = useUi((s) => draftFirstUnder(s.draft, todo.id));
  const ref = useRef<HTMLDivElement>(null);
  const press = useLongPress(ref, () => openMenu(todo, ref.current));
  const shown = folded ? kids.slice(0, 3) : kids;
  const more = kids.length - shown.length;
  const setFolded = (v: boolean) => {
    const cur = { ...useUi.getState().subsFolded };
    if (v) cur[todo.id] = true;
    else delete cur[todo.id];
    useUi.getState().set({ subsFolded: cur });
  };

  return (
    <motion.div
      ref={ref}
      layoutId={`todo-${todo.id}`}
      layout="position"
      className={`now ${handoff ? 'is-handoff' : ''} ${menuOpen ? 'lifted' : ''}`}
      data-node-id={todo.id}
      data-anchor={todo.id}
      data-drop-now
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
        <div className="now-bar" aria-hidden>
          {kids.map((k) => (
            <i key={k.id} className={k.done ? 'on' : ''} />
          ))}
        </div>
      )}
      <div className="now-subs">
        {draftChild && <DraftRow kind="sub" />}
        {shown.map((k) => (
          <NowSub key={k.id} todo={k} index={index} depth={0} />
        ))}
        <div className="now-sub-actions">
          {/* 常驻的「+ 子任务」：父项就是 NOW，可以连续输入，新加的排在最后 */}
          <button className="now-add" onClick={() => openComposer('focus', todo.id)}>
            <PlusIcon />
            子任务
          </button>
          {more > 0 ? (
            <button className="now-more" onClick={() => setFolded(false)}>
              还有 {more} 条
            </button>
          ) : (
            kids.length > FOLD_AT && (
              <button className="now-more" onClick={() => setFolded(true)}>
                收起
              </button>
            )
          )}
        </div>
      </div>
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

/** NOW 卡上的子任务：点圆圈完成，点标题编辑（回车开下一行、可调层级），右边小眼睛切换待验证，长按出菜单 */
function NowSub({ todo, index, depth }: { todo: Todo; index: TreeIndex; depth: number }) {
  const kids = childrenOf(index, todo.id);
  const completing = useUi((s) => !!s.completing[todo.id]);
  const editing = useUi((s) => s.editingId === todo.id);
  const menuOpen = useUi((s) => s.menu?.todoId === todo.id);
  const draftNext = useUi((s) => draftAfter(s.draft, todo));
  const draftChild = useUi((s) => draftFirstUnder(s.draft, todo.id));
  const isNew = useUi((s) => !!s.added[todo.id]);
  const checked = todo.done || completing;
  const testing = !!todo.testing && !checked;
  const ref = useRef<HTMLDivElement>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const press = useLongPress(
    ref,
    () => openMenu(todo, ref.current, false, 'sub'),
    (x, y) => (nodeRef.current && ref.current ? beginDrag(todo, nodeRef.current, ref.current, x, y) : null),
  );
  return (
    <>
      {/* 一个子任务连同它的子项是一块：拖动时一起挪 */}
      <div
        ref={nodeRef}
        className="now-sub-node"
        data-node-id={todo.id}
        data-drag-group={checked ? undefined : dragGroup(todo, 'now')}
      >
        <div
          ref={ref}
          className={`now-sub ${checked ? 'done' : ''} ${menuOpen ? 'lifted' : ''} ${isNew ? 'is-new' : ''}`}
          data-anchor={todo.id}
          style={{ '--depth': depth } as CSSProperties}
          {...press}
        >
          <button
            className={`sc ${checked ? 'd' : testing ? 'v' : ''}`}
            role="checkbox"
            aria-checked={checked}
            aria-label={checked ? '标记为未完成' : '完成这个子任务'}
            onClick={() => toggleTodo(todo)}
          />
          <span className="now-sub-text" onClick={() => !editing && startEdit(todo.id)}>
            {editing ? <TitleEditor todo={todo} /> : todo.title}
            {testing && !editing && <span className="chip-v">待验证</span>}
          </span>
          {!checked && !editing && (
            <button
              className={`sub-eye ${testing ? 'on' : ''}`}
              aria-label={testing ? '取消待验证' : '设为待验证'}
              aria-pressed={testing}
              onClick={(e) => {
                e.stopPropagation();
                toggleTest(todo, e.currentTarget);
              }}
            >
              <EyeCheckIcon />
            </button>
          )}
        </div>
        {draftChild && <DraftRow kind="sub" depth={depth + 1} />}
        {kids.map((k) => (
          <NowSub key={k.id} todo={k} index={index} depth={depth + 1} />
        ))}
      </div>
      {draftNext && <DraftRow kind="sub" depth={depth} />}
    </>
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
  const draftNext = useUi((s) => draftAfter(s.draft, todo));
  const draftChild = useUi((s) => draftFirstUnder(s.draft, todo.id));
  const rowRef = useRef<HTMLDivElement>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  // 拖动松手那一刻不播位置动画：让位后的样子就是新顺序
  const dragging = useUi((s) => s.draggingId !== null);
  const open = (moveFirst = false) => openMenu(todo, rowRef.current, moveFirst);
  const { leading, trailing } = rowSwipes(todo, completing, open);
  const doneKids = kids.filter((k) => k.done).length;

  return (
    <motion.div
      ref={nodeRef}
      layoutId={`todo-${todo.id}`}
      layout="position"
      className={`q-node ${isNew ? 'is-new' : ''}`}
      data-node-id={todo.id}
      data-drag-group={dragGroup(todo)}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={dragging ? { duration: 0 } : { duration: 0.3, ease: [0.2, 0.8, 0.2, 1], delay: 0 }}
    >
      <div data-drag-body>
        <SwipeRow
          id={todo.id}
          leading={leading}
          trailing={trailing}
          onLongPress={() => open()}
          onDragStart={(x, y) =>
            nodeRef.current && rowRef.current ? beginDrag(todo, nodeRef.current, rowRef.current, x, y) : null
          }
          disabled={editing}
        >
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
        {expanded && (kids.length > 0 || draftChild) && (
          <div className="q-kids">
            {draftChild && <DraftRow kind="row" />}
            <AnimatePresence initial={false}>
              {kids.map((c) => (
                <TodoNode key={c.id} todo={c} depth={0} index={index} />
              ))}
            </AnimatePresence>
          </div>
        )}
        {draftNext && <DraftRow kind="q" />}
      </div>
    </motion.div>
  );
}

// ---------- 今天已完成（双页右页底下） ----------

function TodayDone({ todos, now }: { todos: Todo[]; now: number }) {
  const [open, setOpen] = useState(false);
  const days = useMemo(() => listHistoryDays(todos, 'focus').filter((d) => d.day === startOfToday(now)), [todos, now]);
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
