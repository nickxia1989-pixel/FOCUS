import { useEffect, useRef } from 'react';
import { undoDelete } from './actions';
import { HistoryView } from './components/HistoryView';
import { ListView } from './components/ListView';
import { ContextMenu, Footer, Toast } from './components/Overlays';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { TrashPanel } from './components/TrashPanel';
import { isMac, platform } from './platform';
import { useData, useUi } from './store';
import { VIEW_IDS } from './types';

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
        useData.getState().setPrefs({ activeView: VIEW_IDS[Number(e.key) - 1] });
        useUi.getState().set({ trashOpen: false });
        return;
      }
      // ⌘⇧P：打开 / 关闭 profile 菜单
      if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        const ui = useUi.getState();
        ui.set({ profileMenuOpen: !ui.profileMenuOpen, menu: null });
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        useUi.getState().set({ trashOpen: false });
        // 完成记录里没有输入框，先回到 INBOX
        if (useData.getState().prefs.activeView === 'history') useData.getState().setPrefs({ activeView: 'inbox' });
        // 回收站收起、列表渲染出来后输入框才可见
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

export default function App() {
  const loaded = useData((s) => s.loaded);
  const active = useData((s) => s.prefs.activeView);
  const profileId = useData((s) => s.profileId);
  const prev = useRef(active);
  const dir = Math.sign(VIEW_IDS.indexOf(active) - VIEW_IDS.indexOf(prev.current));

  useEffect(() => {
    prev.current = active;
    // 主题色挂在根节点上，拖拽预览、粒子等挂在 body 下的元素也能取到
    document.documentElement.dataset.list = active;
  }, [active]);

  useEffect(() => {
    void useData.getState().init();
  }, []);

  useShortcuts();

  if (!loaded) return null;

  return (
    <div className={`app platform-${platform}`}>
      <TitleBar />
      <div className="main">
        <Sidebar />
        <div className="content">
          {active === 'history' ? (
            <HistoryView key={`${profileId}:history`} dir={dir} />
          ) : (
            <ListView key={`${profileId}:${active}`} list={active} dir={dir} />
          )}
          <Footer />
        </div>
      </div>
      <TrashPanel />
      <ContextMenu />
      <Toast />
    </div>
  );
}
