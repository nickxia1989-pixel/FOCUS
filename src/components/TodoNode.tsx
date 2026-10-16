import { AnimatePresence, motion } from 'motion/react';
import type { MouseEvent, PointerEvent } from 'react';
import { moveTodoTo, startAddChild, toggleTodo } from '../actions';
import { beginPointerDrag } from '../dnd';
import { childrenOf, descendantIds, type TreeIndex } from '../model';
import { useData, useUi } from '../store';
import type { Todo } from '../types';
import { ChildAdder, TitleEditor } from './Inputs';
import { ChevronIcon, MoreIcon, PlusIcon, TargetIcon } from './icons';
import { nodeMotion } from './motionPresets';

interface Props {
  todo: Todo;
  depth: number;
  index: TreeIndex;
  /** 同层兄弟（已排序），拖拽时取同状态的子集 */
  siblings: Todo[];
}

export function TodoNode({ todo, depth, index, siblings }: Props) {
  const children = childrenOf(index, todo.id);
  const completing = useUi((s) => !!s.completing[todo.id]);
  const editing = useUi((s) => s.editingId === todo.id);
  const addingChild = useUi((s) => s.addingChildOf === todo.id);
  const menuOpen = useUi((s) => s.menu?.todoId === todo.id);

  const checked = todo.done || completing;
  const doneKids = children.filter((c) => c.done).length;
  const showFocusBtn = todo.list === 'inbox' && depth === 0 && !checked;
  const showChildren = (children.length > 0 && !todo.collapsed) || addingChild;

  const onPointerDown = (e: PointerEvent) => {
    if (editing || completing) return;
    const all = useData.getState().todos;
    beginPointerDrag(e, {
      id: todo.id,
      list: todo.list,
      siblingIds: siblings.filter((s) => s.done === todo.done).map((s) => s.id),
      descendantCount: descendantIds(all, todo.id).size,
      onReorder: (id, to) => useData.getState().reorder(id, to),
      onMoveToList: (id, list) => {
        const t = useData.getState().todos.find((x) => x.id === id);
        if (t) moveTodoTo(t, list);
      },
      onHoverTab: (list) => useUi.getState().set({ dragOverTab: list }),
    });
  };

  const openMenu = (e: MouseEvent, fromButton = false) => {
    e.preventDefault();
    e.stopPropagation();
    if (fromButton) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      useUi.getState().set({ menu: { x: r.right, y: r.bottom + 4, todoId: todo.id } });
    } else {
      useUi.getState().set({ menu: { x: e.clientX, y: e.clientY, todoId: todo.id } });
    }
  };

  const rowClass = [
    'row',
    checked && 'done',
    completing && 'completing',
    menuOpen && 'menu-open',
    showFocusBtn && 'has-focus-btn',
    editing && 'editing',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <motion.div {...nodeMotion} className="node" data-node-id={todo.id} data-depth={depth}>
      <div
        className={rowClass}
        onPointerDown={onPointerDown}
        onContextMenu={(e) => openMenu(e)}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          useUi.getState().set({ editingId: todo.id, addingChildOf: null });
        }}
      >
        <button
          className="check"
          role="checkbox"
          aria-checked={checked}
          title={checked ? '标记为未完成' : '完成'}
          onClick={() => toggleTodo(todo)}
        >
          <svg viewBox="0 0 20 20" width="12" height="12" aria-hidden>
            <path d="M4.5 10.5l3.6 3.6 7.4-8" />
          </svg>
        </button>

        <div className="title">
          {editing ? <TitleEditor todo={todo} /> : <span className="title-text">{todo.title}</span>}
        </div>

        {/* 零宽锚点：悬停按钮浮在标题末尾，不遮挡右侧的进度胶囊 */}
        {!editing && (
          <div className="row-actions-anchor">
            <div className="row-actions">
              <button className="icon-btn" title="添加子任务" onClick={() => startAddChild(todo)}>
                <PlusIcon />
              </button>
              <button className="icon-btn" title="更多" onClick={(e) => openMenu(e, true)}>
                <MoreIcon />
              </button>
            </div>
          </div>
        )}

        {children.length > 0 && (
          <button
            className={`sub-progress ${todo.collapsed ? 'is-collapsed' : ''} ${doneKids === children.length ? 'is-full' : ''}`}
            title={todo.collapsed ? '展开子任务' : '收起子任务'}
            onClick={() => useData.getState().setCollapsed(todo.id, !todo.collapsed)}
          >
            {doneKids}/{children.length}
            <ChevronIcon width={12} height={12} />
          </button>
        )}

        {showFocusBtn && (
          <button className="to-focus" title="移到 FOCUS" onClick={(e) => moveTodoTo(todo, 'focus', e.currentTarget)}>
            <TargetIcon width={14} height={14} />
            <span className="to-focus-label">FOCUS</span>
          </button>
        )}
      </div>

      {showChildren && (
        <div className="children">
          {addingChild && <ChildAdder parent={todo} />}
          {!todo.collapsed && (
            <AnimatePresence initial={false}>
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
