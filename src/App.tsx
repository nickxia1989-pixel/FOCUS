import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { goView, undoDelete } from './actions';
import { ConflictPanel, JoinModal } from './components/ConflictPanel';
import { FocusView } from './components/FocusView';
import { HistoryView } from './components/HistoryView';
import { ListView } from './components/ListView';
import { Pills, Sidebar } from './components/Nav';
import { ContextMenu, Footer, Toast } from './components/Overlays';
import { KeysPanel } from './components/KeysPanel';
import { ProfileMenu } from './components/ProfileMenu';
import { SyncPanel } from './components/SyncPanel';
import { TitleBar } from './components/TitleBar';
import { TrashView } from './components/TrashView';
import { initSync } from './syncDesktop';
import { api, isMac } from './platform';
import { useData, useUi } from './store';
import { VIEW_IDS } from './types';

/** 宽 < 520 是 compact（页签胶囊），≥ 520 是 regular（左侧栏） */
const REGULAR_MIN = 520;
/** 再窄一点时页签胶囊收紧 */
const NARROW_MAX = 350;

function useWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      // ⌘1～5：四个列表和完成记录
      if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key) && Number(e.key) <= VIEW_IDS.length) {
        e.preventDefault();
        goView(VIEW_IDS[Number(e.key) - 1]);
        return;
      }
      // ⌘⇧P：打开 / 关闭 profile 菜单
      if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        const ui = useUi.getState();
        ui.set({ profileMenuOpen: !ui.profileMenuOpen, menu: null, mainMenuOpen: false });
        return;
      }
      // ⌘N：聚焦新建框（HISTORY 里没有新建框，先回到 FOCUS）
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        const view = useData.getState().prefs.activeView;
        if (view === 'history' || useUi.getState().trashOpen) goView('focus');
        useUi.getState().set({ composeFocus: true });
        requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('add-input')?.focus()));
        return;
      }
      if (mod && e.key.toLowerCase() === 'z' && !isTyping(e) && useUi.getState().toast?.undoEntry) {
        e.preventDefault();
        undoDelete();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

const EASE = [0.2, 0.8, 0.2, 1] as const;

export default function App() {
  const loaded = useData((s) => s.loaded);
  const active = useData((s) => s.prefs.activeView);
  const profileId = useData((s) => s.profileId);
  const trashOpen = useUi((s) => s.trashOpen);
  const width = useWidth();
  const regular = width >= REGULAR_MIN;
  const narrow = width < NARROW_MAX;

  // 布局模式挂在根节点上：动效层、拖拽预览这些挂在 body 下的元素也按同一套尺寸画
  useEffect(() => {
    const cl = document.documentElement.classList;
    cl.toggle('regular', regular);
    cl.toggle('compact', !regular);
    cl.toggle('narrow', narrow);
  }, [regular, narrow]);

  useEffect(() => {
    void useData
      .getState()
      .init()
      .then(() => initSync());
  }, []);

  // 外观：跟随系统 / 浅色 / 深色。Electron 里设 nativeTheme（窗口外框也跟着变），根节点的 data-theme 管页面配色
  const appearance = useData((s) => s.local.appearance);
  useEffect(() => {
    if (!loaded) return;
    const apply = (eff: string) => {
      if (eff === 'light' || eff === 'dark') document.documentElement.dataset.theme = eff;
      else delete document.documentElement.dataset.theme;
    };
    apply(appearance);
    void api?.setThemeSource?.(appearance).then(apply);
  }, [appearance, loaded]);

  // 换列表时收起「写一件」
  useEffect(() => {
    useUi.getState().set({ composeFocus: false });
  }, [active, profileId]);

  useShortcuts();

  if (!loaded) return null;

  const viewKey = `${profileId}:${trashOpen ? 'trash' : active}`;

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <TitleBar />
        <div className="body">
          <AnimatePresence initial={false}>{regular && <Sidebar key="side" />}</AnimatePresence>
          <div className="main">
            <AnimatePresence initial={false}>{!regular && <Pills key="pills" />}</AnimatePresence>
            <div className="stage">
              {/* 切换列表：旧内容淡出下沉 0–120，新内容淡入并上升 8px 60–220 */}
              <AnimatePresence initial={false}>
                <motion.div
                  key={viewKey}
                  className="view"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0, transition: { duration: 0.16, delay: 0.06, ease: EASE } }}
                  exit={{ opacity: 0, y: 4, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } }}
                >
                  {trashOpen ? (
                    <TrashView />
                  ) : active === 'focus' ? (
                    <FocusView />
                  ) : active === 'history' ? (
                    <HistoryView />
                  ) : (
                    <ListView list={active} />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
            <Footer />
            <Toast />
          </div>
        </div>
        <SyncPanel />
        <KeysPanel />
        <ConflictPanel />
        <JoinModal />
        <ContextMenu />
        <ProfileMenu />
      </div>
    </MotionConfig>
  );
}
