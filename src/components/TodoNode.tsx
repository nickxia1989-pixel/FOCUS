import { AnimatePresence, motion, type Variants } from 'motion/react';
import { useMemo, type CSSProperties, type MouseEvent } from 'react';
import { sendToFocus, sendToVerify, setNow, toggleTodo } from '../actions';
import { beginEdit, startAddChild } from '../editing';
import { withDraft, type Draft } from '../outline';
import { dragAttrs, startTreeDrag } from '../dnd';
import { exitModes, type ExitMode } from '../fx';
import { childrenOf, type TreeIndex } from '../model';
import { useData, useUi, type MenuState } from '../store';
import type { Todo } from '../types';
import { LIST_COLOR, LIST_SOFT } from './copy';
import { CheckIcon, ChevronIcon, EyeCheckIcon, GripIcon, MoreIcon, PlusIcon, SparkIcon, UpIcon } from './icons';
import { DraftRow, TitleEditor } from './Inputs';

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

export function openMenuAt(e: MouseEvent, todo: Todo, fromButton = false, kind?: MenuState['kind']) {
  e.preventDefault();
  e.stopPropagation();
  let x = e.clientX;
  let y = e.clientY;
  if (fromButton) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    x = r.right;
    y = r.bottom + 4;
  }
  useUi.getState().set({ menu: { x, y, todoId: todo.id, kind }, mainMenuOpen: false, profileMenuOpen: false });
}

export function startEdit(todo: Todo) {
  beginEdit(todo.id);
}

/** 空行的 key：换位置就换 key，重新挂载后从模块里接上文字 */
export const draftKey = (d: Draft) => `draft:${d.parentId}:${d.afterId}`;

interface Props {
  todo: Todo;
  depth: number;
  index: TreeIndex;
  /** queue = FOCUS「接下来」的行（序号、逐行变淡、悬停出现设为现在） */
  variant?: 'list' | 'queue';
  /** 队列序号（02、03…） */
  no?: number;
  fade?: number;
}

/** 一行待办和它的子项 */
export function TodoNode({ todo, depth, index, variant = 'list', no, fade = 1 }: Props) {
  const children = childrenOf(index, todo.id);
  const completing = useUi((s) => !!s.completing[todo.id]);
  const editing = useUi((s) => s.editingId === todo.id);
  const draft = useUi((s) => (s.draft?.parentId === todo.id ? s.draft : null));
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

  const checked = todo.done || completing;
  const testing = !!todo.testing && !checked;
  const root = depth === 0;
  const doneKids = children.filter((c) => c.done).length;
  const showChildren = (children.length > 0 && !folded) || !!draft;
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
        {...dragAttrs(todo, depth, { collapsed: children.length > 0 && folded, indent: 26 })}
        onPointerDown={(e) => startTreeDrag(e, todo, queue && no !== undefined ? { no: String(no).padStart(2, '0') } : {})}
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

        <span className={`tt ${checked && !completing ? 'done' : ''}`} data-edit-id={todo.id}>
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
                <button className="mini" title="添加子任务" onClick={() => startAddChild(todo.id)}>
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
          <AnimatePresence {...presenceProps}>
            {withDraft(folded ? [] : children, draft, todo.list, todo.id).map((c) =>
              c === 'draft' ? (
                <DraftRow key={draftKey(draft!)} />
              ) : (
                <TodoNode key={c.id} todo={c} depth={depth + 1} index={index} />
              ),
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}
