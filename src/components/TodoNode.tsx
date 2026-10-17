import { AnimatePresence, motion, type Variants } from 'motion/react';
import { useMemo, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { moveTodoTo, sendToFocus, sendToVerify, setNow, startAddChild, toggleTodo } from '../actions';
import { beginPointerDrag } from '../dnd';
import { exitModes, type ExitMode } from '../fx';
import { childrenOf, descendantIds, type TreeIndex } from '../model';
import { useData, useUi } from '../store';
import type { Todo } from '../types';
import { LIST_COLOR, LIST_SOFT } from './copy';
import { CheckIcon, ChevronIcon, EyeCheckIcon, GripIcon, MoreIcon, PlusIcon, SparkIcon, UpIcon } from './icons';
import { ChildAdder, TitleEditor } from './Inputs';

const EASE = [0.2, 0.8, 0.2, 1] as const;
const SPRING = [0.3, 1.25, 0.4, 1] as const;

/** 行的进场 / 离场：新建时高度撑开 180ms 并从上方 8px 落下 */
export function nodeVariants(id: string): Variants {
  return {
    initial: { opacity: 0, height: 0, y: -8 },
    enter: {
      opacity: 1,
      height: 'auto',
      y: 0,
      transition: { height: { duration: 0.18, ease: EASE }, y: { duration: 0.3, ease: SPRING }, opacity: { duration: 0.18 } },
    },
    exit: (modes?: Map<string, ExitMode>) => {
      const mode = modes?.get(id);
      if (mode === 'instant') return { opacity: 0, transition: { duration: 0 } };
      if (mode === 'collapse') return { opacity: 0, height: 0, transition: { opacity: { duration: 0 }, height: { duration: 0.2, ease: EASE } } };
      return { opacity: 0, height: 0, transition: { duration: 0.24, ease: EASE } };
    },
  };
}

export const presenceProps = { initial: false, custom: exitModes } as const;

/** 同层排序、拖到页签换列表；FOCUS 队列的行还能拖到 NOW 卡上设为现在 */
export function useRowDrag(todo: Todo, siblings: Todo[], opts: { queueOffset?: number; canDropNow?: boolean } = {}) {
  return (e: PointerEvent) => {
    const ui = useUi.getState();
    if (ui.editingId === todo.id || ui.completing[todo.id]) return;
    const all = useData.getState().todos;
    const offset = opts.queueOffset ?? 0;
    beginPointerDrag(e, {
      id: todo.id,
      list: todo.list,
      siblingIds: siblings.filter((s) => s.done === todo.done).map((s) => s.id),
      descendantCount: descendantIds(all, todo.id).size,
      // 队列不含 NOW：插入位置要跳过它
      onReorder: (id, to) => useData.getState().reorder(id, to + offset),
      onMoveToList: (id, list) => {
        const t = useData.getState().todos.find((x) => x.id === id);
        if (t) moveTodoTo(t, list);
      },
      onHoverTab: (list) => useUi.getState().set({ dragOverTab: list }),
      ...(opts.canDropNow
        ? {
            onHoverNow: (over: boolean) => useUi.getState().set({ dropNow: over }),
            onDropNow: (id: string, rect: DOMRect) => {
              const t = useData.getState().todos.find((x) => x.id === id);
              if (t) setNow(t, rect);
            },
          }
        : {}),
    });
  };
}

export function openMenuAt(e: MouseEvent, todo: Todo, fromButton = false) {
  e.preventDefault();
  e.stopPropagation();
  if (fromButton) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    useUi.getState().set({ menu: { x: r.right, y: r.bottom + 4, todoId: todo.id }, mainMenuOpen: false, profileMenuOpen: false });
  } else {
    useUi.getState().set({ menu: { x: e.clientX, y: e.clientY, todoId: todo.id }, mainMenuOpen: false, profileMenuOpen: false });
  }
}

export function startEdit(todo: Todo) {
  useUi.getState().set({ editingId: todo.id, addingChildOf: null, menu: null });
}

interface Props {
  todo: Todo;
  depth: number;
  index: TreeIndex;
  /** 同层兄弟（已排序），拖拽时取同状态的子集 */
  siblings: Todo[];
  /** queue = FOCUS「接下来」的行（序号、逐行变淡、悬停出现设为现在） */
  variant?: 'list' | 'queue';
  /** 队列序号（02、03…） */
  no?: number;
  fade?: number;
}

