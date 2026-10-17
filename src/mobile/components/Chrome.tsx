// 外框：导航栏 + 大标题的滚动页、底部标签栏、宽屏侧栏、profile 头像
import { motion, useMotionValueEvent, useScroll, useTransform } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { completedSince, openCount, startOfToday } from '../../model';
import { LISTS, type ListId } from '../../types';
import { goSection, openComposer } from '../actions';
import { PROFILE_TINTS, SECTIONS, type Profile, type Section } from '../data';
import { MoreIcon, PlusIcon, SectionIcons, SwapIcon, TrashIcon } from '../icons';
import { activeOf, useData, useTodos } from '../store';
import { rectOf, useUi } from '../ui';

export const SECTION_META: Record<Section, { label: string; hint: string }> = {
  ...(Object.fromEntries(LISTS.map((l) => [l.id, { label: l.label, hint: l.hint }])) as Record<
    ListId,
    { label: string; hint: string }
  >),
  history: { label: 'HISTORY', hint: '完成记录' },
};

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 新建时默认放进哪个列表：HISTORY 页里新建的进 INBOX */
export const composeTarget = (s: Section): ListId => (s === 'history' ? 'inbox' : s);

export function Avatar({ profile, size = 32 }: { profile: Profile; size?: number }) {
  const tint = PROFILE_TINTS[profile.tint] ?? PROFILE_TINTS[0];
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.46, background: tint }} aria-hidden>
      {[...profile.name][0] ?? '?'}
    </span>
  );
}

function useCounts() {
  const todos = useTodos();
  const counts = {} as Record<Section, number>;
  for (const l of LISTS) counts[l.id] = openCount(todos, l.id);
  counts.history = completedSince(todos, startOfToday(Date.now()));
  return counts;
}

/** 分区收到东西时图标弹一下 */
function usePulse(section: Section) {
  const n = useUi((s) => s.pulse[section]);
  const [key, setKey] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setKey((k) => k + 1);
  }, [n]);
  return key;
}

function openMore(e: React.MouseEvent) {
  useUi.getState().set({ more: rectOf(e.currentTarget) });
}

// ---------- 滚动页 ----------

