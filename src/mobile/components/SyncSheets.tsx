// 同步设置与冲突处理（底部面板；宽屏居中成表单卡片）
import { useEffect, useMemo, useState } from 'react';
import { deviceOf, wallOf } from '../../sync/clock';
import type { Conflict, ConflictEditKind } from '../../sync/doc';
import type { SyncStatus } from '../../sync/engine';
import { CloudIcon, CloudOffIcon, SyncIcon } from '../icons';
import { haptic } from '../native';
import { useData } from '../store';
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

/** 导航栏上的同步按钮：有冲突时带角标，点开冲突面板；否则打开同步设置 */
export function SyncButton() {
  const status = useData((s) => s.syncStatus);
  const enabled = useData((s) => s.local.sync.enabled);
  const conflicts = useData((s) => s.conflicts.length);
  const st = statusOf(status, enabled);
  const Icon = status?.state === 'syncing' ? SyncIcon : st.tone === 'ok' || st.tone === 'busy' ? CloudIcon : CloudOffIcon;
  return (
    <button
      className={`glass-btn sync-btn tone-${conflicts ? 'conflict' : st.tone}`}
      aria-label={conflicts ? `有 ${conflicts} 个冲突需要决定` : st.text}
      onClick={() => useUi.getState().set({ sheet: conflicts ? 'conflicts' : 'sync' })}
    >
      <Icon className={status?.state === 'syncing' ? 'spin' : ''} />
      {conflicts > 0 && <span className="sync-badge">{conflicts}</span>}
    </button>
  );
}

