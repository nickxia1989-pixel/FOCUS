// 底部弹出的面板（宽屏上居中成表单卡片）：空间切换、回收站
import { AnimatePresence, motion, useDragControls, type DragControls, type PanInfo } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { completedSince, openCount, startOfToday } from '../../model';
import { TRASH_KEEP_DAYS } from '../../trash';
import { LIST_IDS, LISTS, type TrashEntry } from '../../types';
import { listLabel, restoreFromTrash } from '../actions';
import { CheckIcon, CloseIcon, PlusIcon, RestoreIcon, SectionIcons, TrashIcon } from '../icons';
import { haptic } from '../native';
import { activeOf, useData } from '../store';
import { showToast, useUi } from '../ui';
import { Avatar } from './Chrome';

interface SheetProps {
  open: boolean;
  wide: boolean;
  title: string;
  subtitle?: string;
  onClose(): void;
  left?: ReactNode;
  children: ReactNode;
  tall?: boolean;
}

export function Sheet({ open, wide, title, subtitle, onClose, left, children, tall }: SheetProps) {
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
            <SheetHeader
              title={title}
              subtitle={subtitle}
              left={left}
              onClose={onClose}
              controls={wide ? null : controls}
            />
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
  left,
  onClose,
  controls,
}: {
  title: string;
  subtitle?: string;
  left?: ReactNode;
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
      <div className="sheet-head-row">
        <div className="sheet-head-side">{left}</div>
        <div className="sheet-title">
          <span>{title}</span>
          {subtitle && <small>{subtitle}</small>}
        </div>
        <div className="sheet-head-side is-right">
          <button className="glass-btn small" aria-label="关闭" onClick={onClose}>
            <CloseIcon width={18} height={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- 空间（profile） ----------

export function ProfileSheet({ wide }: { wide: boolean }) {
  const open = useUi((s) => s.sheet === 'profiles');
  const profiles = useData((s) => s.profiles);
  const activeId = useData((s) => s.activeId);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const close = () => useUi.getState().set({ sheet: null });
  const today = startOfToday(Date.now());

  useEffect(() => {
    if (!open) {
      setEditing(false);
      setAdding(false);
      setArmed(null);
    }
  }, [open]);

  const pick = (id: string) => {
    if (editing) return;
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
    document.querySelector<HTMLInputElement>('.profile-add-input')?.focus();
  };

  return (
    <Sheet
      open={open}
      wide={wide}
      title="空间"
      subtitle="每个空间有独立的列表和回收站"
      onClose={close}
      left={
        <button className="text-btn" onClick={() => setEditing((v) => !v)}>
          {editing ? '完成' : '编辑'}
        </button>
      }
    >
      <div className="card">
        {profiles.map((p) => {
          const open = LIST_IDS.reduce((n, l) => n + (l === 'goal' ? 0 : openCount(p.todos, l)), 0);
          const done = completedSince(p.todos, today);
          return (
            <div
              key={p.id}
              className={`profile-row ${p.id === activeId ? 'is-active' : ''}`}
              onClick={() => pick(p.id)}
            >
              <Avatar profile={p} size={40} />
              <div className="profile-row-text">
                {editing ? (
                  <input
                    className="profile-name-input"
                    defaultValue={p.name}
                    enterKeyHint="done"
                    onBlur={(e) => useData.getState().renameProfile(p.id, e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && e.keyCode !== 229 && e.currentTarget.blur()}
                  />
                ) : (
                  <span className="profile-row-name">{p.name}</span>
                )}
                <span className="profile-row-sub">
                  {open} 项待办{done > 0 ? ` · 今天完成 ${done}` : ''}
                </span>
              </div>
              {editing
                ? profiles.length > 1 && (
                    <button
                      className={`danger-pill ${armed === p.id ? 'is-armed' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (armed === p.id) {
                          haptic.warning();
                          useData.getState().deleteProfile(p.id);
                          setArmed(null);
                        } else setArmed(p.id);
                      }}
                    >
                      {armed === p.id ? '确认删除' : <TrashIcon width={18} height={18} />}
                    </button>
                  )
                : p.id === activeId && (
                    <span className="profile-check">
                      <CheckIcon width={20} height={20} />
                    </span>
                  )}
            </div>
          );
        })}
        {adding ? (
          <div className="profile-row is-adding">
            <span className="avatar avatar-new">
              <PlusIcon width={20} height={20} />
            </span>
            <input
              className="profile-add-input"
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
          <button className="profile-row profile-add" onClick={startAdd}>
            <span className="avatar avatar-new">
              <PlusIcon width={20} height={20} />
            </span>
            <span className="profile-row-name">新建空间</span>
          </button>
        )}
      </div>
      {editing && <p className="sheet-note">删除空间会连同它的列表和回收站一起删除，无法恢复。</p>}
    </Sheet>
  );
}

// ---------- 回收站 ----------

const DAY = 24 * 60 * 60 * 1000;

function relTime(t: number, now: number) {
  const d = now - t;
  if (d < 60_000) return '刚刚';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < DAY) return `${Math.floor(d / 3_600_000)} 小时前`;
  return `${Math.floor(d / DAY)} 天前`;
}

export function TrashSheet({ wide }: { wide: boolean }) {
  const open = useUi((s) => s.sheet === 'trash');
  const trash = useData((s) => activeOf(s)?.trash ?? []);
  const profileName = useData((s) => activeOf(s)?.name ?? '');
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
      subtitle={`「${profileName}」· 保留 ${TRASH_KEEP_DAYS} 天`}
      onClose={close}
      left={
        trash.length > 0 && (
          <button
            className={`text-btn is-danger ${armedAll ? 'is-armed' : ''}`}
            onClick={() => {
              if (armedAll) {
                haptic.warning();
                useData.getState().emptyTrash();
                setArmedAll(false);
              } else setArmedAll(true);
            }}
          >
            {armedAll ? '确认清空' : '清空'}
          </button>
        )
      }
    >
      {trash.length === 0 ? (
        <div className="empty small">
          <div className="empty-icon">
            <TrashIcon width={28} height={28} />
          </div>
          <p>回收站是空的。</p>
        </div>
      ) : (
        <div className="card">
          <AnimatePresence initial={false}>
            {trash.map((e) => (
              <TrashRow key={e.id} entry={e} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </Sheet>
  );
}

function TrashRow({ entry }: { entry: TrashEntry }) {
  const root = entry.items.find((t) => t.id === entry.rootId)!;
  const kids = entry.items.filter((t) => t.id !== entry.rootId);
  const meta = LISTS.find((l) => l.id === entry.list)!;
  const Icon = SectionIcons[entry.list];
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <motion.div
      className="trash-row"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.26 }}
    >
      <div className="trash-main">
        <span className={`trash-title ${root.done ? 'is-done' : ''}`}>{root.title}</span>
        <span className="trash-meta">
          <span style={{ color: `var(--c-${entry.list})` }} className="h-list">
            <Icon width={12} height={12} />
            {meta.label}
          </span>
          <span>{relTime(entry.deletedAt, Date.now())}删除</span>
          {kids.length > 0 && <span>含 {kids.length} 个子项</span>}
        </span>
        {kids.length > 0 && (
          <span className="trash-kids">
            {kids
              .slice(0, 3)
              .map((k) => k.title)
              .join(' · ')}
            {kids.length > 3 ? ' …' : ''}
          </span>
        )}
      </div>
      <div className="trash-actions">
        <button
          className="pill-btn"
          onClick={() => restoreFromTrash(entry.id)}
          aria-label={`恢复到 ${listLabel(entry.list)}`}
        >
          <RestoreIcon width={16} height={16} />
          恢复
        </button>
        <button
          className={`danger-pill ${armed ? 'is-armed' : ''}`}
          aria-label="彻底删除"
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
          {armed ? '彻底删除' : <TrashIcon width={18} height={18} />}
        </button>
      </div>
    </motion.div>
  );
}
