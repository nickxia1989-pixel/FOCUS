import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Screen, Sidebar, TabBar } from './components/Chrome';
import { Composer } from './components/Composer';
import { HistoryContent } from './components/HistoryContent';
import { ListContent } from './components/ListContent';
import { ContextMenu, MoreMenu, Toast } from './components/Overlays';
import { ProfileSheet, TrashSheet } from './components/Sheets';
import { activeOf, useData } from './store';
import { restored, takeTransient } from './transient';
import { useUi } from './ui';

/**
 * 只有大屏用侧栏双栏：iPhone Duo 展开后的内屏（横竖都是）、iPad。
 * 手机（常规 iPhone 横竖屏、Duo 合上时的外屏）一律用底部页签，横屏时页签变矮。
 * 判断依据是短边：手机横过来宽度也会超过 640，但高度不到 600。
 */
const WIDE_QUERY = '(min-width: 640px) and (min-height: 600px)';

// 启动时先取出上次没来得及保存的临时状态（折叠 / 展开时页面被重建的情况）
Object.assign(restored, takeTransient() ?? {});
delete (restored as { at?: number }).at;

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
    void useData
      .getState()
      .init()
      .then(() => {
        // 页面重载前正在编辑的条目：还在就接着编辑（草稿由 TitleEditor 取用）
        const id = restored.editing?.id;
        if (id && activeOf(useData.getState()).todos.some((t) => t.id === id)) useUi.getState().set({ editingId: id });
        else restored.editing = undefined;
        const c = restored.composer;
        if (c) useUi.getState().set({ composer: { open: false, list: c.list, parentId: c.parentId } });
      });
  }, []);

  useEffect(() => {
    // 主题色挂在根节点上，粒子、浮层等挂在 body 下的元素也能取到
    document.documentElement.dataset.section = section;
  }, [section]);

  // 形态切换（折叠 / 展开、旋转）时，按旧位置定位的浮层和滑开的行都收起来；分区、滚动、编辑中的内容保留
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const ui = useUi.getState();
    if (ui.menu || ui.more || ui.swipedId) ui.set({ menu: null, more: null, swipedId: null });
  }, [wide]);

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
      {/* 侧栏和页签都常驻，只用 CSS 过渡切换显隐：切换形态时列表不重建，滚动和编辑都不丢 */}
      <div className="sidebar-shell" inert={!wide} aria-hidden={!wide}>
        <Sidebar section={section} />
      </div>
      <main className="main">
        <Screen section={section} wide={wide}>
          {section === 'history' ? <HistoryContent /> : <ListContent list={section} />}
        </Screen>
      </main>
      <TabBar section={section} hidden={wide} />
      <Composer />
      <ContextMenu />
      <MoreMenu />
      <ProfileSheet wide={wide} />
      <TrashSheet wide={wide} />
      <Toast />
    </div>
  );
}
