// 底部面板（大屏 / 双页时居中成表单卡片，双页时只居中在右页）：空间、回收站
import { AnimatePresence, motion, useDragControls, type DragControls, type PanInfo } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { TRASH_KEEP_DAYS } from '../../trash';
import { type TrashEntry } from '../../types';
import { listLabel, restoreFromTrash } from '../actions';
import { CheckIcon, CloseIcon, EditIcon, PlusIcon, TrashIcon } from '../icons';
import { haptic } from '../native';
import { activeOf, useData } from '../store';
import { showToast, useUi } from '../ui';
import { Avatar, openRoots } from './Chrome';
import { SwipeRow } from './SwipeRow';

interface SheetProps {
  open: boolean;
  wide: boolean;
  title: string;
  /** 标题右边的小字（例如「坚果云 WebDAV」） */
  subtitle?: string;
  onClose(): void;
  /** 标题右边的按钮（例如「清空」「稍后处理」）；不给就是关闭圆钮 */
  right?: ReactNode;
  children: ReactNode;
  tall?: boolean;
}

export function Sheet({ open, wide, title, subtitle, onClose, right, children, tall }: SheetProps) {
  const controls = useDragControls();
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 700) onClose();
  };
  return (
    <AnimatePresence>
      {open && (
        <div className={`sheet-layer ${wide ? 'is-wide' : ''}`}>
          <motion.div
            className="sheet-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
          />
          <motion.div
            className={`sheet ${tall ? 'is-tall' : ''}`}
            role="dialog"
            aria-label={title}
            initial={wide ? { opacity: 0, scale: 0.94 } : { y: '100%' }}
            animate={wide ? { opacity: 1, scale: 1 } : { y: 0 }}
            exit={wide ? { opacity: 0, scale: 0.96 } : { y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            drag={wide ? false : 'y'}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.04, bottom: 0.7 }}
            dragListener={false}
            dragControls={controls}
            onDragEnd={onDragEnd}
          >
            <SheetHeader title={title} subtitle={subtitle} right={right} onClose={onClose} controls={wide ? null : controls} />
            <div className="sheet-body">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function SheetHeader({
  title,
  subtitle,
  right,
  onClose,
  controls,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onClose(): void;
  controls: DragControls | null;
}) {
  return (
    <div
      className="sheet-head"
      onPointerDown={(e) => {
        // 按在标题区可以下拉关闭；按钮上不拦
        if (controls && !(e.target as HTMLElement).closest('button, input')) controls.start(e);
      }}
    >
      <div className="sheet-grabber" />
      <div className="shh">
        <b className="shh-title">{title}</b>
        {subtitle && <span className="shh-sub">{subtitle}</span>}
        {right ?? (
          <button className="shh-x" aria-label="关闭" onClick={onClose}>
            <CloseIcon />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- 空间（profile）：切换、新建；左滑改名 / 删除 ----------

export function ProfileSheet({ wide }: { wide: boolean }) {
  const open = useUi((s) => s.sheet === 'profiles');
  const profiles = useData((s) => s.profiles);
  const activeId = useData((s) => s.activeId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const close = () => useUi.getState().set({ sheet: null });

  useEffect(() => {
    if (!open) {
      setRenaming(null);
      setAdding(false);
      setArmed(null);
    }
  }, [open]);

  // 从头像菜单的「新建空间…」打开：直接进入新建
  const spaceAdd = useUi((s) => s.spaceAdd);
  useEffect(() => {
    if (!open || !spaceAdd) return;
    useUi.getState().set({ spaceAdd: false });
    setAdding(true);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.space-add-input')?.focus());
  }, [open, spaceAdd]);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  const pick = (id: string) => {
    if (renaming) return;
    if (id !== activeId) {
      haptic.light();
      useData.getState().switchProfile(id);
      const p = useData.getState().profiles.find((x) => x.id === id);
      if (p) showToast(`已切换到「${p.name}」`);
    }
    setTimeout(close, 160);
  };

  const startAdd = () => {
    flushSync(() => setAdding(true));
    document.querySelector<HTMLInputElement>('.space-add-input')?.focus();
  };

  const startRename = (id: string) => {
    flushSync(() => setRenaming(id));
    document.querySelector<HTMLInputElement>(`[data-rename="${CSS.escape(id)}"]`)?.focus();
  };

  return (
    <Sheet open={open} wide={wide} title="空间" onClose={close}>
      <div className="scard spaces">
        {profiles.map((p) => {
          const n = openRoots(p.todos, 'focus');
          const isActive = p.id === activeId;
          return (
            <div key={p.id} className="space-node">
              <SwipeRow
                id={`space-${p.id}`}
                disabled={renaming === p.id}
                trailing={[
                  { key: 'rename', label: '改名', icon: <EditIcon />, color: 'var(--sw-move)', run: () => startRename(p.id) },
                  ...(profiles.length > 1
                    ? [
                        {
                          key: 'delete',
                          label: armed === p.id ? '再点一次' : '删除',
                          icon: <TrashIcon />,
                          color: 'var(--sw-delete)',
                          fg: '#fff',
                          run: () => {
                            if (armed === p.id) {
                              haptic.warning();
                              useData.getState().deleteProfile(p.id);
                              setArmed(null);
                            } else {
                              setArmed(p.id);
                              showToast(`再左滑点一次「删除」，删除「${p.name}」`);
                            }
                          },
                        },
                      ]
                    : []),
                ]}
              >
                <div className="li" onClick={() => pick(p.id)}>
                  <Avatar profile={p} size={34} />
                  <div className="li-main">
                    {renaming === p.id ? (
                      <input
                        className="li-input"
                        data-rename={p.id}
                        defaultValue={p.name}
                        enterKeyHint="done"
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          useData.getState().renameProfile(p.id, e.target.value);
                          setRenaming(null);
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && e.keyCode !== 229 && e.currentTarget.blur()}
                      />
                    ) : (
                      <b>{p.name}</b>
                    )}
                    <small>
                      {n > 0 ? `${n} 件在 FOCUS` : 'FOCUS 空着'}
                      {isActive ? ' · 当前' : ''}
                    </small>
                  </div>
                  {isActive && <CheckIcon className="ck" />}
                </div>
              </SwipeRow>
            </div>
          );
        })}
      </div>
      {adding ? (
        <div className="li li-add">
          <PlusIcon />
          <input
            className="li-input space-add-input"
            placeholder="新空间的名字，例如「副业」"
            enterKeyHint="done"
            onBlur={(e) => {
              const name = e.target.value.trim();
              setAdding(false);
              if (name) {
                haptic.light();
                useData.getState().addProfile(name);
                showToast(`已新建并切换到「${name}」`);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.keyCode !== 229) e.currentTarget.blur();
              if (e.key === 'Escape') {
                e.currentTarget.value = '';
                e.currentTarget.blur();
              }
            }}
          />
        </div>
      ) : (
        <button className="li li-add" onClick={startAdd}>
          <PlusIcon />
          新建空间
        </button>
      )}
      <p className="note">左滑一个空间可改名或删除；删除需要再点一次确认，至少保留一个。</p>
    </Sheet>
  );
}

// ---------- 回收站 ----------

const DAY = 24 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

function deletedAt(t: number, now: number) {
  const d = new Date(t);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const startToday = new Date(now).setHours(0, 0, 0, 0);
  if (t >= startToday) return `今天 ${hm}`;
  if (t >= startToday - DAY) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function TrashSheet({ wide }: { wide: boolean }) {
  const open = useUi((s) => s.sheet === 'trash');
  const trash = useData((s) => activeOf(s)?.trash ?? []);
  const [armedAll, setArmedAll] = useState(false);
  const close = () => useUi.getState().set({ sheet: null });

  useEffect(() => {
    if (!armedAll) return;
    const t = setTimeout(() => setArmedAll(false), 3000);
    return () => clearTimeout(t);
  }, [armedAll]);

  return (
    <Sheet
      open={open}
      wide={wide}
      tall
      title="回收站"
      onClose={close}
      right={
        trash.length > 0 ? (
          <button
            className={`text-btn is-danger ${armedAll ? 'is-armed' : ''}`}
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              if (armedAll) {
                haptic.warning();
                useData.getState().emptyTrash();
                setArmedAll(false);
              } else setArmedAll(true);
            }}
          >
            {armedAll ? '再点一次清空' : '清空'}
          </button>
        ) : undefined
      }
    >
      <p className="note">删除的条目连同子项保留 {TRASH_KEEP_DAYS} 天，可以恢复到原来的位置。</p>
      {trash.length === 0 ? (
        <p className="note" style={{ padding: '24px 4px' }}>
          回收站是空的。
        </p>
      ) : (
        <AnimatePresence initial={false}>
          {trash.map((e) => (
            <TrashRow key={e.id} entry={e} />
          ))}
        </AnimatePresence>
      )}
    </Sheet>
  );
}

function TrashRow({ entry }: { entry: TrashEntry }) {
  const root = entry.items.find((t) => t.id === entry.rootId)!;
  const kids = entry.items.filter((t) => t.id !== entry.rootId);
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <motion.div
      className="tr"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.26 }}
      style={{ '--c': `var(--c-${entry.list})` } as React.CSSProperties}
    >
      <b>{root.title}</b>
      <span className="tr-meta">
        <i />
        原在 {listLabel(entry.list)} · {deletedAt(entry.deletedAt, Date.now())}
        {kids.length > 0 ? ` · 含 ${kids.length} 个子项` : ''}
      </span>
      {kids.length > 0 && (
        <span className="tr-kids">
          {kids
            .slice(0, 3)
            .map((k) => k.title)
            .join(' · ')}
          {kids.length > 3 ? ' …' : ''}
        </span>
      )}
      <div className="tr-actions">
        <button className="btn pri sm" onClick={() => restoreFromTrash(entry.id)} aria-label={`恢复到 ${listLabel(entry.list)}`}>
          恢复
        </button>
        <button
          className={`btn sm ${armed ? 'conf' : 'bad'}`}
          onClick={() => {
            if (armed) {
              haptic.warning();
              useData.getState().purgeTrashEntry(entry.id);
            } else {
              setArmed(true);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setArmed(false), 3000);
            }
          }}
        >
          {armed ? '再点一次彻底删除' : '彻底删除'}
        </button>
      </div>
    </motion.div>
  );
}
