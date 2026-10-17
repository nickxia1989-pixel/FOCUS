// 同步设置与冲突处理（底部面板；宽屏居中成表单卡片）
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { deviceOf, wallOf } from '../../sync/clock';
import type { Conflict, ConflictEditKind } from '../../sync/doc';
import type { SyncStatus } from '../../sync/engine';
import { CloudDashedIcon, CloudErrorIcon, CloudIcon, CloudOffIcon, LaptopIcon, PhoneIcon, SyncIcon } from '../icons';
import { haptic } from '../native';
import { activeOf, useData } from '../store';
import {
  checkConnection,
  disableSync,
  enableSync,
  isSimulatedOffline,
  loadConfig,
  probeCloud,
  saveConfig,
  setSimulatedOffline,
  syncNow,
} from '../sync';
import { useUi } from '../ui';
import { Sheet } from './Sheets';

export function relTime(t: number | null | undefined, now: number) {
  if (!t) return '从未';
  const d = now - t;
  if (d < 10_000) return '刚刚';
  if (d < 60_000) return `${Math.floor(d / 1000)} 秒前`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`;
  return `${Math.floor(d / 86_400_000)} 天前`;
}

export function statusOf(s: SyncStatus | null, enabled: boolean): { text: string; tone: 'ok' | 'busy' | 'warn' | 'bad' | 'off' } {
  if (!enabled || !s || s.state === 'off') return { text: '未开启同步', tone: 'off' };
  switch (s.state) {
    case 'syncing':
      return { text: '正在同步…', tone: 'busy' };
    case 'offline':
      return { text: '离线：改动已保存在本机，联网后自动上传', tone: 'warn' };
    case 'ratelimit':
      return { text: '坚果云限流，稍后自动重试', tone: 'warn' };
    case 'auth':
      return { text: s.message ?? '账号或应用密码不对', tone: 'bad' };
    case 'error':
      return { text: s.message ?? '同步出错，稍后自动重试', tone: 'bad' };
    default:
      return { text: s.pending ? '有改动等待上传' : '已同步', tone: 'ok' };
  }
}

/** 云朵在各种同步状态下的样子 */
export function SyncGlyph({ state, enabled, spin }: { state?: string; enabled: boolean; spin?: boolean }) {
  if (!enabled || !state || state === 'off') return <CloudDashedIcon />;
  if (state === 'syncing') return <SyncIcon className={spin ? 'spin' : ''} />;
  if (state === 'offline' || state === 'ratelimit') return <CloudOffIcon />;
  if (state === 'auth' || state === 'error') return <CloudErrorIcon />;
  return <CloudIcon />;
}

/** 网页自己画导航时，玻璃胶囊里的云朵：有冲突时带红色角标，点开冲突面板；否则打开同步设置 */
export function SyncButton() {
  const status = useData((s) => s.syncStatus);
  const enabled = useData((s) => s.local.sync.enabled);
  const conflicts = useData((s) => s.conflicts.length);
  const st = statusOf(status, enabled);
  return (
    <button
      className={`sync-btn tone-${conflicts ? 'conflict' : st.tone}`}
      aria-label={conflicts ? `有 ${conflicts} 个冲突需要决定` : st.text}
      onClick={() => useUi.getState().set({ sheet: conflicts ? 'conflicts' : 'sync' })}
    >
      <SyncGlyph state={status?.state} enabled={enabled} spin />
      {conflicts > 0 && <span className="sync-badge">{conflicts}</span>}
    </button>
  );
}

function Field(props: { label: string; value: string; onChange(v: string): void; placeholder?: string; type?: string }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type={props.type ?? 'text'}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
      />
    </label>
  );
}

export function SyncSheet({ wide }: { wide: boolean }) {
  const open = useUi((s) => s.sheet === 'sync');
  const status = useData((s) => s.syncStatus);
  const enabled = useData((s) => s.local.sync.enabled);
  const meta = useData((s) => s.local.sync.meta);
  const myId = useData((s) => s.clock.deviceId);
  const [form, setForm] = useState({ baseUrl: '', user: '', password: '', folder: '', deviceName: '' });
  const [hasPassword, setHasPassword] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [join, setJoin] = useState<number | null>(null);
  const [simOffline, setSimOffline] = useState(isSimulatedOffline);
  const [now, setNow] = useState(() => Date.now());
  const close = () => useUi.getState().set({ sheet: null });

  useEffect(() => {
    if (!open) return;
    setNote(null);
    void loadConfig().then((c) => {
      setForm({ baseUrl: c.baseUrl, user: c.user, password: '', folder: c.folder, deviceName: c.deviceName });
      setHasPassword(c.hasPassword);
    });
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [open]);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const r = await saveConfig({ ...form, ...(form.password ? { password: form.password } : { password: undefined }) });
    if (!r.ok) {
      setNote({ text: r.message ?? '保存失败', tone: 'bad' });
      return false;
    }
    const c = await loadConfig();
    setHasPassword(c.hasPassword);
    setForm((f) => ({ ...f, password: '' }));
    return true;
  };

  const test = async () => {
    setBusy(true);
    setNote(null);
    try {
      if (!(await save())) return;
      const r = await checkConnection();
      setNote('error' in r ? { text: `连接失败：${r.error.message}`, tone: 'bad' } : { text: '连接成功', tone: 'ok' });
    } finally {
      setBusy(false);
    }
  };

  const turnOn = async () => {
    setBusy(true);
    setNote(null);
    try {
      if (!(await save())) return;
      const c = await loadConfig();
      if (!c.user || !c.hasPassword) {
        setNote({ text: '请先填写账号和应用密码', tone: 'bad' });
        return;
      }
      const probe = await probeCloud();
      if ('error' in probe) {
        setNote({ text: `连接失败：${probe.error.message}`, tone: 'bad' });
        return;
      }
      haptic.success();
      if (probe.devices.length && !useData.getState().local.pristine) setJoin(probe.devices.length);
      else await enableSync(probe.devices.length ? 'cloud' : 'merge');
    } finally {
      setBusy(false);
    }
  };

  const st = statusOf(status, enabled);
  const devices = useMemo(() => Object.values(meta.devices).sort((a, b) => b.writtenAt - a.writtenAt), [meta.devices]);
  const head = { ok: '已同步', busy: '正在同步', warn: '离线', bad: '同步出错', off: '未开启同步' }[st.tone];

  return (
    <Sheet open={open} wide={wide} tall title="同步" subtitle="坚果云 WebDAV" onClose={close}>
      <div className="ss">
        <span className={`ss-ic tone-${st.tone}`}>
          <SyncGlyph state={status?.state} enabled={enabled} spin />
        </span>
        <div className="ss-main">
          <b>{head}</b>
          <span>
            {enabled
              ? `${relTime(status?.lastSyncAt ?? meta.lastSyncAt, now)} · 前台每 15 秒检查`
              : st.text}
          </span>
        </div>
        {enabled ? (
          <button className="btn pri sm" onClick={() => syncNow()}>
            立即同步
          </button>
        ) : (
          <button className="btn lime sm" disabled={busy} onClick={turnOn}>
            开启同步
          </button>
        )}
      </div>

      <div className="scard">
        <Field label="服务器" value={form.baseUrl} onChange={set('baseUrl')} placeholder="https://dav.jianguoyun.com/dav/" />
        <Field label="账号" value={form.user} onChange={set('user')} placeholder="坚果云账号（邮箱）" />
        <Field
          label="应用密码"
          type="password"
          value={form.password}
          onChange={set('password')}
          placeholder={hasPassword ? '已保存（留空则不修改）' : '坚果云网页生成'}
        />
        <Field label="文件夹" value={form.folder} onChange={set('folder')} placeholder="FOCUS" />
        <Field label="本机名称" value={form.deviceName} onChange={set('deviceName')} placeholder="iPhone" />
      </div>
      <p className="note">应用密码在坚果云网页「账户信息 → 安全选项 → 第三方应用管理」生成，只保存在本机钥匙串里。文件夹不存在会自动创建。</p>
      <div className="row-btns">
        <button className="btn sm" disabled={busy} onClick={() => void save().then((ok) => ok && setNote({ text: '已保存', tone: 'ok' }))}>
          保存
        </button>
        <button className="btn sm" disabled={busy} onClick={test}>
          测试连接
        </button>
      </div>
      {note && <p className={`sync-note tone-${note.tone}`}>{note.text}</p>}

      {enabled && (
        <>
          <div className="scard">
            <div className="li">
              <PhoneIcon className="ic" />
              <div className="li-main">
                <b>{form.deviceName || 'iPhone'}（本机）</b>
              </div>
              <em>{relTime(status?.lastUploadAt ?? meta.lastUploadAt, now)}</em>
            </div>
            {devices
              .filter((d) => d.id !== myId)
              .map((d) => (
                <div key={d.id} className="li">
                  <LaptopIcon className="ic" />
                  <div className="li-main">
                    <b>{d.name}</b>
                  </div>
                  <em>{relTime(d.writtenAt, now)}</em>
                </div>
              ))}
          </div>
          <button className="btn bad" onClick={disableSync}>
            关闭同步
          </button>
        </>
      )}

      <div className="scard">
        <label className="li">
          <div className="li-main">
            <b>模拟离线</b>
            <small>调试用：所有请求当作断网</small>
          </div>
          <input
            type="checkbox"
            hidden
            checked={simOffline}
            onChange={(e) => {
              setSimOffline(e.target.checked);
              setSimulatedOffline(e.target.checked);
            }}
          />
          <span className={`tg ${simOffline ? 'on' : ''}`} aria-hidden />
        </label>
      </div>

      <JoinAlert
        count={join}
        onCancel={() => setJoin(null)}
        onPick={(mode) => {
          setJoin(null);
          void enableSync(mode);
        }}
      />
    </Sheet>
  );
}

/** 首次加入云端：云端已经有别的设备的数据，这台设备上的数据怎么办（P15） */
function JoinAlert({ count, onCancel, onPick }: { count: number | null; onCancel(): void; onPick(mode: 'merge' | 'cloud'): void }) {
  const [mode, setMode] = useState<'merge' | 'cloud'>('merge');
  const local = useData((s) => activeOf(s)?.todos.filter((t) => !t.done).length ?? 0);
  return (
    <AnimatePresence>
      {count !== null && (
        <motion.div
          className="alert-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="sheet-scrim" onClick={onCancel} />
          <motion.div
            className="alert"
            role="alertdialog"
            initial={{ scale: 0.94 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            <h3>云端已经有 {count} 台设备的数据</h3>
            <p>这台 iPhone 上已有 {local} 条待办。开启同步前，先决定它们怎么办：</p>
            <button className={`ch ${mode === 'merge' ? 'sel' : ''}`} onClick={() => setMode('merge')}>
              <b>
                合并本机数据<em>推荐</em>
              </b>
              <span>两边都保留，之后每条按标题、完成状态、位置分开合并。</span>
            </button>
            <button className={`ch ${mode === 'cloud' ? 'sel' : ''}`} onClick={() => setMode('cloud')}>
              <b>以云端为准</b>
              <span>本机数据先备份一份，再换成云端的。</span>
            </button>
            <div className="alert-btns">
              <button className="btn" onClick={onCancel}>
                取消
              </button>
              <button className="btn pri" onClick={() => onPick(mode)}>
                继续
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------- 冲突 ----------

const EDIT_LABEL: Record<ConflictEditKind, string> = {
  title: '改了标题',
  status: '改了完成 / 待测状态',
  pos: '移动了位置',
  order: '调整了排序',
  child: '在它下面加了或改了子项',
};

function useDeviceName() {
  const me = useData((s) => s.clock.deviceId);
  const devices = useData((s) => s.local.sync.meta.devices);
  return (t: string) => {
    const id = deviceOf(t);
    if (id === me) return '这台设备';
    return devices[id]?.name ?? `设备 ${id.slice(0, 4)}`;
  };
}

function ConflictCard({ c, now }: { c: Conflict; now: number }) {
  const name = useDeviceName();
  const data = useData.getState();
  const opts = c.kind === 'title' ? [...c.options].sort((a, b) => (a.t < b.t ? 1 : -1)) : [];
  const [sel, setSel] = useState(0);
  if (c.kind === 'title') {
    return (
      <div className="cf">
        <span className="cf-q">标题被改成了两样，用哪个？</span>
        {opts.map((o, i) => (
          <button key={o.t} className={`opt ${sel === i ? 'sel' : ''}`} onClick={() => setSel(i)}>
            <span className="r" />
            <span>
              <small>
                {name(o.t)} · {relTime(wallOf(o.t), now)}
              </small>
              {o.v}
            </span>
          </button>
        ))}
        <div className="row-btns">
          <button className="btn pri sm" onClick={() => (haptic.light(), data.resolveTitle(c.id, opts[sel].v))}>
            用选中的
          </button>
          <button
            className="btn sm"
            onClick={() => data.keepAllTitles(c.id, opts[sel].v, opts.filter((_, i) => i !== sel).map((o) => o.v))}
          >
            都保留
          </button>
        </div>
      </div>
    );
  }
  if (c.kind === 'delete') {
    const edits = [...new Set(c.edits.map((e) => `${name(e.t)}${EDIT_LABEL[e.what]}`))];
    return (
      <div className="cf">
        <span>
          「{c.title || '（无标题）'}」在{name(c.deletedT)}上{c.purged ? '被彻底删除' : '被删除'}（{relTime(wallOf(c.deletedT), now)}），
          但同时有改动：
        </span>
        <ul>
          {edits.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        <div className="row-btns">
          <button className="btn pri sm" onClick={() => data.resolveDelete(c.id, 'restore')}>
            恢复
          </button>
          <button className="btn sm" onClick={() => data.resolveDelete(c.id, 'delete')}>
            {c.purged ? '确认彻底删除' : '保持删除（留在回收站）'}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="cf">
      <span>
        空间「{c.name}」在{name(c.deletedT)}上被删除（{relTime(wallOf(c.deletedT), now)}），但另一台设备同时在里面改了 {c.edits} 处。
      </span>
      <div className="row-btns">
        <button className="btn pri sm" onClick={() => data.resolveProfile(c.profileId, 'restore')}>
          恢复空间
        </button>
        <button className="btn conf sm" onClick={() => data.resolveProfile(c.profileId, 'delete')}>
          确认删除
        </button>
      </div>
    </div>
  );
}

export function ConflictSheet({ wide }: { wide: boolean }) {
  const open = useUi((s) => s.sheet === 'conflicts');
  const conflicts = useData((s) => s.conflicts);
  const [now, setNow] = useState(() => Date.now());
  const close = () => useUi.getState().set({ sheet: null });
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [open]);
  useEffect(() => {
    if (open && conflicts.length === 0) {
      const t = setTimeout(close, 600);
      return () => clearTimeout(t);
    }
  }, [open, conflicts.length]);
  return (
    <Sheet
      open={open}
      wide={wide}
      tall
      title={conflicts.length ? `${conflicts.length} 个冲突` : '都处理完了'}
      onClose={close}
      right={
        <button className="text-btn" style={{ marginLeft: 'auto' }} onClick={close}>
          稍后处理
        </button>
      }
    >
      <p className="note">两台设备同时改了同一处，在这里决定后，另一台上的同一个冲突会自动消失。</p>
      {conflicts.map((c) => (
        <ConflictCard key={`${c.kind}:${c.kind === 'profile' ? c.profileId : c.id}`} c={c} now={now} />
      ))}
    </Sheet>
  );
}
