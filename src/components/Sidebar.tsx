import { motion } from 'motion/react';
import { useEffect, useMemo, useRef, type ComponentType, type SVGProps } from 'react';
import { openCount, completedSince, startOfToday } from '../model';
import { isMac } from '../platform';
import { useData, useUi } from '../store';
import { HISTORY_META, LISTS, type ListId, type ViewId } from '../types';
import { ChevronIcon, HistoryIcon, ListIcons } from './icons';
import { PROFILE_SHORTCUT, ProfileAvatar, ProfileMenu } from './ProfileMenu';

const mod = isMac ? '⌘' : 'Ctrl+';

interface NavItemProps {
  id: ViewId;
  label: string;
  hint: string;
  shortcut: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  active: boolean;
  count: number;
  /** 完成记录的数字是"今天完成了几件"，样式不同 */
  countKind?: 'open' | 'done';
}

function NavItem({ id, label, hint, shortcut, Icon, active, count, countKind = 'open' }: NavItemProps) {
  const isList = id !== 'history';
  const pulse = useUi((s) => (isList ? s.tabPulse[id as ListId] : 0));
  const dropTarget = useUi((s) => s.dragOverTab === id);
  const ref = useRef<HTMLButtonElement>(null);
  const firstPulse = useRef(pulse);

  // 有东西"飞进来"时弹一下
  useEffect(() => {
    if (pulse === firstPulse.current || !ref.current) return;
    ref.current.querySelector('.nav-icon')?.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.28)' }, { transform: 'scale(0.94)' }, { transform: 'scale(1)' }],
      { duration: 520, easing: 'cubic-bezier(.3,1.5,.5,1)' },
    );
    ref.current.querySelector('.nav-count')?.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.4)' }, { transform: 'scale(1)' }],
      { duration: 460, easing: 'cubic-bezier(.3,1.5,.5,1)' },
    );
  }, [pulse]);

  return (
    <button
      ref={ref}
      // 只有列表能接收拖放
      data-tab-id={isList ? id : undefined}
      data-view={id}
      className={`nav-item ${active ? 'is-active' : ''} ${dropTarget ? 'is-drop' : ''}`}
      onClick={() => {
        useData.getState().setPrefs({ activeView: id });
        useUi.getState().set({ trashOpen: false });
      }}
      title={`${label} · ${hint}（${shortcut}）`}
      role="tab"
      aria-selected={active}
    >
      {active && (
        <motion.span layoutId="nav-active" className="nav-active-bg" transition={{ type: 'spring', stiffness: 560, damping: 40 }} />
      )}
      <span className="nav-icon" data-fly-target>
        <Icon width={18} height={18} />
      </span>
      <span className="nav-text">
        <span className="nav-label">{label}</span>
        <span className="nav-hint">{hint}</span>
      </span>
      {count > 0 && (
        <motion.span
          key={count}
          className={`nav-count nav-count-${countKind}`}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 600, damping: 30 }}
        >
          {count > 99 ? '99+' : count}
        </motion.span>
      )}
    </button>
  );
}

function ProfileButton() {
  const current = useData((s) => s.profiles.find((p) => p.id === s.profileId));
  const open = useUi((s) => s.profileMenuOpen);
  const ref = useRef<HTMLButtonElement>(null);
  if (!current) return null;
  return (
    <>
      <button
        ref={ref}
        className={`pf-button ${open ? 'is-open' : ''}`}
        onClick={() => useUi.getState().set({ profileMenuOpen: !open })}
        title={`Profile：${current.name}（${PROFILE_SHORTCUT} 切换）`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ProfileAvatar profile={current} />
        <span className="pf-button-name">{current.name}</span>
        <ChevronIcon className="pf-button-chevron" width={13} height={13} />
      </button>
      {open && <ProfileMenu anchor={ref} />}
    </>
  );
}

/** 左侧栏：profile 切换 + 四个列表 + 完成记录。窗口窄时只显示图标，拉宽后显示文字 */
export function Sidebar() {
  const todos = useData((s) => s.todos);
  const active = useData((s) => s.prefs.activeView);
  const counts = useMemo(
    () => Object.fromEntries(LISTS.map((l) => [l.id, openCount(todos, l.id)])) as Record<ListId, number>,
    [todos],
  );
  const doneToday = useMemo(() => completedSince(todos, startOfToday(Date.now())), [todos]);

  return (
    <aside className="sidebar">
      <ProfileButton />
      <nav className="nav" role="tablist" aria-orientation="vertical">
        {LISTS.map((l, i) => (
          <NavItem
            key={l.id}
            id={l.id}
            label={l.label}
            hint={l.hint}
            shortcut={`${mod}${i + 1}`}
            Icon={ListIcons[l.id]}
            active={active === l.id}
            count={counts[l.id]}
          />
        ))}
        <div className="nav-sep" />
        <NavItem
          id="history"
          label={HISTORY_META.label}
          hint={HISTORY_META.hint}
          shortcut={`${mod}${LISTS.length + 1}`}
          Icon={HistoryIcon}
          active={active === 'history'}
          count={doneToday}
          countKind="done"
        />
      </nav>
    </aside>
  );
}
