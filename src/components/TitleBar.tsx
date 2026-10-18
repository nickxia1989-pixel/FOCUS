import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { openTrash } from '../actions';
import { api, isElectron, isMac, os } from '../platform';
import { useData, useUi, type Appearance } from '../store';
import type { SyncStatus } from '../sync/engine';
import {
  AppGlyph,
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  CloudStateIcon,
  FolderIcon,
  KeyboardIcon,
  MinimizeIcon,
  MoreIcon,
  PinIcon,
  SoundIcon,
  ThemeIcon,
  TrashIcon,
  type CloudState,
} from './icons';

/** 云朵的六种状态，对应同步面板里 statusText 的 tone */
export function cloudState(status: SyncStatus | null, enabled: boolean, conflicts: number): CloudState {
  if (conflicts > 0) return 'conflict';
  if (!enabled || !status || status.state === 'off') return 'off';
  if (status.state === 'syncing') return 'syncing';
  if (status.state === 'offline' || status.state === 'ratelimit') return 'offline';
  if (status.state === 'error' || status.state === 'auth') return 'error';
  return 'ok';
}

export const CLOUD_LABEL: Record<CloudState, string> = {
  ok: '已同步',
  syncing: '正在同步…',
  offline: '离线：改动已保存在本机',
  error: '同步出错，稍后自动重试',
  conflict: '有冲突需要你决定',
  off: '未开启同步',
};

const APPEARANCE_LABEL: Record<Appearance, string> = { system: '跟随系统', light: '浅色', dark: '深色' };

const CLOUD_SHORT: Record<CloudState, string> = {
  ok: '已同步',
  syncing: '同步中',
  offline: '离线',
  error: '出错',
  conflict: '有冲突',
  off: '未开启',
};

function useCloud() {
  const status = useData((s) => s.syncStatus);
  const enabled = useData((s) => s.local.sync.enabled);
  const conflicts = useData((s) => s.conflicts.length);
  return { state: cloudState(status, enabled, conflicts), conflicts, status };
}

