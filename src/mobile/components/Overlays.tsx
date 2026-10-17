// 浮层：长按菜单、⋯ 下拉菜单、提示条
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { LISTS, type ListId, type Todo } from '../../types';
import {
  deleteWithUndo,
  goSection,
  listLabel,
  moveTodoTo,
  openComposer,
  startEdit,
  toggleTest,
  toggleTodo,
  undoDelete,
} from '../actions';
import {
  CheckIcon,
  ChevronRightIcon,
  EditIcon,
  FlaskIcon,
  HapticIcon,
  MoveIcon,
  RestoreIcon,
  SectionIcons,
  SoundIcon,
  SubtaskIcon,
  SwapIcon,
  CloudIcon,
  TargetIcon,
  TrashIcon,
  UncheckIcon,
} from '../icons';
import { activeOf, useData, useTodos } from '../store';
import { useUi, type Rect } from '../ui';

/** 读安全区（env() 只能在 CSS 里取，借一个探针元素） */
function safeInsets() {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const r = {
    top: parseFloat(cs.paddingTop) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
  };
  probe.remove();
  return r;
}

/** 浮层横向可用的范围 [左, 右]：双页布局时限制在 rect 所在的那一页 */
function pageBounds(rect: Rect, pad: number): [number, number] {
  const vw = window.innerWidth;
  const app = document.querySelector<HTMLElement>('.app.is-spread');
  if (!app) return [pad, vw - pad];
  const cs = getComputedStyle(app);
  const leftEnd = parseFloat(cs.getPropertyValue('--page-l-end'));
  const rightStart = parseFloat(cs.getPropertyValue('--page-r-start'));
  if (!leftEnd || !rightStart) return [pad, vw - pad];
  return rect.left + rect.width / 2 < leftEnd ? [pad, leftEnd - pad] : [rightStart + pad, vw - pad];
}

// ---------- 长按菜单 ----------

interface Item {
  key: string;
  label: string;
  icon: ReactNode;
  run(): void;
  danger?: boolean;
  disabled?: boolean;
  /** 打开子菜单，不关闭整个菜单 */
  submenu?: boolean;
  tag?: string;
}

export function ContextMenu() {
  const menu = useUi((s) => s.menu);
  const todos = useTodos();
  const todo = menu ? todos.find((t) => t.id === menu.todoId) : undefined;
  return (
    <AnimatePresence>
      {menu && todo && (
        <MenuBody key={menu.todoId} todo={todo} rect={menu.rect} from={menu.from} moveFirst={!!menu.moveFirst} />
      )}
    </AnimatePresence>
  );
}

