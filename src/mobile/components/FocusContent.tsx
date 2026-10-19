// FOCUS：聚焦区 →「接下来」（定稿 P4；桌面版见 src/components/FocusView.tsx）。
// 聚焦区是一整块面板：顶上荧光绿「✦ NOW」+「同时盯着 N 件」，每件一行：完成圈、压着荧光笔的标题、
// 「+」添加子任务、眼睛送去验证；有 2 个以上子任务时显示分段进度，子任务缩进排在下面。
// 聚焦区空着（FOCUS 里还有事）时是虚线框，一键放进下一件；FOCUS 整个空着时是原来的空状态。
// 「接下来」的序号接着聚焦区往下数，越往后越淡。双页时左页 = 聚焦区 + 统计，右页 = 新建框 + 接下来 + 今天已完成。
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from 'react';
import { buildIndex, childrenOf, rootsOf, startOfToday, type TreeIndex } from '../../model';
import type { Todo } from '../../types';
import { deleteWithUndo, openComposer, sendToVerify, setNow, startEdit, toggleTest, toggleTodo, unfocusTodo } from '../actions';
import { listHistoryDays } from '../data';
import { CheckIcon, ChevronDownIcon, DownIcon, EyeCheckIcon, PlusIcon, SparkFilledIcon, TrashIcon, UpIcon } from '../icons';
import { beginDrag, DRAG_SLOP, dragRowProps, type DragSession } from '../drag';
import { draftAfter, draftFirstUnder } from '../edit';
import { haptic } from '../native';
import { useTodos } from '../store';
import { rectOf, toggleExpanded, useUi } from '../ui';
import { Panes } from './Chrome';
import { Empty } from './Empty';
import { DayGroups, Stats } from './HistoryContent';
import { DraftRow } from './EditRows';
import { SwipeRow, type SwipeAction } from './SwipeRow';
import { rowSwipes, TitleEditor, TodoNode } from './TodoNode';

