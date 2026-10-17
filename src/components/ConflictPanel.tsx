import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useData, useUi } from '../store';
import { deviceOf, wallOf } from '../sync/clock';
import type { Conflict, ConflictEditKind } from '../sync/doc';
import { AlertIcon, BackIcon } from './icons';
import { relTime } from './SyncPanel';

const EDIT_LABEL: Record<ConflictEditKind, string> = {
  title: '改了标题',
  status: '改了完成 / 待测状态',
  pos: '移动了位置',
  order: '调整了排序',
  child: '在它下面加了或改了子项',
};

/** 设备 id → 名字：本机、同步时记下的设备名，都没有就用 id */
function useDeviceName() {
  const me = useData((s) => s.clock.deviceId);
  const devices = useData((s) => s.local.sync.meta.devices);
  return (t: string) => {
    const id = deviceOf(t);
    if (id === me) return '这台设备';
    return devices[id]?.name ?? `设备 ${id.slice(0, 4)}`;
  };
}

function TitleCard({ c, now }: { c: Extract<Conflict, { kind: 'title' }>; now: number }) {
  const name = useDeviceName();
  const opts = [...c.options].sort((a, b) => (a.t < b.t ? 1 : -1));
  return (
    <div className="conflict-card">
      <div className="conflict-head">同一条待办在两台设备上被改成了不同的标题，用哪个？</div>
      <div className="conflict-options">
        {opts.map((o) => (
          <button key={o.t} className="conflict-option" onClick={() => useData.getState().resolveTitle(c.id, o.v)}>
            <span className="conflict-option-title">{o.v}</span>
            <span className="conflict-meta">
              {name(o.t)} · {relTime(wallOf(o.t), now)}
            </span>
          </button>
        ))}
      </div>
      <button
        className="sync-btn ghost conflict-both"
        onClick={() =>
          useData.getState().keepAllTitles(
            c.id,
            opts[0].v,
            opts.slice(1).map((o) => o.v),
          )
        }
      >
        都保留（另存为几条待办）
      </button>
    </div>
  );
}

function DeleteCard({ c, now }: { c: Extract<Conflict, { kind: 'delete' }>; now: number }) {
  const name = useDeviceName();
  const edits = [...new Set(c.edits.map((e) => `${name(e.t)}${EDIT_LABEL[e.what]}`))];
  return (
    <div className="conflict-card">
      <div className="conflict-head">
        「<b>{c.title || '（无标题）'}</b>」在{name(c.deletedT)}上{c.purged ? '被彻底删除' : '被删除'}（{relTime(wallOf(c.deletedT), now)}），
        但同时有改动：
      </div>
      <ul className="conflict-edits">
        {edits.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      <div className="conflict-actions">
        <button className="sync-btn primary" onClick={() => useData.getState().resolveDelete(c.id, 'restore')}>
          恢复
        </button>
        <button className="sync-btn" onClick={() => useData.getState().resolveDelete(c.id, 'delete')}>
          {c.purged ? '确认彻底删除' : '保持删除（留在回收站）'}
        </button>
      </div>
    </div>
  );
}

function ProfileCard({ c, now }: { c: Extract<Conflict, { kind: 'profile' }>; now: number }) {
  const name = useDeviceName();
  return (
    <div className="conflict-card">
      <div className="conflict-head">
        Profile「<b>{c.name}</b>」在{name(c.deletedT)}上被删除（{relTime(wallOf(c.deletedT), now)}），但另一台设备同时在里面改了 {c.edits} 处。
      </div>
      <div className="conflict-actions">
        <button className="sync-btn primary" onClick={() => useData.getState().resolveProfile(c.profileId, 'restore')}>
          恢复这个 profile
        </button>
        <button className="sync-btn" onClick={() => useData.getState().resolveProfile(c.profileId, 'delete')}>
          确认删除
        </button>
      </div>
    </div>
  );
}

function ConflictSheet() {
  const conflicts = useData((s) => s.conflicts);
  const profiles = useData((s) => s.profiles);
  const [now, setNow] = useState(() => Date.now());
  const close = () => useUi.getState().set({ conflictsOpen: false });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // 全部处理完就自己收起
  useEffect(() => {
    if (conflicts.length === 0) {
      const t = setTimeout(close, 600);
      return () => clearTimeout(t);
    }
  }, [conflicts.length]);

  const profileName = (id: string) => profiles.find((p) => p.id === id)?.name ?? '';

  return (
    <motion.section
      className="trash conflict-panel"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 420, damping: 42 }}
    >
      <header className="trash-head">
        <button className="tb-btn" title="稍后处理（Esc）" onClick={close}>
          <BackIcon />
        </button>
        <div className="trash-title">
          需要你决定
          {conflicts.length > 0 && <span className="trash-count conflict-count">{conflicts.length}</span>}
        </div>
      </header>
      <p className="trash-note">多台设备同时改了同一处，自动合并不了。决定之后，其它设备上的同一个冲突也会消失。</p>
      <div className="trash-scroll">
        {conflicts.length === 0 ? (
          <div className="empty">
            <AlertIcon className="empty-icon" width={34} height={34} />
            <p>都处理完了。</p>
          </div>
        ) : (
          conflicts.map((c) => (
            <div key={`${c.kind}:${c.kind === 'profile' ? c.profileId : c.id}`}>
              {c.kind !== 'profile' && profiles.length > 1 && <div className="conflict-profile">{profileName(c.profileId)}</div>}
              {c.kind === 'title' ? <TitleCard c={c} now={now} /> : c.kind === 'delete' ? <DeleteCard c={c} now={now} /> : <ProfileCard c={c} now={now} />}
            </div>
          ))
        )}
      </div>
    </motion.section>
  );
}

/** 冲突处理面板：发现新冲突时自动弹出，也可以从标题栏的同步图标打开 */
export function ConflictPanel() {
  const open = useUi((s) => s.conflictsOpen);
  return <AnimatePresence>{open && <ConflictSheet />}</AnimatePresence>;
}
