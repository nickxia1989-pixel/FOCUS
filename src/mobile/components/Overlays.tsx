// 浮层：长按菜单（玻璃，设计 P4）、⋯ 菜单（网页自己画导航时）、提示条（玻璃胶囊 + 荧光绿「撤销」）
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { buildIndex, inZone, nowOf, rootsOf } from '../../model';
import { LISTS, type ListId, type Todo } from '../../types';
import {
  deleteWithUndo,
  goSection,
  listLabel,
  moveTodoTo,
  openComposer,
  outdent,
  sendToFocus,
  setNow,
  unfocusTodo,
  startEdit,
  switchSpace,
  toggleTest,
  toggleTodo,
  undoDelete,
} from '../actions';
import {
  DownIcon,
  AppearanceIcon,
  BackIcon,
  CheckIcon,
  ChevronRightIcon,
  CloudIcon,
  EditIcon,
  EyeCheckIcon,
  HapticIcon,
  MoveIcon,
  PlusIcon,
  OutdentIcon,
  SectionIcons,
  SoundIcon,
  SubtaskIcon,
  TrashIcon,
  UncheckIcon,
  UpIcon,
} from '../icons';
import { activeOf, useData, useTodos } from '../store';
import { useUi, type Rect } from '../ui';
import type { Appearance } from '../data';
import { Avatar, openRoots } from './Chrome';
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

function MenuBody({ todo, rect, from, moveFirst }: { todo: Todo; rect: Rect; from: 'list' | 'history' | 'sub'; moveFirst: boolean }) {
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
    // NOW 卡（聚焦区第一件）不带序号；其余和「接下来」的行一样，从上往下数
    return i < 0 || (i === 0 && inZone(todo)) ? null : String(i + 1).padStart(2, '0');
  })();

  useLayoutEffect(() => {
    if (menuRef.current) setMenuH(menuRef.current.offsetHeight);
  }, [page]);

  const testItem: Item = {
    key: 'test',
    label: todo.testing && !checked ? '取消待验证' : '送去验证',
    icon: <EyeCheckIcon />,
    disabled: checked,
    run: () => toggleTest(todo, document.querySelector(`[data-node-id="${CSS.escape(todo.id)}"] .now-vb`)),
  };
  const outdentItem: Item = { key: 'outdent', label: '升一级', icon: <OutdentIcon />, run: () => outdent(todo) };
  const doneItem: Item = checked
    ? { key: 'undone', label: '标记为未完成', icon: <UncheckIcon />, run: () => toggleTodo(todo) }
    : { key: 'done', label: '完成', icon: <CheckIcon />, run: () => toggleTodo(todo) };
  const editItem: Item = { key: 'edit', label: '编辑', icon: <EditIcon />, run: () => startEdit(todo.id) };
  const deleteItem: Item = { key: 'delete', label: '删除', icon: <TrashIcon />, danger: true, run: () => deleteWithUndo(todo) };

  const groups: Item[][] =
    from === 'sub'
      ? // NOW 卡上的子任务：完成、编辑、待验证、升一级、删除
        [[doneItem, editItem], [{ ...testItem, label: todo.testing && !checked ? '取消待验证' : '待验证' }, outdentItem], [deleteItem]]
      : from === 'history'
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
            doneItem,
            editItem,
            { key: 'sub', label: '添加子任务', icon: <SubtaskIcon />, run: () => openComposer(todo.list, todo.id) },
          ],
          [
            ...(isNow ? [] : [{ key: 'now', label: '设为现在', icon: <UpIcon />, run: () => setNow(todo) }]),
            ...(inZone(todo) ? [{ key: 'unfocus', label: '移出聚焦区', icon: <DownIcon />, run: () => unfocusTodo(todo) }] : []),
            todo.parentId === null && todo.list === 'verify' && !checked
              ? { key: 'back', label: '退回 FOCUS', icon: <SectionIcons.focus />, run: () => sendToFocus(todo) }
              : testItem,
            ...(todo.parentId !== null ? [outdentItem] : []),
            { key: 'move', label: '移到…', icon: <MoveIcon />, submenu: true, run: () => setPage('move') },
          ],
          [deleteItem],
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
  // 抬起的卡片自带上下内边距，矮行（NOW 卡上的子任务）也至少这么高，并以那一行为中心
  const liftH = Math.max(Math.min(rect.height, 150), 50);
  const liftLeft = Math.min(Math.max(rect.left, lo), hi - liftW);
  const menuW = Math.min(250, hi - lo);
  const menuLeft = Math.min(Math.max(liftLeft, lo), hi - menuW);
  const h = menuH || 330;
  const top0 = safe.top + pad;
  const bottom0 = vh - safe.bottom - pad;
  let liftTop = rect.top - Math.max(0, (liftH - rect.height) / 2);
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
  const profiles = useData((s) => s.profiles);
  const activeId = useData((s) => s.activeId);
  const status = useData((s) => s.syncStatus);
  const enabled = useData((s) => s.local.sync.enabled);
  const close = () => useUi.getState().set({ more: null });
  const vw = typeof window !== 'undefined' ? window.innerWidth : 400;
  const w = Math.min(286, vw - 24);
  // 从左上的头像弹出时左对齐，从右上的 ⋯ 弹出时右对齐
  const fromLeft = !!anchor && anchor.left + anchor.width / 2 < vw / 2;
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
              left: Math.min(Math.max(fromLeft ? anchor.left : anchor.left + anchor.width - w, 12), vw - w - 12),
              width: w,
              transformOrigin: fromLeft ? 'top left' : 'top right',
              maxHeight: `calc(100% - ${anchor.top + anchor.height + 24}px)`,
              overflowY: 'auto',
            }}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 540, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 上半：空间（当前打勾、FOCUS 件数、最后「新建空间…」）——设计方案 A 的头像菜单 */}
            <div className="mi-head">空间</div>
            {profiles.map((p) => {
              const n = openRoots(p.todos, 'focus');
              return (
                <button key={p.id} className="mi" role="menuitemradio" aria-checked={p.id === activeId} onClick={() => switchSpace(p.id)}>
                  <Avatar profile={p} size={24} />
                  <span className="mi-label">{p.name}</span>
                  <em>{n > 0 ? n : ''}</em>
                  {p.id === activeId && <CheckIcon width={16} height={16} />}
                </button>
              );
            })}
            <button className="mi" onClick={() => useUi.getState().set({ more: null, sheet: 'profiles', spaceAdd: true })}>
              <PlusIcon />
              <span className="mi-label">新建空间…</span>
            </button>
            <div className="mi-sep" />
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
            <div className="mi mi-static">
              <AppearanceIcon />
              <span className="mi-label">外观</span>
            </div>
            <div className="seg" role="radiogroup" aria-label="外观">
              {APPEARANCES.map(([k, label]) => (
                <button
                  key={k}
                  role="radio"
                  aria-checked={prefs.appearance === k}
                  className={prefs.appearance === k ? 'on' : ''}
                  onClick={() => useData.getState().setPrefs({ appearance: k })}
                >
                  {label}
                </button>
              ))}
            </div>
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

const APPEARANCES: [Appearance, string][] = [
  ['system', '跟随系统'],
  ['light', '浅色'],
  ['dark', '深色'],
];

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
      toast.undoEntry || toast.undo ? 5000 : 2400,
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
            {(toast.undoEntry || toast.undo) && (
              <button
                className="toast-undo"
                onClick={() => {
                  if (!toast.undo) return undoDelete();
                  useUi.getState().set({ toast: null });
                  toast.undo();
                }}
              >
                撤销
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