/** 接下来的行逐行变淡 */
const FADE = [1, 0.84, 0.68, 0.52];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 打开长按菜单（以元素当前的位置为准）；聚焦项下的子任务是另一组菜单 */
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
  // 聚焦区排在最前（见 model.compareTodos）
  const zone = open.filter((t) => t.focused);
  const queue = open.filter((t) => !t.focused);
  const today = useMemo(() => Date.now(), [todos]);

  return (
    <Panes
      section="focus"
      left={
        <>
          {zone.length ? (
            <FocusZone zone={zone} index={index} />
          ) : queue.length ? (
            <EmptyZone next={queue[0]} />
          ) : (
            <Empty section="focus" />
          )}
          <div className="only-spread" style={{ marginTop: open.length ? 14 : 24 }}>
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
                  <QueueNode key={t.id} todo={t} no={zone.length + i + 1} fade={FADE[i] ?? FADE[FADE.length - 1]} index={index} />
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

// ---------- 聚焦区 ----------

/** 子任务多于这么多条时可以收起（和桌面一样），收起后留几条 */
const FOLD_OVER = 8;
const FOLDED_SHOW = 4;

/** 聚焦区：同时盯着的几件事。拖进来、拖出去、在里面排序都走自由拖拽（drag.ts 看 data-zone） */
function FocusZone({ zone, index }: { zone: Todo[]; index: TreeIndex }) {
  const drop = useUi((s) => s.dropZone);
  return (
    <section className={`zone ${drop ? 'is-drop' : ''}`} data-zone aria-label="聚焦区">
      <div className="zone-head">
        <span className="zone-label">
          <b className="now-tag">
            <SparkFilledIcon />
            NOW
          </b>
          <span>同时盯着 {zone.length} 件</span>
        </span>
        <span className={`zone-hint ${drop ? 'on' : ''}`}>{drop ? '松手 = 加入聚焦' : '长按拖动排序'}</span>
      </div>
      <div className="zitems">
        <AnimatePresence initial={false}>
          {zone.map((t) => (
            <ZoneItem key={t.id} todo={t} index={index} />
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}

/** 聚焦项的左右滑：右滑完成；左滑 移出聚焦区 / 送去验证 / 删除（滑到底删除） */
function zoneSwipes(todo: Todo) {
  const leading: SwipeAction = { key: 'done', label: '完成', icon: <CheckIcon />, color: 'var(--sw-now)', run: () => toggleTodo(todo) };
  const trailing: SwipeAction[] = [
    { key: 'unfocus', label: '移出聚焦', icon: <DownIcon />, color: 'var(--sw-move)', run: () => unfocusTodo(todo) },
    { key: 'verify', label: '送去验证', icon: <EyeCheckIcon />, color: 'var(--sw-verify)', run: (el) => sendToVerify(todo, el) },
    { key: 'delete', label: '删除', icon: <TrashIcon />, color: 'var(--sw-delete)', fg: '#fff', run: () => deleteWithUndo(todo) },
  ];
  return { leading, trailing };
}

/**
 * 聚焦区里的一件：完成圈 + 标题（荧光笔）+「+」添加子任务 + 眼睛送去验证；进度和子任务在下面。
 * 触屏没有悬停：「+」常驻在标题行右侧（点按区域 44pt），其余操作在长按菜单和左滑里。
 */
function ZoneItem({ todo, index }: { todo: Todo; index: TreeIndex }) {
  const kids = childrenOf(index, todo.id);
  const completing = useUi((s) => !!s.completing[todo.id]);
  const editing = useUi((s) => s.editingId === todo.id);
  const menuOpen = useUi((s) => s.menu?.todoId === todo.id);
  // 刚放进聚焦区（设为现在、拖进来、新建）：荧光绿闪一下
  const flash = useUi((s) => !!s.added[todo.id]);
  const folded = useUi((s) => !!s.subsFolded[todo.id]) && kids.length > FOLD_OVER;
  const draftNext = useUi((s) => draftAfter(s.draft, todo));
  const draftChild = useUi((s) => draftFirstUnder(s.draft, todo.id));
  const nodeRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const { leading, trailing } = zoneSwipes(todo);
  const shown = folded ? kids.slice(0, FOLDED_SHOW) : kids;
  const doneKids = kids.filter((k) => k.done).length;
  const setFolded = (v: boolean) => {
    const cur = { ...useUi.getState().subsFolded };
    if (v) cur[todo.id] = true;
    else delete cur[todo.id];
    useUi.getState().set({ subsFolded: cur });
  };

  return (
    <motion.div
      ref={nodeRef}
      // 和「接下来」的行同一个 layoutId：设为现在 / 移出聚焦区时从原位置弹簧移过去
      layoutId={`todo-${todo.id}`}
      layout="position"
      className={['znode', completing && 'is-completing', flash && 'flash'].filter(Boolean).join(' ')}
      data-node-id={todo.id}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      // 完成：向上淡出、高度收起，下面的补位
      exit={{ opacity: 0, height: 0, y: -8 }}
      transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1], layout: { type: 'spring', stiffness: 380, damping: 30 } }}
    >
      <SwipeRow
        id={todo.id}
        leading={leading}
        trailing={trailing}
        onLongPress={() => openMenu(todo, headRef.current)}
        onDragStart={(x, y) => (nodeRef.current && headRef.current ? beginDrag(todo, nodeRef.current, headRef.current, x, y) : null)}
        disabled={editing || completing}
      >
        <div
          ref={headRef}
          className={`zhead ${menuOpen ? 'lifted' : ''}`}
          data-anchor={todo.id}
          data-zone-item={todo.id}
          {...dragRowProps(todo, 0, false)}
        >
          <button className="zring" role="checkbox" aria-checked={completing} aria-label="完成这一件" onClick={() => toggleTodo(todo)}>
            <CheckIcon />
          </button>
          <h3 className="ztitle" onClick={() => !editing && !completing && startEdit(todo.id)}>
            {editing ? <TitleEditor todo={todo} /> : <span className="mark">{todo.title}</span>}
          </h3>
          {!editing && (
            <>
              <button className="zbtn" aria-label="添加子任务" onClick={() => openComposer('focus', todo.id)}>
                <PlusIcon />
              </button>
              <button className="zbtn zeye" aria-label="做完了，送去验证" onClick={(e) => sendToVerify(todo, e.currentTarget)}>
                <EyeCheckIcon />
              </button>
            </>
          )}
        </div>
      </SwipeRow>
      {kids.length >= 2 && (
        <div className="zprog" aria-label={`子任务 ${doneKids}/${kids.length}`}>
          <span className="zbars" aria-hidden>
            {[...kids.filter((k) => k.done), ...kids.filter((k) => !k.done)].map((k) => (
              <i key={k.id} className={k.done ? 'd' : ''} />
            ))}
          </span>
          <span className="cnt">
            {doneKids}/{kids.length}
          </span>
        </div>
      )}
      {(shown.length > 0 || draftChild) && (
        <div className="zsubs">
          {draftChild && <DraftRow kind="sub" />}
          {shown.map((k) => (
            <ZoneSub key={k.id} todo={k} index={index} depth={0} />
          ))}
        </div>
      )}
      {kids.length > FOLD_OVER && (
        <button className="zmore" onClick={() => setFolded(!folded)}>
          {folded ? `还有 ${kids.length - shown.length} 条` : '收起'}
        </button>
      )}
      {/* 编辑聚焦项的标题时回车：新的一件也在聚焦区，接在它后面 */}
      {draftNext && <DraftRow kind="zone" />}
    </motion.div>
  );
}

/** 聚焦项下的子任务：点圆圈完成（和普通行同一套动画），点标题编辑，右边小眼睛切换待验证，长按出菜单、拖动 */
function ZoneSub({ todo, index, depth }: { todo: Todo; index: TreeIndex; depth: number }) {
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
  const cls = ['zsub', todo.done && !completing && 'd', completing && 'completing', menuOpen && 'lifted', isNew && 'is-new'];
  return (
    <>
      {/* 一个子任务连同它的子项是一块：拖动时一起挪 */}
      <div ref={nodeRef} className="zsub-node" data-node-id={todo.id}>
        <div
          ref={ref}
          className={cls.filter(Boolean).join(' ')}
          {...dragRowProps(todo, depth + 1, false)}
          data-anchor={todo.id}
          style={{ '--depth': depth } as CSSProperties}
          {...press}
        >
          <button
            className={`zcb ${testing ? 'v' : ''}`}
            role="checkbox"
            aria-checked={checked}
            aria-label={checked ? '标记为未完成' : '完成这个子任务'}
            onClick={() => toggleTodo(todo)}
          >
            <CheckIcon />
          </button>
          <span className="zsub-text" onClick={() => !editing && startEdit(todo.id)}>
            {editing ? <TitleEditor todo={todo} /> : <span className="tt-text">{todo.title}</span>}
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
          <ZoneSub key={k.id} todo={k} index={index} depth={depth + 1} />
        ))}
      </div>
      {draftNext && <DraftRow kind="sub" depth={depth} />}
    </>
  );
}

/** 聚焦区空着（FOCUS 里还有事）：虚线框，长按「接下来」里的一件拖上来就进聚焦区，或一键放进下一件 */
function EmptyZone({ next }: { next: Todo }) {
  const drop = useUi((s) => s.dropZone);
  return (
    <section className={`zone-empty ${drop ? 'is-drop' : ''}`} data-zone aria-label="聚焦区（空）">
      <span className="ze-icon">
        <SparkFilledIcon />
      </span>
      <b>{drop ? '松手 = 加入聚焦' : '聚焦区空着'}</b>
      <p>长按「接下来」里的一件拖上来，或左滑选「设为现在」</p>
      <button className="ze-next" onClick={() => setNow(next)}>
        <UpIcon />
        <span>放进下一件：{next.title}</span>
      </button>
    </section>
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
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1], delay: 0 }}
    >
      <div>
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
            {...dragRowProps(todo, 0, kids.length > 0 && !expanded)}
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
                <TodoNode key={c.id} todo={c} depth={0} base={1} index={index} />
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
