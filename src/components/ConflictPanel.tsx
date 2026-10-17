import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useData, useUi } from '../store';
import { enableSync } from '../syncDesktop';
import { deviceOf, wallOf } from '../sync/clock';
import type { Conflict, ConflictEditKind } from '../sync/doc';
import { BackIcon } from './icons';
import { relTime } from './SyncPanel';

const EASE = [0.2, 0.8, 0.2, 1] as const;

const EDIT_LABEL: Record<ConflictEditKind, string> = {
  title: '改了标题',
  status: '改了完成 / 待验证状态',
  pos: '移动了位置',
  order: '调整了排序',
  child: '在它下面加了或改了子项',
};

/** 中文句子里夹英文设备名时两边留空格（「在 iPhone 17 Pro 上」） */
const spaced = (name: string) => `${/^[\x21-\x7e]/.test(name) ? ' ' : ''}${name}${/[\x21-\x7e]$/.test(name) ? ' ' : ''}`;

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
  const [sel, setSel] = useState(0);
  const pick = opts[Math.min(sel, opts.length - 1)];
  return (
    <>
      <div className="q">
        <b>标题被改成了{opts.length > 2 ? '几' : '两'}样</b>，用哪个？
      </div>
      {opts.map((o, i) => (
        <button key={o.t} className={`opt ${i === sel ? 'sel' : ''}`} role="radio" aria-checked={i === sel} onClick={() => setSel(i)}>
          <span className="r" />
          <span>
            <small>
              {name(o.t)} · {relTime(wallOf(o.t), now)}
            </small>
            {o.v}
          </span>
        </button>
      ))}
      <div className="a">
        <button className="btn pri" onClick={() => useData.getState().resolveTitle(c.id, pick.v)}>
          用选中的
        </button>
        <button
          className="btn"
          title="另存为几条待办"
          onClick={() =>
            useData.getState().keepAllTitles(
              c.id,
              pick.v,
              opts.filter((o) => o !== pick).map((o) => o.v),
            )
          }
        >
          {opts.length > 2 ? '都保留' : '两个都保留'}
        </button>
      </div>
    </>
  );
}

function DeleteCard({ c }: { c: Extract<Conflict, { kind: 'delete' }> }) {
  const name = useDeviceName();
  const edits = [...new Set(c.edits.map((e) => `${spaced(name(e.t)).trimStart()}同时${EDIT_LABEL[e.what]}`))];
  return (
    <>
      <div className="q">
        「<b>{c.title || '（无标题）'}</b>」在{spaced(name(c.deletedT))}上{c.purged ? '被彻底删除' : '被删除'}，{edits.join('；')}。
      </div>
      <div className="a">
        <button className="btn pri" onClick={() => useData.getState().resolveDelete(c.id, 'restore')}>
          恢复
        </button>
        <button className={`btn ${c.purged ? 'conf' : ''}`} onClick={() => useData.getState().resolveDelete(c.id, 'delete')}>
          {c.purged ? '确认彻底删除' : '保持删除（留在回收站）'}
        </button>
      </div>
    </>
  );
}

function ProfileCard({ c }: { c: Extract<Conflict, { kind: 'profile' }> }) {
  const name = useDeviceName();
  return (
    <>
      <div className="q">
        空间「<b>{c.name}</b>」在{spaced(name(c.deletedT))}上被删除，但同时有设备在里面改过 {c.edits} 处。
      </div>
      <div className="a">
        <button className="btn pri" onClick={() => useData.getState().resolveProfile(c.profileId, 'restore')}>
          恢复空间
        </button>
        <button className="btn conf" onClick={() => useData.getState().resolveProfile(c.profileId, 'delete')}>
          确认删除
        </button>
      </div>
    </>
  );
}

/** 冲突决定面板：发现新冲突时自动弹出，也可以点标题栏的云朵打开 */
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
      className="sheet"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6, transition: { duration: 0.12 } }}
      transition={{ duration: 0.22, ease: EASE }}
    >
      <header className="shh">
        <button className="bk" title="稍后处理（Esc）" aria-label="返回" onClick={close}>
          <BackIcon />
        </button>
        <b>{conflicts.length ? `${conflicts.length} 个冲突` : '都处理完了'}</b>
        <button className="later" onClick={close}>
          稍后处理（Esc）
        </button>
      </header>
      <div className="shb">
        <p className="cap2" style={{ marginTop: -2 }}>
          多台设备同时改了同一处，自动合并不了。在任何一台上做了决定，其它设备上的同一个冲突会自动消失。
        </p>
        <AnimatePresence initial={false}>
          {conflicts.map((c) => (
            <motion.div
              key={`${c.kind}:${c.kind === 'profile' ? c.profileId : c.id}`}
              layout="position"
              className="card cf"
              exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18 } }}
            >
              {c.kind !== 'profile' && profiles.length > 1 && <span className="pname">{profileName(c.profileId)}</span>}
              {c.kind === 'title' ? <TitleCard c={c} now={now} /> : c.kind === 'delete' ? <DeleteCard c={c} /> : <ProfileCard c={c} />}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}

export function ConflictPanel() {
  const open = useUi((s) => s.conflictsOpen);
  return <AnimatePresence>{open && <ConflictSheet />}</AnimatePresence>;
}

/** 第一次加入已有数据的云端：合并本机数据（推荐），或以云端为准（本机先备份） */
function JoinCard() {
  // 离场动画期间 ui.join 已经清空，用打开时的那份
  const [join] = useState(() => useUi.getState().join ?? { devices: 0, local: 0 });
  const [choice, setChoice] = useState<'merge' | 'cloud'>('merge');
  const [busy, setBusy] = useState(false);
  const cancel = () => useUi.getState().set({ join: null });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = async () => {
    setBusy(true);
    try {
      await enableSync(choice);
    } finally {
      useUi.getState().set({ join: null });
    }
  };

  return (
    <>
      <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={cancel} />
      <motion.div
        className="modal"
        role="dialog"
        aria-modal
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, transition: { duration: 0.12 } }}
        transition={{ duration: 0.24, ease: EASE }}
      >
        <h3>云端已经有 {join.devices} 台设备的数据</h3>
        <p>这台电脑上已有 {join.local} 条待办。开启同步前，先决定它们怎么办：</p>
        <button className={`ch ${choice === 'merge' ? 'sel' : ''}`} onClick={() => setChoice('merge')}>
          <b>
            合并本机数据<em>推荐</em>
          </b>
          <span>两边的待办都保留，之后每条按标题、完成状态、位置分开合并。</span>
        </button>
        <button className={`ch ${choice === 'cloud' ? 'sel' : ''}`} onClick={() => setChoice('cloud')}>
          <b>以云端为准</b>
          <span>本机数据先在数据文件夹里备份成 focus-doc.backup-….json，再换成云端的。</span>
        </button>
        <div className="a">
          <button className="btn" onClick={cancel}>
            取消
          </button>
          <button className="btn pri" disabled={busy} onClick={go}>
            继续
          </button>
        </div>
      </motion.div>
    </>
  );
}

export function JoinModal() {
  const open = useUi((s) => !!s.join);
  return <AnimatePresence>{open && <JoinCard key="join" />}</AnimatePresence>;
}
