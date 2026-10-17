import { useEffect, useRef, useState } from 'react';
import { api, isElectron, isMac } from '../platform';
import { useData, useUi } from '../store';
import { CheckIcon, CloseIcon, CloudIcon, CloudOffIcon, MinimizeIcon, MoreIcon, PinIcon, SyncIcon, TrashIcon } from './icons';
import { statusText } from './SyncPanel';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function useToday() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** 标题栏上的同步状态：有冲突时显示角标，点开冲突面板；否则点开同步设置 */
function SyncIndicator() {
  const status = useData((s) => s.syncStatus);
  const enabled = useData((s) => s.local.sync.enabled);
  const conflicts = useData((s) => s.conflicts.length);
  const st = statusText(status, enabled);
  const Icon = status?.state === 'syncing' ? SyncIcon : st.tone === 'warn' || st.tone === 'bad' || st.tone === 'off' ? CloudOffIcon : CloudIcon;
  return (
    <button
      className={`tb-btn sync-indicator tone-${conflicts ? 'conflict' : st.tone}`}
      title={conflicts ? `有 ${conflicts} 个冲突需要你决定` : st.text}
      onClick={() => useUi.getState().set(conflicts ? { conflictsOpen: true, syncOpen: false } : { syncOpen: true, conflictsOpen: false })}
    >
      <Icon className={status?.state === 'syncing' ? 'spin' : ''} />
      {conflicts > 0 && <span className="sync-badge">{conflicts}</span>}
    </button>
  );
}

export function TitleBar() {
  const now = useToday();
  const [pinned, setPinned] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [version, setVersion] = useState('');
  const sound = useData((s) => s.settings.sound);
  const trashCount = useData((s) => s.trash.reduce((n, e) => n + e.items.length, 0));
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!api) return;
    void api.getAlwaysOnTop().then(setPinned);
    void api.version().then(setVersion);
    return api.onAlwaysOnTop(setPinned);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    const onBlur = () => setMenuOpen(false);
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [menuOpen]);

  const togglePin = async () => {
    if (api) setPinned(await api.setAlwaysOnTop(!pinned));
  };

  return (
    <header className="titlebar">
      <div className="titlebar-date">
        <span className="date-day">{now.getDate()}</span>
        <span className="date-rest">
          {now.getMonth() + 1}月 · 周{WEEK[now.getDay()]}
        </span>
      </div>
      <div className="titlebar-actions">
        {isElectron && <SyncIndicator />}
        {isElectron && (
          <button
            className={`tb-btn ${pinned ? 'is-on' : ''}`}
            title={pinned ? '取消置顶' : '窗口置顶'}
            onClick={togglePin}
          >
            <PinIcon />
          </button>
        )}
        <div className="tb-menu-wrap" ref={menuRef}>
          <button className={`tb-btn ${menuOpen ? 'is-open' : ''}`} title="设置" onClick={() => setMenuOpen((v) => !v)}>
            <MoreIcon />
          </button>
          {menuOpen && (
            <div className="menu tb-menu" role="menu">
              <button
                className="menu-item"
                onClick={() => {
                  useUi.getState().set({ trashOpen: true, menu: null, profileMenuOpen: false, editingId: null, addingChildOf: null });
                  setMenuOpen(false);
                }}
              >
                <span className="menu-check">
                  <TrashIcon />
                </span>
                回收站
                {trashCount > 0 && <span className="menu-badge">{trashCount}</span>}
              </button>
              {isElectron && (
                <button
                  className="menu-item"
                  onClick={() => {
                    useUi.getState().set({ syncOpen: true, trashOpen: false, conflictsOpen: false, menu: null });
                    setMenuOpen(false);
                  }}
                >
                  <span className="menu-check">
                    <CloudIcon />
                  </span>
                  同步设置…
                </button>
              )}
              <div className="menu-sep" />
              <button
                className="menu-item"
                role="menuitemcheckbox"
                aria-checked={sound}
                onClick={() => useData.getState().setSettings({ sound: !sound })}
              >
                <span className="menu-check">{sound && <CheckIcon />}</span>
                完成提示音
              </button>
              {isElectron && (
                <button
                  className="menu-item"
                  onClick={() => {
                    void api!.openDataDir();
                    setMenuOpen(false);
                  }}
                >
                  <span className="menu-check" />
                  打开数据文件夹
                </button>
              )}
              <div className="menu-sep" />
              <div className="menu-note">FOCUS {version && `v${version}`}</div>
            </div>
          )}
        </div>
        {isElectron && !isMac && (
          <>
            <button className="tb-btn" title="最小化" onClick={() => api!.minimize()}>
              <MinimizeIcon />
            </button>
            <button className="tb-btn tb-close" title="关闭" onClick={() => api!.close()}>
              <CloseIcon />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
