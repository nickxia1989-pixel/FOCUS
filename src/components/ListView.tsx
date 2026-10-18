import { AnimatePresence, motion } from 'motion/react';
import { useMemo, type CSSProperties, type ReactElement, type SVGProps } from 'react';
import { toggleTodo } from '../actions';
import { startAddChild } from '../editing';
import { dragAttrs, startTreeDrag } from '../dnd';
import { withDraft } from '../outline';
import { buildIndex, childrenOf, rootsOf, type TreeIndex } from '../model';
import { useData, useUi } from '../store';
import type { ListId, Todo, ViewId } from '../types';
import { LIST_COLOR, LIST_SOFT, VIEW_COPY } from './copy';
import { CheckIcon, ChevronIcon, MoreIcon, PlusIcon, SparkIcon, ViewIcons } from './icons';
import { AddBar, DraftRow, TitleEditor } from './Inputs';
import { draftKey, nodeVariants, openMenuAt, presenceProps, startEdit, TodoNode } from './TodoNode';

/** 叠放的空卡片插画：描边斜线卡 + 两张灰卡 + 星芒（或列表图标） */
export function EmptyArt({ view = 'focus', icon }: { view?: ViewId; icon?: (p: SVGProps<SVGSVGElement>) => ReactElement }) {
  const Icon = icon ?? (view === 'focus' ? SparkIcon : ViewIcons[view]);
  return (
    <div className="art" aria-hidden>
      <i className="c3" />
      <i className="c2" />
      <i className="c1" />
      <Icon />
    </div>
  );
}

export function EmptyState(props: {
  view: ViewId;
  small?: boolean;
  title?: string;
  text?: string;
  icon?: (p: SVGProps<SVGSVGElement>) => ReactElement;
}) {
  const copy = VIEW_COPY[props.view];
  return (
    <div className={`empty ${props.small ? 'small' : ''}`}>
      <EmptyArt view={props.view} icon={props.icon} />
      <b>{props.title ?? copy.emptyTitle}</b>
      <p>{props.text ?? copy.emptyText}</p>
    </div>
  );
}

/** 列表头：圆点 + 大标题 + 「中文副标 · 数字」 */
export function ListHead({ view, count }: { view: ViewId; count?: number }) {
  const copy = VIEW_COPY[view];
  return (
    <div className="lh" style={{ '--c': LIST_COLOR[view] } as CSSProperties}>
      <i />
      <b>{copy.en}</b>
      <span>
        {copy.cn}
        {count !== undefined && ` · ${count}`}
      </span>
    </div>
  );
}

/** 「已完成 · N」分组，可折叠（折叠状态存在本机偏好里） */
export function DoneGroup({ list, done, index }: { list: ListId; done: Todo[]; index: TreeIndex }) {
  const collapsed = useData((s) => !!s.prefs.doneCollapsed[list]);
  if (!done.length) return null;
  const toggle = () => {
    const prefs = useData.getState().prefs;
    useData.getState().setPrefs({ doneCollapsed: { ...prefs.doneCollapsed, [list]: !collapsed } });
  };
  return (
    <>
      <button className={`grp ${collapsed ? 'folded' : ''}`} onClick={toggle}>
        <ChevronIcon />
        已完成 · {done.length}
      </button>
      <AnimatePresence {...presenceProps}>
        {!collapsed &&
          done.map((t) =>
            list === 'goal' ? (
              <GoalCard key={t.id} todo={t} index={index} />
            ) : (
              <TodoNode key={t.id} todo={t} depth={0} index={index} />
            ),
          )}
      </AnimatePresence>
    </>
  );
}

const writtenOn = (t: number) => {
  const d = new Date(t);
  const y = d.getFullYear() === new Date().getFullYear() ? '' : `${d.getFullYear()} 年 `;
  return `写下于 ${y}${d.getMonth() + 1} 月 ${d.getDate()} 日`;
};

/**
 * GOAL：长期的自我提醒，每条一张卡。不显示任何进度（没有进度条、计数、「下一步」），
 * 做到了自己勾掉；有子项也只给一个折叠箭头。
 */