function Field(props: { label: string; value: string; onChange(v: string): void; placeholder?: string; type?: string }) {
  return (
    <label className="sync-row">
      <span className="sync-row-label">{props.label}</span>
      <input
        className="sync-row-input"
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

  return (
    <Sheet open={open} wide={wide} tall title="同步" subtitle="坚果云 WebDAV" onClose={close}>
      <div className={`sync-status tone-${st.tone}`}>
        <span className="sync-status-icon">{st.tone === 'ok' || st.tone === 'busy' ? <CloudIcon /> : <CloudOffIcon />}</span>
        <div className="sync-status-main">
          <div className="sync-status-text">{st.text}</div>
          {enabled && (
            <div className="sync-status-sub">
              上次同步 {relTime(status?.lastSyncAt ?? meta.lastSyncAt, now)} · 上次上传 {relTime(status?.lastUploadAt ?? meta.lastUploadAt, now)}
            </div>
          )}
        </div>
        {enabled && (
          <button className="glass-btn small" aria-label="立即同步" onClick={() => syncNow()}>
            <SyncIcon width={18} height={18} className={status?.state === 'syncing' ? 'spin' : ''} />
          </button>
        )}
      </div>

      {join !== null ? (
        <div className="sync-join">
          <p>云端已经有 {join} 台设备的数据。这台设备上的数据怎么办？</p>
          <button className="sync-action primary" onClick={() => (setJoin(null), void enableSync('merge'))}>
            合并本机数据
          </button>
          <button className="sync-action" onClick={() => (setJoin(null), void enableSync('cloud'))}>
            以云端为准（本机数据先备份）
          </button>
          <button className="sync-action plain" onClick={() => setJoin(null)}>
            取消
          </button>
        </div>
      ) : enabled ? (
        <button className="sync-action" onClick={disableSync}>
          停止同步
        </button>
      ) : (
        <button className="sync-action primary" disabled={busy} onClick={turnOn}>
          开启同步
        </button>
      )}

      <div className="sheet-note">坚果云 WebDAV</div>
      <div className="card sync-card">
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
      <p className="sheet-note">应用密码在坚果云网页「账户信息 → 安全选项 → 第三方应用管理」生成，只保存在本机钥匙串里。文件夹不存在会自动创建。</p>
      <div className="sync-actions">
        <button className="sync-action" disabled={busy} onClick={() => void save().then((ok) => ok && setNote({ text: '已保存', tone: 'ok' }))}>
          保存
        </button>
        <button className="sync-action" disabled={busy} onClick={test}>
          测试连接
        </button>
      </div>
      {note && <p className={`sync-note tone-${note.tone}`}>{note.text}</p>}

      {enabled && (
        <>
          <div className="sheet-note">设备</div>
          <div className="card sync-card">
            <div className="sync-device">
              <span>{form.deviceName || 'iPhone'}（本机）</span>
              <span className="sync-device-time">{relTime(status?.lastUploadAt ?? meta.lastUploadAt, now)}</span>
            </div>
            {devices
              .filter((d) => d.id !== myId)
              .map((d) => (
                <div key={d.id} className="sync-device">
                  <span>{d.name}</span>
                  <span className="sync-device-time">{relTime(d.writtenAt, now)}</span>
                </div>
              ))}
          </div>
        </>
      )}

      <div className="sheet-note">调试</div>
      <div className="card sync-card">
        <label className="sync-device">
          <span>模拟离线</span>
          <input
            type="checkbox"
            className="sync-switch"
            checked={simOffline}
            onChange={(e) => {
              setSimOffline(e.target.checked);
              setSimulatedOffline(e.target.checked);
            }}
          />
        </label>
      </div>
    </Sheet>
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
  if (c.kind === 'title') {
    const opts = [...c.options].sort((a, b) => (a.t < b.t ? 1 : -1));
    return (
      <div className="conflict-card">
        <div className="conflict-head">同一条待办在两台设备上被改成了不同的标题，用哪个？</div>
        {opts.map((o) => (
          <button key={o.t} className="conflict-option" onClick={() => (haptic.light(), data.resolveTitle(c.id, o.v))}>
            <span className="conflict-option-title">{o.v}</span>
            <span className="conflict-meta">
              {name(o.t)} · {relTime(wallOf(o.t), now)}
            </span>
          </button>
        ))}
        <button className="sync-action plain" onClick={() => data.keepAllTitles(c.id, opts[0].v, opts.slice(1).map((o) => o.v))}>
          都保留（另存为几条待办）
        </button>
      </div>
    );
  }
  if (c.kind === 'delete') {
    const edits = [...new Set(c.edits.map((e) => `${name(e.t)}${EDIT_LABEL[e.what]}`))];
    return (
      <div className="conflict-card">
        <div className="conflict-head">
          「<b>{c.title || '（无标题）'}</b>」在{name(c.deletedT)}上{c.purged ? '被彻底删除' : '被删除'}（{relTime(wallOf(c.deletedT), now)}），但同时有改动：
        </div>
        <ul className="conflict-edits">
          {edits.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        <div className="sync-actions">
          <button className="sync-action primary" onClick={() => data.resolveDelete(c.id, 'restore')}>
            恢复
          </button>
          <button className="sync-action" onClick={() => data.resolveDelete(c.id, 'delete')}>
            {c.purged ? '确认彻底删除' : '保持删除'}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="conflict-card">
      <div className="conflict-head">
        空间「<b>{c.name}</b>」在{name(c.deletedT)}上被删除（{relTime(wallOf(c.deletedT), now)}），但另一台设备同时在里面改了 {c.edits} 处。
      </div>
      <div className="sync-actions">
        <button className="sync-action primary" onClick={() => data.resolveProfile(c.profileId, 'restore')}>
          恢复这个空间
        </button>
        <button className="sync-action" onClick={() => data.resolveProfile(c.profileId, 'delete')}>
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
    <Sheet open={open} wide={wide} tall title="需要你决定" subtitle={conflicts.length ? `${conflicts.length} 处冲突` : '都处理完了'} onClose={close}>
      <p className="sheet-note">多台设备同时改了同一处，自动合并不了。决定之后，其它设备上的同一个冲突也会消失。</p>
      {conflicts.map((c) => (
        <ConflictCard key={`${c.kind}:${c.kind === 'profile' ? c.profileId : c.id}`} c={c} now={now} />
      ))}
    </Sheet>
  );
}
