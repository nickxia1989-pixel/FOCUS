import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { childrenOf, nowOf, type TreeIndex } from '../../model';
import type { Todo } from '../../types';
import { deleteWithUndo, sendToFocus, setNow, startEdit, toggleTest, toggleTodo } from '../actions';
import { CheckIcon, ChevronDownIcon, EyeCheckIcon, MoveIcon, SparkIcon, TrashIcon, UncheckIcon, UpIcon } from '../icons';
import { activeOf, useData } from '../store';
import { restored, saveTransient } from '../transient';
import { rectOf, useRefitOnWidth, useUi } from '../ui';
import { SwipeRow, type SwipeAction } from './SwipeRow';

export const nodeMotion = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto' },
  exit: { opacity: 0, height: 0 },
  transition: { duration: 0.3, ease: [0.2, 0.8, 0.2, 1] as const },
};

/** 一行的左右滑：右滑完成；左滑 设为现在 / 送去验证 / 移动 / 删除（滑到底删除） */
export function rowSwipes(todo: Todo, checked: boolean, openMenu: (moveFirst?: boolean) => void) {
  const leading: SwipeAction = checked
    ? { key: 'undo', label: '未完成', icon: <UncheckIcon />, color: 'var(--sw-move)', run: () => toggleTodo(todo) }
    : { key: 'done', label: '完成', icon: <CheckIcon />, color: 'var(--sw-now)', run: () => toggleTodo(todo) };
  const trailing: SwipeAction[] = [];
  if (!checked) {
    const isNow = nowOf(activeOf(useData.getState()).todos)?.id === todo.id;
    if (!isNow) trailing.push({ key: 'now', label: '设为现在', icon: <UpIcon />, color: 'var(--sw-now)', run: () => setNow(todo) });
    if (!(todo.list === 'verify' && todo.parentId === null))
      trailing.push({
        key: 'verify',
        label: todo.testing ? '取消待验证' : '送去验证',
        icon: <EyeCheckIcon />,
        color: 'var(--sw-verify)',
        run: (el) => toggleTest(todo, el),
      });
  }
  trailing.push({ key: 'move', label: '移动', icon: <MoveIcon />, color: 'var(--sw-move)', run: () => openMenu(true) });
  trailing.push({
    key: 'delete',
    label: '删除',
    icon: <TrashIcon />,
    color: 'var(--sw-delete)',
    fg: '#fff',
    run: () => deleteWithUndo(todo),
  });
  return { leading, trailing };
}

interface Props {
  todo: Todo;
  depth: number;
  index: TreeIndex;
  /** GOAL 卡片：标题加粗、子项只给折叠箭头、不显示任何进度 */
  goal?: boolean;
  /** 行下面再挂点东西（GOAL 卡的「写下于」） */
  below?: ReactNode;
}

export function TodoNode({ todo, depth, index, goal, below }: Props) {
  const children = childrenOf(index, todo.id);
  const completing = useUi((s) => !!s.completing[todo.id]);
  const editing = useUi((s) => s.editingId === todo.id);
  const menuOpen = useUi((s) => s.menu?.todoId === todo.id);
  const isNew = useUi((s) => !!s.added[todo.id]);

  const checked = todo.done || completing;
  const testing = !!todo.testing && !checked;
  const doneKids = children.filter((c) => c.done).length;
  // 星芒圆钮：INBOX 顶层未完成项 = 送进 FOCUS；VERIFY 顶层项 = 退回 FOCUS（都排在 NOW 之后）
  const spark = depth === 0 && !checked && (todo.list === 'inbox' || todo.list === 'verify');

  const rowRef = useRef<HTMLDivElement>(null);
  const openMenu = (moveFirst = false) => {
    const el = rowRef.current;
    if (!el) return;
    useUi.getState().set({ menu: { todoId: todo.id, rect: rectOf(el), from: 'list', moveFirst }, swipedId: null });
  };
  const { leading, trailing } = rowSwipes(todo, checked, openMenu);

  const rowClass = ['row', checked && 'done', completing && 'completing', testing && 'testing', menuOpen && 'lifted']
    .filter(Boolean)
    .join(' ');

  return (
    <motion.div {...nodeMotion} className={`node ${isNew ? 'is-new' : ''}`} data-node-id={todo.id}>
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
              <path d="m5 12.5 4.3 4.3L19 7.2" />
            </svg>
          </button>

          <div className="row-main" onClick={() => !editing && startEdit(todo.id)}>
            {editing ? <TitleEditor todo={todo} /> : <span className="row-title">{todo.title}</span>}
            {testing && !editing && (
              <button
                className="test-tag"
                aria-label="待验证，点按取消"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleTest(todo);
                }}
              >
                待验证
              </button>
            )}
          </div>

          {children.length > 0 &&
            !editing &&
            (goal ? (
              <button
                className={`fold ${todo.collapsed ? 'is-collapsed' : ''}`}
                aria-label={todo.collapsed ? '展开' : '收起'}
                onClick={() => useData.getState().setCollapsed(todo.id, !todo.collapsed)}
              >
                <ChevronDownIcon />
              </button>
            ) : (
              <button
                className={`pg ${todo.collapsed ? '' : 'is-open'}`}
                aria-label={todo.collapsed ? '展开子任务' : '收起子任务'}
                onClick={() => useData.getState().setCollapsed(todo.id, !todo.collapsed)}
              >
                {doneKids}/{children.length}
              </button>
            ))}

          {spark && !editing && (
            <button
              className="act"
              aria-label={todo.list === 'inbox' ? '送进 FOCUS' : '退回 FOCUS'}
              onClick={(e) => sendToFocus(todo, e.currentTarget)}
            >
              <SparkIcon />
            </button>
          )}
        </div>
      </SwipeRow>
      {below}

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
export function TitleEditor({ todo }: { todo: Todo }) {
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
