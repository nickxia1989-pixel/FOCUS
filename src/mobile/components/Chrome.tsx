// 外框：滚动页（标题、左右两页）、网页这一层的导航栏、网页版页签栏 / 侧栏、空间头像
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { completedSince, startOfToday } from '../../model';
import { LISTS, type ListId } from '../../types';
import { nativeChrome } from '../chrome';
import { goSection, openComposer } from '../actions';
import { avatarColors, SECTIONS, type Profile, type Section } from '../data';
import { MoreIcon, PlusIcon, SectionIcons, SwapIcon, TrashIcon } from '../icons';
import { activeOf, useData, useTodos } from '../store';
import { restored, saveTransient } from '../transient';
import { rectOf, useUi } from '../ui';
import { SyncButton } from './SyncSheets';

export const SECTION_META: Record<Section, { label: string; hint: string }> = {
  ...(Object.fromEntries(LISTS.map((l) => [l.id, { label: l.label, hint: l.hint }])) as Record<
    ListId,
    { label: string; hint: string }
  >),
  history: { label: 'HISTORY', hint: '完成记录' },
};

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 新建时默认放进哪个列表：HISTORY 页里新建的进 FOCUS */
export const composeTarget = (s: Section): ListId => (s === 'history' ? 'focus' : s);

const isDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

export function Avatar({ profile, size = 30 }: { profile: Profile; size?: number }) {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const c = avatarColors(profile.tint, dark);
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.46, background: c.bg, color: c.fg }}
      aria-hidden
    >
      {[...profile.name][0] ?? '?'}
    </span>
  );
}

/** 列表里还没完成的顶层项（标题「FOCUS · 5」、NOW 卡「01 / 05」、页签角标都按这个数） */
export function openRoots(todos: { list: ListId; done: boolean; parentId: string | null }[], list: ListId) {
  let n = 0;
  for (const t of todos) if (t.list === list && !t.done && t.parentId === null) n++;
  return n;
}

export function useCounts() {
  const todos = useTodos();
  const counts = {} as Record<Section, number>;
  for (const l of LISTS) counts[l.id] = openRoots(todos, l.id);
  counts.history = completedSince(todos, startOfToday(Date.now()));
  return counts;
}