/** 标题栏上的同步状态：有冲突时显示红色角标，点开冲突面板；否则点开同步设置 */
function SyncCloud() {
  const { state, conflicts, status } = useCloud();
  const title = state === 'conflict' ? `有 ${conflicts} 个冲突需要你决定` : state === 'error' && status?.message ? status.message : CLOUD_LABEL[state];
  return (
    <button
      className={`ib sync ${state}`}
      title={title}
      aria-label={title}
      onClick={() =>
        useUi.getState().set(conflicts ? { conflictsOpen: true, syncOpen: false, mainMenuOpen: false } : { syncOpen: true, conflictsOpen: false, mainMenuOpen: false })
      }
    >
      <CloudStateIcon state={state} />
      <AnimatePresence>
        {conflicts > 0 && (
          <motion.span
            key={conflicts}
            className="sync-badge"
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.25, 1] }}
            exit={{ scale: 0 }}
            transition={{ duration: 0.24 }}
          >
            {conflicts}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

/** ⋯ 菜单：回收站、同步设置 | 完成提示音、打开数据文件夹 | 版本与快捷键提示 */
function MainMenu({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState('');
  const sound = useData((s) => s.settings.sound);
  const trashCount = useData((s) => s.trash.reduce((n, e) => n + e.items.length, 0));
  const { state } = useCloud();
  const appearance = useData((s) => s.local.appearance);
  /** 「外观」子菜单：顶到哪一行 */
  const [themeAt, setThemeAt] = useState<number | null>(null);

  useEffect(() => {
    if (api) void api.version().then(setVersion);
  }, []);

  useEffect(() => {
    const onDown = (e: Event) => {
      const t = e.target as Element;
      if (!ref.current?.contains(t) && !t.closest?.('[data-main-menu]')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const mod = isMac ? '⌘' : 'Ctrl+';
  return (
    <motion.div
      ref={ref}
      className="pop"
      role="menu"
      style={{ right: 8, top: os === 'win' ? 36 : 40, width: 216 }}
      initial={{ opacity: 0, y: -4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <button
        className="mi"
        role="menuitem"
        onMouseEnter={() => setThemeAt(null)}
        onClick={() => {
          onClose();
          openTrash();
        }}
      >
        <TrashIcon />
        回收站
        <em>{trashCount || ''}</em>
      </button>
      {isElectron && (
        <button
          className="mi"
          role="menuitem"
          onMouseEnter={() => setThemeAt(null)}
          onClick={() => {
            onClose();
            useUi.getState().set({ syncOpen: true, conflictsOpen: false, menu: null });
          }}
        >
          <CloudStateIcon state={state} />
          同步设置…
          <em>{CLOUD_SHORT[state]}</em>
        </button>
      )}
      <div className="msep" />
      <button
        className={`mi ${themeAt !== null ? 'hl' : ''}`}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={themeAt !== null}
        onMouseEnter={(e) => setThemeAt(e.currentTarget.offsetTop)}
        onClick={(e) => setThemeAt(themeAt === null ? e.currentTarget.offsetTop : null)}
      >
        <ThemeIcon />
        外观
        <em>{APPEARANCE_LABEL[appearance]}</em>
        <ChevronRightIcon className="chev" />
      </button>
      <button
        className="mi"
        role="menuitemcheckbox"
        aria-checked={sound}
        onMouseEnter={() => setThemeAt(null)}
        onClick={() => useData.getState().setSettings({ sound: !sound })}
      >
        <SoundIcon />
        完成提示音
        <span className={`tg ${sound ? 'on' : ''}`} />
      </button>
      {isElectron && (
        <button
          className="mi"
          role="menuitem"
          onMouseEnter={() => setThemeAt(null)}
          onClick={() => {
            void api!.openDataDir();
            onClose();
          }}
        >
          <FolderIcon />
          打开数据文件夹
        </button>
      )}
      <div className="msep" />
      <button
        className="mi"
        role="menuitem"
        onMouseEnter={() => setThemeAt(null)}
        onClick={() => {
          onClose();
          useUi.getState().set({ keysOpen: true, menu: null });
        }}
      >
        <KeyboardIcon />
        快捷键与编辑…
      </button>
      <div className="mcap">
        FOCUS {version || ''} · {mod}1–5 切换列表
      </div>
      {themeAt !== null && (
        <div className="pop sub-pop" role="menu" style={{ top: themeAt - 6 }}>
          {(['system', 'light', 'dark'] as const).map((a) => (
            <button
              key={a}
              className="mi"
              role="menuitemradio"
              aria-checked={appearance === a}
              onClick={() => useData.getState().setAppearance(a)}
            >
              {appearance === a ? <CheckIcon /> : <span className="mi-blank" />}
              {APPEARANCE_LABEL[a]}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

export function TitleBar() {
  const [pinned, setPinned] = useState(false);
  const menuOpen = useUi((s) => s.mainMenuOpen);
  const closeMenu = () => useUi.getState().set({ mainMenuOpen: false });

  useEffect(() => {
    if (!api) return;
    void api.getAlwaysOnTop().then(setPinned);
    return api.onAlwaysOnTop(setPinned);
  }, []);

  const togglePin = async () => {
    if (api) setPinned(await api.setAlwaysOnTop(!pinned));
  };

  return (
    <header className="titlebar">
      {os === 'mac' ? (
        <span className="tb-lights" />
      ) : (
        <span className="tb-app">
          <AppGlyph />
          FOCUS
        </span>
      )}
      <div className="tb-right">
        {isElectron && <SyncCloud />}
        {isElectron && (
          <button className={`ib ${pinned ? 'pinned' : ''}`} title={pinned ? '取消置顶' : '窗口置顶'} aria-pressed={pinned} onClick={togglePin}>
            <PinIcon filled={pinned} />
          </button>
        )}
        <button
          className={`ib ${menuOpen ? 'on' : ''}`}
          data-main-menu
          title="更多"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => useUi.getState().set({ mainMenuOpen: !menuOpen, menu: null, profileMenuOpen: false })}
        >
          <MoreIcon />
        </button>
        {isElectron && os === 'win' && (
          <span className="caption">
            <button title="最小化" aria-label="最小化" onClick={() => api!.minimize()}>
              <MinimizeIcon />
            </button>
            <button className="x" title="关闭" aria-label="关闭" onClick={() => api!.close()}>
              <CloseIcon />
            </button>
          </span>
        )}
      </div>
      <AnimatePresence>{menuOpen && <MainMenu onClose={closeMenu} />}</AnimatePresence>
    </header>
  );
}
