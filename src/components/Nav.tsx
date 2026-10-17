import { AnimatePresence, motion } from 'motion/react';
import { useMemo, type CSSProperties } from 'react';
import { goView, openTrash } from '../actions';
import { completedSince } from '../model';
import { isMac } from '../platform';
import { useData, useUi } from '../store';
import { LIST_IDS, VIEW_IDS, type ListId, type Profile, type Todo, type ViewId } from '../types';
import { LIST_COLOR, LIST_ON, LIST_SOFT, VIEW_COPY } from './copy';
import { SwapIcon, TrashIcon, ViewIcons } from './icons';
import { useTodayStart } from './useToday';

const EASE = [0.2, 0.8, 0.2, 1] as const;
const MOD = isMac ? '⌘' : 'Ctrl+';

// ---------- 空间头像 ----------

/** 按顺序取色：第一个近黑底荧光绿字（深色模式反过来），其余浅色底近黑字 */
const AVATARS: [string, string][] = [
  ['var(--av0-bg)', 'var(--av0-fg)'],
  ['#FF8A65', '#0B0B0C'],
  ['#B8A6FF', '#0B0B0C'],
  ['#8FD3FF', '#0B0B0C'],
  ['#F2E2B8', '#0B0B0C'],
];

export function avatarStyle(index: number): CSSProperties {
  const [bg, fg] = AVATARS[Math.max(0, index) % AVATARS.length];
  return { '--av-bg': bg, '--av-fg': fg } as CSSProperties;
}

/** 头像上的字：名字的第一个字符，英文转大写 */
export const initialOf = (name: string) => (Array.from(name.trim())[0] ?? '?').toUpperCase();

function useCurrentProfile(): { profile: Profile | undefined; index: number; total: number } {
  const profiles = useData((s) => s.profiles);
  const id = useData((s) => s.profileId);
  const index = profiles.findIndex((p) => p.id === id);
  return { profile: profiles[index], index, total: profiles.length };
}

const toggleProfileMenu = () => {
  const ui = useUi.getState();
  ui.set({ profileMenuOpen: !ui.profileMenuOpen, mainMenuOpen: false, menu: null });
};

// ---------- 数字 ----------

/** 各列表未完成的顶层项数（和 NOW 卡上的 01/05、「接下来 · 4」一致） */
function useCounts() {
  const todos = useData((s) => s.todos);
  const today = useTodayStart();
  return useMemo(() => {
    const open = Object.fromEntries(LIST_IDS.map((l) => [l, 0])) as Record<ListId, number>;
    for (const t of todos as Todo[]) if (!t.done && t.parentId === null) open[t.list]++;
    return { open, doneToday: completedSince(todos, today) };
  }, [todos, today]);
}

/** 数字变化时上翻 */
function Count({ n, prefix = '' }: { n: number; prefix?: string }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.em key={n} initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -6, opacity: 0 }} transition={{ duration: 0.18, ease: EASE }}>
        {prefix}
        {n > 99 ? '99+' : n}
      </motion.em>
    </AnimatePresence>
  );
}

function useActiveView(): ViewId | 'trash' {
  const active = useData((s) => s.prefs.activeView);
  const trash = useUi((s) => s.trashOpen);
  return trash ? 'trash' : active;
}

// ---------- compact：页签胶囊 ----------

function Pill({ view, on, count }: { view: ViewId; on: boolean; count: number }) {
  const Icon = ViewIcons[view];
  const copy = VIEW_COPY[view];
  const isList = view !== 'history';
  const drop = useUi((s) => s.dragOverTab === view);
  const idx = VIEW_IDS.indexOf(view) + 1;
  return (
    <motion.button
      layout
      transition={{ layout: { duration: 0.22, ease: EASE } }}
      className={`pill ${on ? 'on' : ''} ${drop ? 'drop' : ''}`}
      style={{ '--c': LIST_COLOR[view], '--cs': LIST_SOFT[view], '--c-on': LIST_ON[view] } as CSSProperties}
      data-view-tab={view}
      data-tab-id={isList ? view : undefined}
      role="tab"
      aria-selected={on}
      aria-label={copy.en}
      title={`${copy.en} · ${copy.cn}（${MOD}${idx}）`}
      onClick={() => goView(view)}
    >
      <motion.span layout="position" className="pill-icon fly-target">
        <Icon />
      </motion.span>
      {on && (
        <motion.span layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18, delay: 0.06 }}>
          {copy.en}
        </motion.span>
      )}
      {isList && count > 0 && (
        <motion.span layout="position" style={{ display: 'inline-flex' }}>
          <Count n={count} />
        </motion.span>
      )}
    </motion.button>
  );
}

