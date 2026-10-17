import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { childrenOf, type TreeIndex } from '../../model';
import type { ListId, Todo } from '../../types';
import { deleteWithUndo, markForTest, moveTodoTo, startEdit, toggleTest, toggleTodo } from '../actions';
import { CheckIcon, ChevronDownIcon, FlaskIcon, MoveIcon, TargetIcon, TrashIcon, UncheckIcon } from '../icons';
import { useData } from '../store';
import { restored, saveTransient } from '../transient';
import { rectOf, useRefitOnWidth, useUi } from '../ui';
import { SwipeRow, type SwipeAction } from './SwipeRow';

/** 常驻的流转按钮（只给未完成的顶层项）：INBOX → FOCUS，FOCUS → 待测 */
const FLOW_NEXT: Partial<Record<ListId, 'focus' | 'verify'>> = { inbox: 'focus', focus: 'verify' };

export const nodeMotion = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto' },
  exit: { opacity: 0, height: 0 },
  transition: { duration: 0.3, ease: [0.3, 0.7, 0.2, 1] as const },
};

interface Props {
  todo: Todo;
  depth: number;
  index: TreeIndex;
}

export function TodoNode({ todo, depth, index }: Props) {
  const children = childrenOf(index, todo.id);
  const completing = useUi((s) => !!s.completing[todo.id]);
  const editing = useUi((s) => s.editingId === todo.id);
  const menuOpen = useUi((s) => s.menu?.todoId === todo.id);

  const checked = todo.done || completing;
  const testing = !!todo.testing && !checked;
  const doneKids = children.filter((c) => c.done).length;
  const flow = depth === 0 && !checked ? (FLOW_NEXT[todo.list] ?? null) : null;

  const leading: SwipeAction = checked
    ? { key: 'undo', label: '未完成', icon: <UncheckIcon />, color: 'var(--gray-action)', run: () => toggleTodo(todo) }
    : { key: 'done', label: '完成', icon: <CheckIcon />, color: `var(--c-${todo.list})`, run: () => toggleTodo(todo) };

  const trailing: SwipeAction[] = [];
  if (!checked) {
    if (depth === 0 && todo.list === 'verify')
      trailing.push({
        key: 'back',
        label: '退回',
        icon: <TargetIcon />,
        color: 'var(--c-focus)',
        run: (el) => moveTodoTo(todo, 'focus', el),
      });
    else if (todo.list === 'inbox' && depth === 0)
      trailing.push({
        key: 'focus',
        label: 'FOCUS',
        icon: <TargetIcon />,
        color: 'var(--c-focus)',
        run: (el) => moveTodoTo(todo, 'focus', el),
      });
    else
      trailing.push({
        key: 'test',
        label: testing ? '取消待测' : '待测',
        icon: <FlaskIcon />,
        color: 'var(--c-verify)',
        run: (el) => toggleTest(todo, el),
      });
  }
  trailing.push({
    key: 'move',
    label: '移动',
    icon: <MoveIcon />,
    color: 'var(--gray-action)',
    run: () => openMenu(true),
  });
  trailing.push({
    key: 'delete',
    label: '删除',
    icon: <TrashIcon />,
    color: 'var(--danger)',
    run: () => deleteWithUndo(todo),
  });

  const rowRef = useRef<HTMLDivElement>(null);
  const openMenu = (moveFirst = false) => {
    const el = rowRef.current;
    if (!el) return;
    useUi.getState().set({ menu: { todoId: todo.id, rect: rectOf(el), from: 'list', moveFirst }, swipedId: null });
  };

  const rowClass = ['row', checked && 'done', completing && 'completing', testing && 'testing', menuOpen && 'lifted']
    .filter(Boolean)
    .join(' ');

  return (
    <motion.div {...nodeMotion} className="node" data-node-id={todo.id}>
      <SwipeRow id={todo.id} leading={leading} trailing={trailing} onLongPress={() => openMenu()} disabled={editing}>
        <div
          ref={rowRef}
          data-anchor={todo.id}
          className={rowClass}
          style={{ '--depth': depth, '--c': `var(--c-${todo.list})` } as CSSProperties}
        >
          <button
            className="check"
            role="checkbox"
            aria-checked={checked}
            aria-label={checked ? '标记为未完成' : '完成'}
            onClick={() => toggleTodo(todo)}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="m6.5 12.5 3.7 3.7 7.4-8" />
            </svg>
          </button>

          <div className="row-main" onClick={() => !editing && startEdit(todo.id)}>
            {editing ? <TitleEditor todo={todo} /> : <span className="row-title">{todo.title}</span>}
            {testing && !editing && (
              <button
                className="test-tag"
                aria-label="待测中，点按取消待测"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleTest(todo);
                }}
              >
                <FlaskIcon width={12} height={12} />
                待测
              </button>
            )}
          </div>

          {children.length > 0 && !editing && (
            <button
              className={`sub-pill ${todo.collapsed ? 'is-collapsed' : ''} ${doneKids === children.length ? 'is-full' : ''}`}
              aria-label={todo.collapsed ? '展开子任务' : '收起子任务'}
              onClick={() => useData.getState().setCollapsed(todo.id, !todo.collapsed)}
            >
              {doneKids}/{children.length}
              <ChevronDownIcon width={14} height={14} />
            </button>
          )}

          {flow && !editing && (
            <button
              className={`flow-btn flow-${flow}`}
              aria-label={flow === 'focus' ? '移到 FOCUS' : '做完了，标为待测'}
              onClick={(e) =>
                flow === 'verify' ? markForTest(todo, e.currentTarget) : moveTodoTo(todo, 'focus', e.currentTarget)
              }
            >
              {flow === 'focus' ? <TargetIcon width={18} height={18} /> : <FlaskIcon width={18} height={18} />}
            </button>
          )}
        </div>
      </SwipeRow>

      {children.length > 0 && !todo.collapsed && (
        <div className="children">
          <AnimatePresence initial={false}>
            {children.map((c) => (
              <TodoNode key={c.id} todo={c} depth={depth + 1} index={index} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}

/** 原地编辑标题：回车或失焦保存，Esc 取消 */
function TitleEditor({ todo }: { todo: Todo }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  // 开始编辑时的知识：编辑期间远端也改了这条标题，提交时会变成冲突，不会悄悄盖掉远端
  const base = useRef(useData.getState().clock.knowledge);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useLayoutEffect(fit, [fit]);
  useRefitOnWidth(ref, fit);

  // 折叠 / 展开导致页面重载时恢复出来的草稿（只用一次）
  const [initial] = useState(() => {
    const draft = restored.editing?.id === todo.id ? restored.editing.text : null;
    restored.editing = undefined;
    return draft ?? todo.title;
  });

  const commit = () => {
    saveTransient({ editing: undefined });
    if (!cancelled.current && ref.current && ref.current.value.trim() !== todo.title)
      useData.getState().rename(todo.id, ref.current.value, base.current);
    if (useUi.getState().editingId === todo.id) useUi.getState().set({ editingId: null });
  };

  // iOS 上点空白处不会让输入框失焦：点到编辑框以外的任何地方都结束编辑
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = ref.current;
      if (!el || el.contains(e.target as Node)) return;
      if (document.activeElement === el) el.blur();
      else commit();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  return (
    <textarea
      ref={ref}
      className="row-edit"
      data-edit-input={todo.id}
      defaultValue={initial}
      rows={1}
      enterKeyHint="done"
      onInput={(e) => {
        fit();
        saveTransient({ editing: { id: todo.id, text: e.currentTarget.value } });
      }}
      onFocus={() => {
        // 键盘弹出后把正在编辑的行滚到可见处（WebView 不随键盘缩小）
        setTimeout(() => ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 320);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
          e.preventDefault();
          ref.current?.blur();
        } else if (e.key === 'Escape') {
          cancelled.current = true;
          ref.current?.blur();
        }
      }}
    />
  );
}