function MenuBody({
  todo,
  rect,
  from,
  moveFirst,
}: {
  todo: Todo;
  rect: Rect;
  from: 'list' | 'history';
  moveFirst: boolean;
}) {
  const [page, setPage] = useState<'main' | 'move'>(moveFirst ? 'move' : 'main');
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuH, setMenuH] = useState(0);
  const close = () => useUi.getState().set({ menu: null });
  const completing = useUi((s) => !!s.completing[todo.id]);
  const checked = todo.done || completing;

  useLayoutEffect(() => {
    if (menuRef.current) setMenuH(menuRef.current.offsetHeight);
  }, [page]);

  const groups: Item[][] =
    from === 'history'
      ? [
          [
            {
              key: 'undone',
              label: '标记为未完成',
              icon: <UncheckIcon />,
              run: () => useData.getState().uncomplete(todo.id),
            },
            {
              key: 'goto',
              label: `在 ${listLabel(todo.list)} 中查看`,
              icon: (() => {
                const I = SectionIcons[todo.list];
                return <I />;
              })(),
              run: () => goSection(todo.list),
            },
          ],
          [{ key: 'delete', label: '删除', icon: <TrashIcon />, danger: true, run: () => deleteWithUndo(todo) }],
        ]
      : [
          [
            checked
              ? { key: 'undone', label: '标记为未完成', icon: <UncheckIcon />, run: () => toggleTodo(todo) }
              : { key: 'done', label: '完成', icon: <CheckIcon />, run: () => toggleTodo(todo) },
            { key: 'edit', label: '编辑', icon: <EditIcon />, run: () => startEdit(todo.id) },
            { key: 'sub', label: '添加子任务', icon: <SubtaskIcon />, run: () => openComposer(todo.list, todo.id) },
          ],
          [
            todo.parentId === null && todo.list === 'verify' && !checked
              ? { key: 'back', label: '没测过，退回 FOCUS', icon: <TargetIcon />, run: () => moveTodoTo(todo, 'focus') }
              : {
                  key: 'test',
                  label:
                    todo.testing && !checked ? '取消待测' : todo.parentId ? '标为待测（留在原处）' : '做完了，标为待测',
                  icon: <FlaskIcon />,
                  run: () => toggleTest(todo),
                },
            { key: 'move', label: '移到…', icon: <MoveIcon />, submenu: true, run: () => setPage('move') },
          ],
          [{ key: 'delete', label: '删除', icon: <TrashIcon />, danger: true, run: () => deleteWithUndo(todo) }],
        ];

  const moveItems: Item[] = LISTS.map((l) => {
    const Icon = SectionIcons[l.id];
    const same = l.id === todo.list;
    return {
      key: l.id,
      label: same && todo.parentId ? `移出父项（留在 ${l.label}）` : l.label,
      icon: <Icon style={{ color: `var(--c-${l.id})` }} />,
      disabled: same && !todo.parentId,
      tag: same && !todo.parentId ? '当前' : l.hint,
      run: () => moveTodoTo(todo, l.id as ListId),
    };
  });

  // 位置：预览卡片尽量留在原处，菜单放在下方，放不下就放上方，再不行把预览往上推
  const vh = window.innerHeight;
  const safe = safeInsets();
  const pad = 12;
  // 横向能用的范围：整屏；双页时只在长按的那一页里，不压折痕
  const [lo, hi] = pageBounds(rect, pad);
  const previewW = Math.min(rect.width - 8, hi - lo);
  const previewH = Math.min(rect.height, 132);
  const previewLeft = Math.min(Math.max(rect.left + 4, lo), hi - previewW);
  const menuW = Math.min(268, hi - lo);
  const menuLeft = Math.min(Math.max(previewLeft, lo), hi - menuW);
  const h = menuH || 300;
  const top0 = safe.top + pad;
  const bottom0 = vh - safe.bottom - pad;
  let previewTop = rect.top;
  let menuTop: number;
  let below = true;
  if (previewTop + previewH + 10 + h <= bottom0) menuTop = previewTop + previewH + 10;
  else if (previewTop - 10 - h >= top0) {
    menuTop = previewTop - 10 - h;
    below = false;
  } else {
    previewTop = Math.max(top0, bottom0 - h - 10 - previewH);
    menuTop = previewTop + previewH + 10;
  }

  const runItem = (it: Item) => {
    if (it.disabled) return;
    if (!it.submenu) close();
    it.run();
  };

  const renderItem = (it: Item) => (
    <button
      key={it.key}
      className={`menu-item ${it.danger ? 'is-danger' : ''}`}
      disabled={it.disabled}
      onClick={() => runItem(it)}
    >
      <span className="menu-label">{it.label}</span>
      {it.tag && <span className="menu-tag">{it.tag}</span>}
      <span className="menu-icon">{it.submenu ? <ChevronRightIcon width={18} height={18} /> : it.icon}</span>
    </button>
  );

  return (
    <motion.div
      className="menu-layer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={close}
    >
      <motion.div
        className={`menu-preview ${checked ? 'is-done' : ''}`}
        style={
          { top: previewTop, left: previewLeft, width: previewW, '--c': `var(--c-${todo.list})` } as React.CSSProperties
        }
        initial={{ scale: 1, y: rect.top - previewTop }}
        animate={{ scale: 1.03, y: 0 }}
        exit={{ scale: 1, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      >
        <span className={`preview-check ${checked ? 'is-checked' : ''}`}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="m6.5 12.5 3.7 3.7 7.4-8" />
          </svg>
        </span>
        <span className="preview-title">{todo.title}</span>
      </motion.div>

      <motion.div
        ref={menuRef}
        className="menu glass-menu"
        role="menu"
        style={{ top: menuTop, left: menuLeft, width: menuW, transformOrigin: below ? 'top left' : 'bottom left' }}
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: menuH ? 1 : 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.85 }}
        transition={{ type: 'spring', stiffness: 520, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
      >
        {page === 'main' ? (
          groups.map((g, i) => (
            <div key={i} className="menu-group">
              {g.map(renderItem)}
            </div>
          ))
        ) : (
          <>
            {!moveFirst && (
              <div className="menu-group">
                <button className="menu-item menu-back" onClick={() => setPage('main')}>
                  <span className="menu-icon menu-icon-left">
                    <ChevronRightIcon width={18} height={18} style={{ transform: 'rotate(180deg)' }} />
                  </span>
                  <span className="menu-label">移到…</span>
                </button>
              </div>
            )}
            <div className="menu-group">{moveItems.map(renderItem)}</div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

// ---------- ⋯ 下拉菜单 ----------

export function MoreMenu() {
  const anchor = useUi((s) => s.more);
  const prefs = useData((s) => s.prefs);
  const trashCount = useData((s) => activeOf(s)?.trash.length ?? 0);
  const close = () => useUi.getState().set({ more: null });
  const vw = typeof window !== 'undefined' ? window.innerWidth : 400;
  const w = Math.min(250, vw - 24);
  return (
    <AnimatePresence>
      {anchor && (
        <motion.div
          className="menu-layer is-clear"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={close}
        >
          <motion.div
            className="menu glass-menu"
            role="menu"
            style={{
              top: anchor.top + anchor.height + 8,
              left: Math.min(Math.max(anchor.left + anchor.width - w, 12), vw - w - 12),
              width: w,
              transformOrigin: 'top right',
            }}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 540, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="menu-group">
              <button className="menu-item" onClick={() => useUi.getState().set({ more: null, sheet: 'trash' })}>
                <span className="menu-label">回收站</span>
                {trashCount > 0 && <span className="menu-tag">{trashCount}</span>}
                <span className="menu-icon">
                  <TrashIcon />
                </span>
              </button>
              <button className="menu-item" onClick={() => useUi.getState().set({ more: null, sheet: 'profiles' })}>
                <span className="menu-label">切换空间</span>
                <span className="menu-icon">
                  <SwapIcon />
                </span>
              </button>
              <button className="menu-item" onClick={() => useUi.getState().set({ more: null, sheet: 'sync' })}>
                <span className="menu-label">同步</span>
                <span className="menu-icon">
                  <CloudIcon />
                </span>
              </button>
            </div>
            <div className="menu-group">
              <Toggle
                label="完成提示音"
                icon={<SoundIcon />}
                on={prefs.sound}
                onChange={(v) => useData.getState().setPrefs({ sound: v })}
              />
              <Toggle
                label="触感反馈"
                icon={<HapticIcon />}
                on={prefs.haptics}
                onChange={(v) => useData.getState().setPrefs({ haptics: v })}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Toggle({
  label,
  icon,
  on,
  onChange,
}: {
  label: string;
  icon: ReactNode;
  on: boolean;
  onChange(v: boolean): void;
}) {
  return (
    <button className="menu-item" role="menuitemcheckbox" aria-checked={on} onClick={() => onChange(!on)}>
      <span className="menu-check">{on && <CheckIcon width={18} height={18} />}</span>
      <span className="menu-label">{label}</span>
      <span className="menu-icon">{icon}</span>
    </button>
  );
}

// ---------- 提示条 ----------

export function Toast() {
  const toast = useUi((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(
      () => {
        if (useUi.getState().toast?.key === toast.key) useUi.getState().set({ toast: null });
      },
      toast.undoEntry ? 5000 : 2400,
    );
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <div className="toast-host" aria-live="polite">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.key}
            className="toast"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
          >
            <span className="toast-text">{toast.text}</span>
            {toast.undoEntry && (
              <button className="toast-undo" onClick={undoDelete}>
                <RestoreIcon width={16} height={16} />
                撤销
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