export function Screen({ section, wide, children }: { section: Section; wide: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll({ container: ref });
  const barOpacity = useTransform(scrollY, [8, 40], [0, 1]);
  const titleOpacity = useTransform(scrollY, [30, 56], [0, 1]);
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, 'change', (v) => setScrolled(v > 30));
  const profile = useData((s) => activeOf(s));
  const counts = useCounts();
  const meta = SECTION_META[section];
  // 换分区或换空间时回到顶部
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [section, profile.id]);
  const now = new Date();
  const date = `${now.getMonth() + 1}月${now.getDate()}日 ${WEEK[now.getDay()]}`;
  const hasAny = useTodos().some((t) => t.list === section);
  const sub =
    section === 'history'
      ? `今天完成 ${counts.history} 项`
      : counts[section] > 0
        ? `${counts[section]} 项未完成`
        : hasAny
          ? '全部完成'
          : '还没有条目';

  return (
    <div className="screen-wrap">
      <div className="screen" ref={ref} data-scrolled={scrolled || undefined}>
        <header className="large-title">
          <p className="eyebrow">
            {date} · {meta.hint}
          </p>
          <h1>{meta.label}</h1>
          <p className="subtitle">{sub}</p>
        </header>
        <motion.div
          key={`${profile.id}-${section}`}
          className="screen-body"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {children}
        </motion.div>
        <div className="screen-bottom" />
      </div>

      <div className="navbar">
        <motion.div className="navbar-bg" style={{ opacity: barOpacity }} />
        <div className="navbar-row">
          <div className="navbar-side">
            {!wide && (
              <button
                className="glass-btn avatar-btn"
                aria-label={`当前空间：${profile.name}，点按切换`}
                onClick={() => useUi.getState().set({ sheet: 'profiles' })}
              >
                <Avatar profile={profile} size={30} />
              </button>
            )}
          </div>
          <motion.div className="navbar-title" style={{ opacity: titleOpacity }}>
            {meta.label}
          </motion.div>
          <div className="navbar-side navbar-right">
            {wide && (
              <button className="glass-btn" aria-label="新建" onClick={() => openComposer(composeTarget(section))}>
                <PlusIcon />
              </button>
            )}
            <button className="glass-btn" aria-label="更多" onClick={openMore}>
              <MoreIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- 窄屏：底部标签栏 ----------

export function TabBar({ section }: { section: Section }) {
  const counts = useCounts();
  return (
    <div className="tabbar-wrap">
      <nav className="tabbar glass" aria-label="分区">
        {SECTIONS.map((s) => (
          <TabButton key={s} section={s} active={s === section} count={counts[s]} />
        ))}
      </nav>
      <button className="fab glass" aria-label="新建" onClick={() => openComposer(composeTarget(section))}>
        <PlusIcon width={26} height={26} />
      </button>
    </div>
  );
}

function TabButton({ section, active, count }: { section: Section; active: boolean; count: number }) {
  const Icon = SectionIcons[section];
  const pulseKey = usePulse(section);
  return (
    <button
      className={`tab tab-${section} ${active ? 'is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      aria-label={`${SECTION_META[section].label} ${SECTION_META[section].hint}${count ? `，${count}` : ''}`}
      onClick={() => goSection(section)}
    >
      {active && (
        <motion.span
          layoutId="tab-pill"
          className="tab-pill"
          transition={{ type: 'spring', stiffness: 500, damping: 38 }}
        />
      )}
      <motion.span
        key={pulseKey}
        className="tab-icon"
        data-target={section}
        initial={pulseKey ? { scale: 1.35 } : false}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 14 }}
      >
        <Icon width={23} height={23} />
        {section !== 'history' && count > 0 && <span className="tab-badge">{count > 99 ? '99+' : count}</span>}
      </motion.span>
      <span className="tab-label">{SECTION_META[section].label}</span>
    </button>
  );
}

// ---------- 宽屏：侧栏 ----------

export function Sidebar({ section }: { section: Section }) {
  const counts = useCounts();
  const profile = useData((s) => activeOf(s));
  const profileCount = useData((s) => s.profiles.length);
  const trashCount = profile.trash.length;
  return (
    <aside className="sidebar">
      <button className="profile-card" onClick={() => useUi.getState().set({ sheet: 'profiles' })}>
        <Avatar profile={profile} size={38} />
        <span className="profile-card-text">
          <span className="profile-card-name">{profile.name}</span>
          <span className="profile-card-sub">{profileCount > 1 ? `共 ${profileCount} 个空间` : '管理空间'}</span>
        </span>
        <SwapIcon width={18} height={18} className="profile-card-icon" />
      </button>

      <nav className="side-nav" aria-label="分区">
        {SECTIONS.map((s) => (
          <SideItem key={s} section={s} active={s === section} count={counts[s]} />
        ))}
      </nav>

      <div className="sidebar-foot">
        <button className="side-item side-item-quiet" onClick={() => useUi.getState().set({ sheet: 'trash' })}>
          <span className="side-icon">
            <TrashIcon width={20} height={20} />
          </span>
          <span className="side-label">回收站</span>
          {trashCount > 0 && <span className="side-count">{trashCount}</span>}
        </button>
      </div>
    </aside>
  );
}

function SideItem({ section, active, count }: { section: Section; active: boolean; count: number }) {
  const Icon = SectionIcons[section];
  const pulseKey = usePulse(section);
  return (
    <button
      className={`side-item side-${section} ${active ? 'is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={() => goSection(section)}
    >
      {active && (
        <motion.span
          layoutId="side-pill"
          className="side-pill"
          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        />
      )}
      <motion.span
        key={pulseKey}
        className="side-icon"
        data-target={section}
        initial={pulseKey ? { scale: 1.4 } : false}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 14 }}
      >
        <Icon width={21} height={21} />
      </motion.span>
      <span className="side-label">{SECTION_META[section].label}</span>
      <span className="side-hint">{SECTION_META[section].hint}</span>
      {section !== 'history' && count > 0 && <span className="side-count">{count}</span>}
    </button>
  );
}
