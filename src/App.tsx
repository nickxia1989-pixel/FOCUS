import { useEffect, useRef } from 'react';
import { undoDelete } from './actions';
import { ListView } from './components/ListView';
import { ContextMenu, Footer, Toast } from './components/Overlays';
import { Tabs } from './components/Tabs';
import { TitleBar } from './components/TitleBar';
import { isMac, platform } from './platform';
import { useData, useUi } from './store';
import { LIST_IDS } from './types';

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && ['1', '2', '3'].includes(e.key)) {
        e.preventDefault();
        useData.getState().setPrefs({ activeList: LIST_IDS[Number(e.key) - 1] });
        return;
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        document.getElementById('add-input')?.focus();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z' && !isTyping(e) && useUi.getState().toast?.undo) {
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
  const active = useData((s) => s.prefs.activeList);
  const prev = useRef(active);
  const dir = Math.sign(LIST_IDS.indexOf(active) - LIST_IDS.indexOf(prev.current));

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
      <Tabs />
      <ListView key={active} list={active} dir={dir} />
      <Footer />
      <ContextMenu />
      <Toast />
    </div>
  );
}
