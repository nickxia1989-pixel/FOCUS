import { AnimatePresence, motion } from 'motion/react';
import type { MouseEvent, PointerEvent } from 'react';
import { markForTest, moveTodoTo, startAddChild, toggleTest, toggleTodo } from '../actions';
import { beginPointerDrag } from '../dnd';
import { childrenOf, descendantIds, type TreeIndex } from '../model';
import { useData, useUi } from '../store';
import type { ListId, Todo } from '../types';
import { ChildAdder, TitleEditor } from './Inputs';
import { ChevronIcon, FlaskIcon, MoreIcon, PlusIcon, TargetIcon } from './icons';
import { nodeMotion } from './motionPresets';

/** 常驻的流转按钮（只给未完成的顶层项）：INBOX → FOCUS，FOCUS → 待测 */
const FLOW_NEXT: Partial<Record<ListId, 'focus' | 'verify'>> = { inbox: 'focus', focus: 'verify' };

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
  const testing = !!todo.testing && !checked;
  const isVerifyRoot = depth === 0 && todo.list === 'verify';
  const doneKids = children.filter((c) => c.done).length;
  const showChildren = (children.length > 0 && !todo.collapsed) || addingChild;
  const flow = depth === 0 && !checked ? (FLOW_NEXT[todo.list] ?? null) : null;
  const runFlow = (target: 'focus' | 'verify', el: Element) =>
    target === 'verify' ? markForTest(todo, el) : moveTodoTo(todo, 'focus', el);

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
        if (!t) return;
        // 拖到页签是明确的"换页签"：子项也照搬过去；顶层项进 VERIFY 走标待测的动效
        if (list === 'verify' && t.parentId === null) markForTest(t);
        else moveTodoTo(t, list);
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
    testing && 'testing',
    flow && 'has-flow-btn',
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
          {testing && !editing && (
            <button className="test-tag" title="待测中，点击取消待测" onClick={() => toggleTest(todo)}>
              <FlaskIcon width={11} height={11} />
              待测
            </button>
          )}
        </div>

        {/* 零宽锚点：悬停按钮浮在标题末尾，不遮挡右侧的进度胶囊 */}
        {!editing && (
          <div className="row-actions-anchor">
            <div className="row-actions">
              {isVerifyRoot ? (
                <button
                  className="icon-btn icon-btn-focus"
                  title="没测过，退回 FOCUS"
                  onClick={(e) => moveTodoTo(todo, 'focus', e.currentTarget)}
                >
                  <TargetIcon />
                </button>
              ) : (
                flow !== 'verify' && (
                  <button
                    className={`icon-btn icon-btn-verify ${testing ? 'is-on' : ''}`}
                    title={testing ? '取消待测' : depth > 0 ? '标为待测（留在原处）' : '做完了，标为待测'}
                    onClick={(e) => toggleTest(todo, e.currentTarget)}
                  >
                    <FlaskIcon />
                  </button>
                )
              )}
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

        {flow && (
          <button
            className={`flow-btn flow-${flow}`}
            title={flow === 'focus' ? '移到 FOCUS' : '做完了，标为待测'}
            onClick={(e) => runFlow(flow, e.currentTarget)}
          >
            {flow === 'focus' ? <TargetIcon width={14} height={14} /> : <FlaskIcon width={14} height={14} />}
            <span className="flow-label">{flow === 'focus' ? 'FOCUS' : '待测'}</span>
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
