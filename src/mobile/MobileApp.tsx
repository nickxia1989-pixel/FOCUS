import { useEffect, useSyncExternalStore } from 'react';
import { Screen, Sidebar, TabBar } from './components/Chrome';
import { Composer } from './components/Composer';
import { HistoryContent } from './components/HistoryContent';
import { ListContent } from './components/ListContent';
import { ContextMenu, MoreMenu, Toast } from './components/Overlays';
import { ProfileSheet, TrashSheet } from './components/Sheets';
import { useData } from './store';
import { useUi } from './ui';

/**
 * 宽度够放侧栏时用双栏：iPhone Duo 展开后的内屏（横竖都是）、外屏横放、Pro Max 横屏。
 * 窄屏（常规 iPhone 竖屏、Duo 外屏竖放）用底部标签栏单栏。
 */
const WIDE_QUERY = '(min-width: 640px)';

function useWide() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(WIDE_QUERY);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(WIDE_QUERY).matches,
  );
}

export function MobileApp() {
  const loaded = useData((s) => s.loaded);
  const section = useData((s) => s.prefs.section);
  const wide = useWide();

  useEffect(() => {
    void useData.getState().init();
  }, []);

  useEffect(() => {
    // 主题色挂在根节点上，粒子、浮层等挂在 body 下的元素也能取到
    document.documentElement.dataset.section = section;
  }, [section]);

  useEffect(() => {
    // 点到滑开的行以外的地方：收回
    const onDown = (e: PointerEvent) => {
      const id = useUi.getState().swipedId;
      if (id && !(e.target as Element).closest(`[data-swipe-id="${CSS.escape(id)}"]`))
        useUi.getState().set({ swipedId: null });
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  if (!loaded) return null;

  return (
    <div className={`app ${wide ? 'is-wide' : 'is-compact'}`}>
      {wide && <Sidebar section={section} />}
      <main className="main">
        <Screen section={section} wide={wide}>
          {section === 'history' ? <HistoryContent /> : <ListContent list={section} />}
        </Screen>
      </main>
      {!wide && <TabBar section={section} />}
      <Composer />
      <ContextMenu />
      <MoreMenu />
      <ProfileSheet wide={wide} />
      <TrashSheet wide={wide} />
      <Toast />
    </div>
  );
}
