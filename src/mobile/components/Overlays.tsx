// 浮层：长按菜单（玻璃，设计 P4）、⋯ 菜单（网页自己画导航时）、提示条（玻璃胶囊 + 荧光绿「撤销」）
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { buildIndex, nowOf, rootsOf } from '../../model';
import { LISTS, type ListId, type Todo } from '../../types';
import {
  deleteWithUndo,
  goSection,
  listLabel,
  moveTodoTo,
  openComposer,
  sendToFocus,
  setNow,
  startEdit,
  toggleTest,
  toggleTodo,
  undoDelete,
} from '../actions';
import {
  BackIcon,
  CheckIcon,
  ChevronRightIcon,
  CloudIcon,
  EditIcon,
  EyeCheckIcon,
  HapticIcon,
  MoveIcon,
  SectionIcons,
  SoundIcon,
  SpacesIcon,
  SubtaskIcon,
  TrashIcon,
  UncheckIcon,
  UpIcon,
} from '../icons';
import { activeOf, useData, useTodos } from '../store';
import { useUi, type Rect } from '../ui';
import { statusOf } from './SyncSheets';

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

function MenuBody({ todo, rect, from, moveFirst }: { todo: Todo; rect: Rect; from: 'list' | 'history'; moveFirst: boolean }) {
  const [page, setPage] = useState<'main' | 'move'>(moveFirst ? 'move' : 'main');
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuH, setMenuH] = useState(0);
  const close = () => useUi.getState().set({ menu: null });
  const completing = useUi((s) => !!s.completing[todo.id]);
  const todos = useTodos();
  const checked = todo.done || completing;
  const isNow = nowOf(todos)?.id === todo.id;
  // 接下来里的行带序号
  const no = (() => {
    if (todo.list !== 'focus' || todo.parentId !== null || todo.done) return null;
    const idx = buildIndex(todos);
    const open = rootsOf(idx, 'focus').filter((t) => !t.done);
    const i = open.findIndex((t) => t.id === todo.id);
    return i > 0 ? String(i + 1).padStart(2, '0') : null;
  })();

  useLayoutEffect(() => {
    if (menuRef.current) setMenuH(menuRef.current.offsetHeight);
  }, [page]);

  const groups: Item[][] =
    from === 'history'
      ? [
          [
            { key: 'undone', label: '恢复为未完成', icon: <UncheckIcon />, run: () => useData.getState().uncomplete(todo.id) },
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
            ...(isNow ? [] : [{ key: 'now', label: '设为现在', icon: <UpIcon />, run: () => setNow(todo) }]),
            todo.parentId === null && todo.list === 'verify' && !checked
              ? { key: 'back', label: '退回 FOCUS', icon: <SectionIcons.focus />, run: () => sendToFocus(todo) }
              : {
                  key: 'test',
                  label: todo.testing && !checked ? '取消待验证' : '送去验证',
                  icon: <EyeCheckIcon />,
                  disabled: checked,
                  run: () => toggleTest(todo, document.querySelector(`[data-node-id="${CSS.escape(todo.id)}"] .now-vb`)),
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
      icon: <Icon style={{ color: l.id === 'focus' ? undefined : `var(--c-${l.id})` }} />,
      disabled: same && !todo.parentId,
      tag: same && !todo.parentId ? '当前' : l.hint,
      run: () => moveTodoTo(todo, l.id as ListId),
    };
  });

  // 位置：抬起的那一行尽量留在原处，菜单放在下方，放不下就放上方，再不行把行往上推；双页时只在长按的那一页里
  const vh = window.innerHeight;
  const safe = safeInsets();
  const pad = 12;
  const [lo, hi] = pageBounds(rect, pad);
  const liftW = Math.min(rect.width, hi - lo);
  const liftH = Math.min(rect.height, 150);
  const liftLeft = Math.min(Math.max(rect.left, lo), hi - liftW);
  const menuW = Math.min(250, hi - lo);
  const menuLeft = Math.min(Math.max(liftLeft, lo), hi - menuW);
  const h = menuH || 330;
  const top0 = safe.top + pad;
  const bottom0 = vh - safe.bottom - pad;
  let liftTop = rect.top;
  let menuTop: number;
  let below = true;
  if (liftTop + liftH + 10 + h <= bottom0) menuTop = liftTop + liftH + 10;
  else if (liftTop - 10 - h >= top0) {
    menuTop = liftTop - 10 - h;
    below = false;
  } else {
    liftTop = Math.max(top0, bottom0 - h - 10 - liftH);
    menuTop = liftTop + liftH + 10;
  }

  const runItem = (it: Item) => {
    if (it.disabled) return;
    if (!it.submenu) close();
    it.run();
  };

  const renderItem = (it: Item) => (
    <button
      key={it.key}
      className={`mi ${it.danger ? 'bad' : ''}`}
      disabled={it.disabled}
      onClick={() => runItem(it)}
    >
      {it.icon}
      <span className="mi-label">{it.label}</span>
      {it.tag && <em>{it.tag}</em>}
      {it.submenu && <ChevronRightIcon width={16} height={16} />}
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
        className={`lift ${checked ? 'is-done' : ''}`}
        style={{ top: liftTop, left: liftLeft, width: liftW, minHeight: Math.min(rect.height, 64) }}
        initial={{ scale: 1, y: rect.top - liftTop }}
        animate={{ scale: 1.03, y: 0 }}
        exit={{ scale: 1, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      >
        {no && <span className="lift-no">{no}</span>}
        <span className="lift-title">{todo.title}</span>
      </motion.div>

      <motion.div
        ref={menuRef}
        className="pop"
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
            <div key={i}>
              {i > 0 && <div className="mi-sep" />}
              {g.map(renderItem)}
            </div>
          ))
        ) : (
          <>
            {!moveFirst && (
              <>
                <button className="mi" onClick={() => setPage('main')}>
                  <BackIcon />
                  <span className="mi-label">移到…</span>
                </button>
                <div className="mi-sep" />
              </>
            )}
            {moveItems.map(renderItem)}
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

// ---------- ⋯ 菜单（网页自己画导航时；原生外壳在时用系统的溢出菜单） ----------

export function MoreMenu() {
  const anchor = useUi((s) => s.more);
  const prefs = useData((s) => s.prefs);
  const trashCount = useData((s) => activeOf(s)?.trash.length ?? 0);
  const space = useData((s) => activeOf(s)?.name ?? '');
  const status = useData((s) => s.syncStatus);
  const enabled = useData((s) => s.local.sync.enabled);
  const close = () => useUi.getState().set({ more: null });
  const vw = typeof window !== 'undefined' ? window.innerWidth : 400;
  const w = Math.min(250, vw - 24);
  const st = statusOf(status, enabled);
  const short: Record<string, string> = { ok: '已同步', busy: '同步中', warn: '离线', bad: '出错', off: '未开启' };
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
            className="pop"
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
            <button className="mi" onClick={() => useUi.getState().set({ more: null, sheet: 'trash' })}>
              <TrashIcon />
              <span className="mi-label">回收站</span>
              {trashCount > 0 && <em>{trashCount}</em>}
            </button>
            <button className="mi" onClick={() => useUi.getState().set({ more: null, sheet: 'sync' })}>
              <CloudIcon />
              <span className="mi-label">同步</span>
              <em>{short[st.tone]}</em>
            </button>
            <button className="mi" onClick={() => useUi.getState().set({ more: null, sheet: 'profiles' })}>
              <SpacesIcon />
              <span className="mi-label">空间</span>
              <em>{space} ›</em>
            </button>
            <div className="mi-sep" />
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Toggle({ label, icon, on, onChange }: { label: string; icon: ReactNode; on: boolean; onChange(v: boolean): void }) {
  return (
    <button className="mi" role="menuitemcheckbox" aria-checked={on} onClick={() => onChange(!on)}>
      {icon}
      <span className="mi-label">{label}</span>
      <span className={`tg ${on ? 'on' : ''}`} aria-hidden />
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
            className="toast glass"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
          >
            <span className="toast-text">{toast.text}</span>
            {toast.undoEntry && (
              <button className="toast-undo" onClick={undoDelete}>
                撤销
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