/** 标题两行：日期（HISTORY 是「完成记录」）+「列表名 · 数字」 */
export function useTitle(section: Section) {
  const counts = useCounts();
  const now = new Date();
  const date = section === 'history' ? '完成记录' : `${now.getMonth() + 1}/${now.getDate()} ${WEEK[now.getDay()]}`;
  const title =
    section === 'history' ? `HISTORY · 今天 ${counts.history}` : `${SECTION_META[section].label} · ${counts[section]}`;
  return { date, title };
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

// ---------- 左右两页 ----------

/** 标题在内容顶上那一份（Duo 外屏、双页；标题在导航栏那一行时由 CSS 藏起来） */
function Head({ section }: { section: Section }) {
  const { date, title } = useTitle(section);
  return (
    <header className="head">
      <span className="head-date">{date}</span>
      <b className="head-title">{title}</b>
    </header>
  );
}

/**
 * 一个分区的内容分成左右两部分：窄屏时上下排在同一个滚动页里，双页时各成一页、各自滚动。
 * 同一份 DOM，开合时只换样式，正在编辑的内容和滚动位置都在。
 */
export function Panes({ section, left, right }: { section: Section; left: ReactNode; right?: ReactNode }) {
  return (
    <>
      <div className="pane-l" data-pane="l">
        <Head section={section} />
        {left}
        <div className="screen-bottom only-spread" />
      </div>
      <div className="pane-r" data-pane="r">
        {right}
        <div className="screen-bottom" />
      </div>
    </>
  );
}

// ---------- 滚动页 ----------

/** 当前负责滚动的元素：双页时是元素所在的那一页，窄屏时是整个滚动页 */
function scrollerOf(el: Element, screen: HTMLElement) {
  return (el.closest('.is-spread .pane-l, .is-spread .pane-r') as HTMLElement | null) ?? screen;
}

/** 滚动页顶上被导航栏 / 留白挡住的那条线（视口坐标） */
function lineOf(scroller: HTMLElement, screen: HTMLElement) {
  const top = scroller.getBoundingClientRect().top;
  if (scroller !== screen) return top + parseFloat(getComputedStyle(scroller).paddingTop || '0');
  return top + (screen.parentElement?.querySelector<HTMLElement>('.navbar')?.offsetHeight ?? 0);
}

/**
 * 记住视口顶部的第一行；宽度变化（开合、旋转、分成两页）导致文字重排、甚至换了滚动容器时，
 * 把这一行放回原来的位置，而不是停在原来的 scrollTop。
 */
function useScrollAnchor(ref: React.RefObject<HTMLDivElement | null>, section: Section) {
  useEffect(() => {
    const screen = ref.current;
    const wrap = screen?.parentElement;
    if (!screen || !wrap) return;
    let anchor: { key: string; offset: number } | null = null;
    let lastWidth = screen.clientWidth;
    /** 宽度过渡期间只复位、不重新取锚点 */
    let settleUntil = 0;

    const capture = (e: Event) => {
      if (performance.now() < settleUntil) return;
      const scroller = e.target instanceof HTMLElement ? e.target : screen;
      if (scroller !== screen && !scroller.matches('.pane-l, .pane-r')) return;
      anchor = null;
      if (scroller.scrollTop <= 0) {
        saveTransient({ anchor: undefined });
        return;
      }
      const limit = lineOf(scroller, screen);
      for (const n of scroller.querySelectorAll<HTMLElement>('[data-anchor]')) {
        const r = n.getBoundingClientRect();
        if (r.height > 0 && r.bottom > limit) {
          anchor = { key: n.dataset.anchor!, offset: r.top - limit };
          saveTransient({ anchor: { section, ...anchor } });
          return;
        }
      }
    };

    const restore = (a: { key: string; offset: number }) => {
      const n = screen.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(a.key)}"]`);
      if (!n) return;
      const scroller = scrollerOf(n, screen);
      const delta = n.getBoundingClientRect().top - lineOf(scroller, screen) - a.offset;
      if (Math.abs(delta) > 0.5) scroller.scrollTop += delta;
    };

    // 页面重载后回到原来那一行
    const saved = restored.anchor;
    restored.anchor = undefined;
    if (saved?.section === section) requestAnimationFrame(() => restore(saved));

    const ro = new ResizeObserver(() => {
      if (screen.clientWidth === lastWidth) return;
      lastWidth = screen.clientWidth;
      settleUntil = performance.now() + 450;
      const a = anchor;
      if (!a) return;
      // 等这一轮的双页 / 单页样式换完再复位
      requestAnimationFrame(() => requestAnimationFrame(() => restore(a)));
    });
    wrap.addEventListener('scroll', capture, { capture: true, passive: true });
    ro.observe(screen);
    return () => {
      wrap.removeEventListener('scroll', capture, { capture: true });
      ro.disconnect();
    };
  }, [ref, section]);
}