function GoalCard({ todo, index }: { todo: Todo; index: TreeIndex }) {
  const children = childrenOf(index, todo.id);
  const completing = useUi((s) => !!s.completing[todo.id]);
  const editing = useUi((s) => s.editingId === todo.id);
  const draft = useUi((s) => (s.draft?.parentId === todo.id ? s.draft : null));
  const menuOpen = useUi((s) => s.menu?.todoId === todo.id);
  const flash = useUi((s) => !!s.flash[todo.id]);
  const variants = useMemo(() => nodeVariants(todo.id), [todo.id]);
  const checked = todo.done || completing;
  const open = (children.length > 0 && !todo.collapsed) || !!draft;

  return (
    <motion.div layout="position" variants={variants} initial="initial" animate="enter" exit="exit" className="node" data-node-id={todo.id}>
      <div
        className={`goal ${checked && !completing ? 'done' : ''} ${completing ? 'completing' : ''} ${menuOpen ? 'menu-open' : ''} ${editing ? 'edit' : ''} ${flash ? 'flash' : ''}`}
        data-goal-id={todo.id}
        style={{ '--c': 'var(--goal)', '--cs': LIST_SOFT.goal } as CSSProperties}
        {...dragAttrs(todo, 0, { collapsed: children.length > 0 && !!todo.collapsed, indent: 24 })}
        onPointerDown={(e) => startTreeDrag(e, todo)}
        onContextMenu={(e) => openMenuAt(e, todo)}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          startEdit(todo);
        }}
      >
        {/* 标题和日期：摊平时这张卡的位置（子项在它下面） */}
        <div className="goal-head" data-drag-rect>
          <div className="h">
            <button
              className={`cb c ${checked && !completing ? 'done' : ''}`}
              role="checkbox"
              aria-checked={checked}
              title={checked ? '恢复为未完成' : '做到了'}
              onClick={() => toggleTodo(todo)}
            >
              <CheckIcon />
            </button>
            <span className="tt" data-edit-id={todo.id}>
              {editing ? <TitleEditor todo={todo} /> : <span className="tt-text">{todo.title}</span>}
            </span>
            {!editing && (
              <span className="acts">
                <span className="hov">
                  <button className="mini" title="添加子项" onClick={() => startAddChild(todo.id)}>
                    <PlusIcon />
                  </button>
                  <button className="mini" title="更多操作" onClick={(e) => openMenuAt(e, todo, true)}>
                    <MoreIcon />
                  </button>
                </span>
                {children.length > 0 && (
                  <button
                    className={`fold ${todo.collapsed ? 'folded' : ''}`}
                    title={todo.collapsed ? '展开' : '收起'}
                    onClick={() => useData.getState().setCollapsed(todo.id, !todo.collapsed)}
                  >
                    <ChevronIcon />
                  </button>
                )}
              </span>
            )}
          </div>
          <div className="m">{writtenOn(todo.createdAt)}</div>
        </div>
        {open && (
          <div className="children" onPointerDown={(e) => e.stopPropagation()}>
            <AnimatePresence {...presenceProps}>
              {withDraft(todo.collapsed ? [] : children, draft, todo.list, todo.id).map((c) =>
                c === 'draft' ? (
                  <DraftRow key={draftKey(draft!)} />
                ) : (
                  <TodoNode key={c.id} todo={c} depth={1} index={index} />
                ),
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** VERIFY / INBOX / GOAL：列表头 → 新建框 → 行（GOAL 是卡片） */
export function ListView({ list }: { list: Exclude<ListId, 'focus'> }) {
  const todos = useData((s) => s.todos);
  const draft = useUi((s) => (s.draft?.parentId === null && s.draft.list === list ? s.draft : null));
  const index = useMemo(() => buildIndex(todos), [todos]);
  const roots = rootsOf(index, list);
  const open = roots.filter((t) => !t.done);
  const done = roots.filter((t) => t.done);

  return (
    <>
      <ListHead view={list} count={open.length} />
      <AddBar list={list} />
      {roots.length === 0 ? (
        <EmptyState view={list} small />
      ) : (
        <div className={`rows ${list === 'goal' ? 'goals' : 'list'}`}>
          <AnimatePresence {...presenceProps}>
            {withDraft(open, draft, list, null).map((t) =>
              t === 'draft' ? (
                <DraftRow key={draftKey(draft!)} />
              ) : list === 'goal' ? (
                <GoalCard key={t.id} todo={t} index={index} />
              ) : (
                <TodoNode key={t.id} todo={t} depth={0} index={index} />
              ),
            )}
          </AnimatePresence>
          <DoneGroup list={list} done={done} index={index} />
        </div>
      )}
    </>
  );
}