/** 一行待办和它的子项 */
export function TodoNode({ todo, depth, index, siblings, variant = 'list', no, fade = 1 }: Props) {
  const children = childrenOf(index, todo.id);
  const completing = useUi((s) => !!s.completing[todo.id]);
  const editing = useUi((s) => s.editingId === todo.id);
  const addingChild = useUi((s) => s.addingChildOf === todo.id);
  const menuOpen = useUi((s) => s.menu?.todoId === todo.id);
  const flash = useUi((s) => !!s.flash[todo.id]);
  const queueOpen = useUi((s) => !!s.queueOpen[todo.id]);
  const variants = useMemo(() => nodeVariants(todo.id), [todo.id]);
  const queue = variant === 'queue';
  // 队列里的行默认收起子任务（只看标题），点进度胶囊展开；其它列表按各条自己的折叠状态
  const folded = queue ? !queueOpen : !!todo.collapsed;
  const toggleFold = () => {
    if (!queue) return useData.getState().setCollapsed(todo.id, !todo.collapsed);
    const cur = { ...useUi.getState().queueOpen };
    if (cur[todo.id]) delete cur[todo.id];
    else cur[todo.id] = true;
    useUi.getState().set({ queueOpen: cur });
  };
  const onPointerDown = useRowDrag(todo, siblings, queue ? { queueOffset: 1, canDropNow: true } : {});

  const checked = todo.done || completing;
  const testing = !!todo.testing && !checked;
  const root = depth === 0;
  const doneKids = children.filter((c) => c.done).length;
  const showChildren = (children.length > 0 && !folded) || addingChild;
  // 列表色：FOCUS 用正文色（勾用底色），子项跟随所在列表
  const color = LIST_COLOR[todo.list];
  // VERIFY 顶层 = 退回 FOCUS，INBOX 顶层 = 送进 FOCUS
  const sparkAct = root && !checked && (todo.list === 'verify' || todo.list === 'inbox') && !queue;

  const rowClass = [
    'row',
    queue && 'q',
    completing && 'completing',
    menuOpen && 'menu-open',
    editing && 'edit',
    flash && 'flash',
  ]
    .filter(Boolean)
    .join(' ');

  const cbClass = ['cb', !queue && 'c', checked && !completing && 'done', testing && 'vf', todo.list === 'focus' && 'ink'].filter(Boolean).join(' ');

  return (
    <motion.div
      layout="position"
      variants={variants}
      initial="initial"
      animate="enter"
      exit="exit"
      className={`node ${queue ? 'qn' : ''}`}
      style={queue ? ({ '--fade': fade } as CSSProperties) : undefined}
      data-node-id={todo.id}
      data-depth={depth}
    >
      <div
        className={rowClass}
        style={{ '--c': color, '--cs': LIST_SOFT[todo.list] } as CSSProperties}
        onPointerDown={onPointerDown}
        onContextMenu={(e) => openMenuAt(e, todo)}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          startEdit(todo);
        }}
      >
        {queue && (
          <span className="grip">
            <GripIcon />
          </span>
        )}
        {queue && no !== undefined && <span className="no">{String(no).padStart(2, '0')}</span>}
        <button
          className={cbClass}
          role="checkbox"
          aria-checked={checked}
          title={checked ? '恢复为未完成' : todo.list === 'verify' && root ? '测完了' : '完成'}
          onClick={() => toggleTodo(todo)}
        >
          <CheckIcon />
        </button>

        <span className={`tt ${checked && !completing ? 'done' : ''}`}>
          {editing ? (
            <TitleEditor todo={todo} />
          ) : (
            <span className="tt-text">{todo.title}</span>
          )}
          {testing && !editing && (
            <button className="tag" title="待验证，点一下取消" onClick={() => sendToVerify(todo)}>
              待验证
            </button>
          )}
        </span>

        {!editing && (
          <span className="acts">
            <span className="hov">
              {queue ? (
                <>
                  <button className="mini" title="设为现在" onClick={() => setNow(todo)}>
                    <UpIcon />
                  </button>
                  <button className="mini" title="送去验证" onClick={(e) => sendToVerify(todo, e.currentTarget)}>
                    <EyeCheckIcon />
                  </button>
                </>
              ) : (
                <button className="mini" title="添加子任务" onClick={() => startAddChild(todo)}>
                  <PlusIcon />
                </button>
              )}
              <button className="mini" title="更多操作" onClick={(e) => openMenuAt(e, todo, true)}>
                <MoreIcon />
              </button>
            </span>
            {children.length > 0 && (
              <button className={`prog ${folded ? 'folded' : ''}`} title={folded ? '展开子任务' : '收起子任务'} onClick={toggleFold}>
                {doneKids}/{children.length}
                <ChevronIcon />
              </button>
            )}
            {sparkAct && (
              <button
                className="act spark"
                title={todo.list === 'verify' ? '没测过，退回 FOCUS' : '送进 FOCUS（排在现在之后）'}
                onClick={(e) => sendToFocus(todo, e.currentTarget)}
              >
                <SparkIcon />
              </button>
            )}
          </span>
        )}
      </div>

      {showChildren && (
        <div className="children">
          {addingChild && <ChildAdder parent={todo} />}
          {!folded && (
            <AnimatePresence {...presenceProps}>
              {children.map((c) => (
                <TodoNode key={c.id} todo={c} depth={depth + 1} index={index} siblings={children} />
              ))}
            </AnimatePresence>
          )}
        </div>
      )}
    </motion.div>
  );
}