/** 窄窗口：标题栏下一排页签胶囊，空间头像 + 五个分区，选中项展开显示名字 */
export function Pills() {
  const active = useActiveView();
  const { open } = useCounts();
  const { profile, index } = useCurrentProfile();
  const menuOpen = useUi((s) => s.profileMenuOpen);
  return (
    <motion.div
      className="pills"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 40, opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
    >
      <div className="pills-in" role="tablist">
        {profile && (
          <button
            className="avatar"
            style={avatarStyle(index)}
            data-profile-anchor
            title={`切换 profile：${profile.name}（${MOD}⇧P）`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={toggleProfileMenu}
          >
            {initialOf(profile.name)}
          </button>
        )}
        {VIEW_IDS.map((v) => (
          <Pill key={v} view={v} on={active === v} count={v === 'history' ? 0 : open[v]} />
        ))}
      </div>
    </motion.div>
  );
}

// ---------- regular：左侧栏 ----------

function NavItem({ view, on, count, countPrefix }: { view: ViewId; on: boolean; count: number; countPrefix?: string }) {
  const Icon = ViewIcons[view];
  const copy = VIEW_COPY[view];
  const isList = view !== 'history';
  const drop = useUi((s) => s.dragOverTab === view);
  const idx = VIEW_IDS.indexOf(view) + 1;
  return (
    <button
      className={`nav-item ${on ? 'on' : ''} ${view === 'focus' ? 'f' : ''} ${drop ? 'drop' : ''}`}
      style={{ '--c': LIST_COLOR[view], '--cs': LIST_SOFT[view] } as CSSProperties}
      data-view-tab={view}
      data-tab-id={isList ? view : undefined}
      role="tab"
      aria-selected={on}
      title={`${copy.en} · ${copy.cn}（${MOD}${idx}）`}
      onClick={() => goView(view)}
    >
      <span className="fly-target">
        <Icon />
      </span>
      <b>{copy.en}</b>
      <span className="cn">{copy.cn}</span>
      {count > 0 && <Count n={count} prefix={countPrefix} />}
    </button>
  );
}

/** 宽窗口：左侧栏 200，空间卡片、四个列表、HISTORY、底部回收站 */
export function Sidebar() {
  const active = useActiveView();
  const { open, doneToday } = useCounts();
  const { profile, index, total } = useCurrentProfile();
  const menuOpen = useUi((s) => s.profileMenuOpen);
  const trashCount = useData((s) => s.trash.reduce((n, e) => n + e.items.length, 0));
  return (
    <motion.nav
      className="side"
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 200, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.24, ease: EASE }}
    >
      <div className="side-in" role="tablist" aria-orientation="vertical">
        {profile && (
          <button
            className={`pcard ${menuOpen ? 'open' : ''}`}
            data-profile-anchor
            title={`切换 profile（${MOD}⇧P）`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={toggleProfileMenu}
          >
            <span className="avatar big" style={avatarStyle(index)}>
              {initialOf(profile.name)}
            </span>
            <span className="pcard-text">
              <b>{profile.name}</b>
              <span className="sub">共 {total} 个空间</span>
            </span>
            <SwapIcon />
          </button>
        )}
        {LIST_IDS.map((l) => (
          <NavItem key={l} view={l} on={active === l} count={open[l]} />
        ))}
        <div className="side-sep" />
        <NavItem view="history" on={active === 'history'} count={doneToday} countPrefix="+" />
        <div className="side-foot">
          <button
            className={`nav-item trash ${active === 'trash' ? 'on' : ''}`}
            style={{ '--c': 'var(--mu)', '--cs': 'var(--sf2)' } as CSSProperties}
            onClick={openTrash}
            title="回收站"
          >
            <TrashIcon />
            <span className="cn">回收站</span>
            {trashCount > 0 && <em>{trashCount}</em>}
          </button>
        </div>
      </div>
    </motion.nav>
  );
}