export function Screen({
  section,
  wide,
  spread,
  children,
}: {
  section: Section;
  wide: boolean;
  spread: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const profile = useData((s) => activeOf(s));
  const { date, title } = useTitle(section);

  // 换分区或换空间时回到顶部
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
    setScrolled(false);
  }, [section, profile.id]);
  useScrollAnchor(ref, section);

  // 滚动页（窄屏）或任一页（双页）滚离顶部时，导航栏底下出现毛玻璃
  useEffect(() => {
    const wrap = ref.current?.parentElement;
    if (!wrap) return;
    const on = (e: Event) => {
      const t = e.target as HTMLElement;
      if (!t.matches?.('.screen, .pane-l, .pane-r')) return;
      setScrolled(t.scrollTop > 4);
    };
    wrap.addEventListener('scroll', on, { capture: true, passive: true });
    return () => wrap.removeEventListener('scroll', on, { capture: true });
  }, []);
  useEffect(() => {
    if (useUi.getState().scrolled !== scrolled) useUi.getState().set({ scrolled });
  }, [scrolled]);

  return (
    <div className="screen-wrap">
      <div className="screen" ref={ref}>
        {/* 换列表：旧内容淡出、新内容从下方 8px 升起（220ms） */}
        <motion.div
          key={`${profile.id}-${section}`}
          className="view"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, delay: 0.06, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {children}
        </motion.div>
      </div>

      <div className="navbar">
        <div className="navbar-bg" style={{ opacity: scrolled ? 1 : 0, transition: 'opacity .2s' }} />
        <div className="navbar-row">
          {/* 原生外壳在时头像、云朵、⋯ 是原生的玻璃按钮，这里只画标题 */}
          {!nativeChrome && !wide && (
            <button
              className="gbtn glass"
              aria-label={`当前空间：${profile.name}，点按切换`}
              onClick={() => useUi.getState().set({ sheet: 'profiles' })}
            >
              <Avatar profile={profile} size={30} />
            </button>
          )}
          <div className="nav-title">
            <span className="nav-title-date">{date}</span>
            <b className="nav-title-main">{title}</b>
          </div>
          {!nativeChrome && (
            <div className="gcap glass">
              {/* 大屏没有底部页签栏和 + 钮，新建放在这里 */}
              {wide && (
                <button aria-label="新建" onClick={() => openComposer(composeTarget(section))}>
                  <PlusIcon />
                </button>
              )}
              <SyncButton />
              <button aria-label="更多" onClick={openMore}>
                <MoreIcon />
              </button>
            </div>
          )}
        </div>
      </div>
      {!spread && <div className="edge-fade" />}
    </div>
  );
}

// ---------- 网页版页签栏（没有原生外壳时） ----------

const BADGED = new Set<Section>(['focus', 'verify', 'inbox']);

export function TabBar({ section, hidden }: { section: Section; hidden: boolean }) {
  const counts = useCounts();
  return (
    <div className="tabbar-wrap" inert={hidden} aria-hidden={hidden}>
      <nav className="tabbar glass" aria-label="分区">
        {SECTIONS.map((s) => (
          <TabButton key={s} section={s} active={s === section} count={BADGED.has(s) ? counts[s] : 0} />
        ))}
      </nav>
      <button className="fab" aria-label="新建" onClick={() => openComposer(composeTarget(section))}>
        <PlusIcon />
      </button>
    </div>
  );
}

function TabButton({ section, active, count }: { section: Section; active: boolean; count: number }) {
  const Icon = SectionIcons[section];
  const pulseKey = usePulse(section);
  return (
    <button
      className={`tab ${active ? 'is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      aria-label={`${SECTION_META[section].label} ${SECTION_META[section].hint}${count ? `，${count}` : ''}`}
      onClick={() => goSection(section)}
    >
      {active && (
        <motion.span layoutId="tab-pill" className="tab-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
      )}
      <motion.span
        key={pulseKey}
        className="tab-icon"
        data-target={section}
        initial={pulseKey ? { scale: 1.18 } : false}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 14 }}
      >
        <Icon />
        {count > 0 && <span className="tab-badge">{count > 99 ? '99+' : count}</span>}
      </motion.span>
      <span className="tab-label">{SECTION_META[section].label}</span>
    </button>
  );
}

// ---------- 网页版侧栏（iPad 等大屏、没有原生外壳时） ----------

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
        <SwapIcon width={18} height={18} />
      </button>

      <nav className="side-nav" aria-label="分区">
        {SECTIONS.map((s) => (
          <SideItem key={s} section={s} active={s === section} count={BADGED.has(s) ? counts[s] : 0} />
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
      className={`side-item ${active ? 'is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={() => goSection(section)}
    >
      {active && (
        <motion.span layoutId="side-pill" className="side-pill" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
      )}
      <motion.span
        key={pulseKey}
        className="side-icon"
        data-target={section}
        initial={pulseKey ? { scale: 1.18 } : false}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 14 }}
      >
        <Icon width={21} height={21} />
      </motion.span>
      <span className="side-label">{SECTION_META[section].label}</span>
      <span className="side-hint">{SECTION_META[section].hint}</span>
      {count > 0 && <span className="side-count">{count}</span>}
    </button>
  );
}
