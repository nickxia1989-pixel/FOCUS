import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import type { SyncConfigView } from '../platform';
import { useData, useUi } from '../store';
import type { SyncStatus } from '../sync/engine';
import {
  checkConnection,
  disableSync,
  enableSync,
  isSimulatedOffline,
  loadSyncConfig,
  probeCloud,
  saveSyncConfig,
  setSimulatedOffline,
  syncNow,
} from '../syncDesktop';
import { BackIcon, CloudIcon, CloudOffIcon, SyncIcon } from './icons';

export function relTime(t: number | null | undefined, now: number) {
  if (!t) return '从未';
  const d = now - t;
  if (d < 10_000) return '刚刚';
  if (d < 60_000) return `${Math.floor(d / 1000)} 秒前`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`;
  return `${Math.floor(d / 86_400_000)} 天前`;
}

export function statusText(s: SyncStatus | null, enabled: boolean): { text: string; tone: 'ok' | 'busy' | 'warn' | 'bad' | 'off' } {
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

function Field(props: {
  label: string;
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="sync-field">
      <span className="sync-label">{props.label}</span>
      <input
        className="sync-input"
        type={props.type ?? 'text'}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      {props.hint && <span className="sync-hint">{props.hint}</span>}
    </label>
  );
}

function SyncSheet() {
  const status = useData((s) => s.syncStatus);
  const enabled = useData((s) => s.local.sync.enabled);
  const meta = useData((s) => s.local.sync.meta);
  const myId = useData((s) => s.clock.deviceId);
  const [cfg, setCfg] = useState<SyncConfigView | null>(null);
  const [form, setForm] = useState({ baseUrl: '', user: '', password: '', folder: '', deviceName: '' });
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [join, setJoin] = useState<number | null>(null);
  const [simOffline, setSimOffline] = useState(isSimulatedOffline);
  const [now, setNow] = useState(() => Date.now());
  const close = () => useUi.getState().set({ syncOpen: false });

  useEffect(() => {
    void loadSyncConfig().then((c) => {
      if (!c) return;
      setCfg(c);
      setForm({ baseUrl: c.baseUrl, user: c.user, password: '', folder: c.folder, deviceName: c.deviceName });
    });
    const t = setInterval(() => setNow(Date.now()), 5000);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  /** 保存表单；密码留空表示不修改 */
  const save = async () => {
    const r = await saveSyncConfig({
      baseUrl: form.baseUrl,
      user: form.user,
      folder: form.folder,
      deviceName: form.deviceName,
      ...(form.password ? { password: form.password } : {}),
    });
    if (!r.ok) {
      setNote({ text: r.message ?? '保存失败', tone: 'bad' });
      return false;
    }
    setForm((f) => ({ ...f, password: '' }));
    setCfg(await loadSyncConfig());
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
      const c = await loadSyncConfig();
      if (!c?.hasPassword || !c.user) {
        setNote({ text: '请先填写账号和应用密码', tone: 'bad' });
        return;
      }
      const probe = await probeCloud();
      if ('error' in probe) {
        setNote({ text: `连接失败：${probe.error.message}`, tone: 'bad' });
        return;
      }
      // 云端已有别的设备：本机还只是上手示例就直接以云端为准，否则问一下
      if (probe.devices.length && !useData.getState().local.pristine) setJoin(probe.devices.length);
      else await enableSync(probe.devices.length ? 'cloud' : 'merge');
    } finally {
      setBusy(false);
    }
  };

  const st = statusText(status, enabled);
  const devices = useMemo(
    () => Object.values(meta.devices).sort((a, b) => b.writtenAt - a.writtenAt),
    [meta.devices],
  );

  return (
    <motion.section
      className="trash sync-panel"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 420, damping: 42 }}
    >
      <header className="trash-head">
        <button className="tb-btn" title="返回（Esc）" onClick={close}>
          <BackIcon />
        </button>
        <div className="trash-title">同步</div>
      </header>
      <div className="trash-scroll sync-scroll">
        <div className={`sync-status tone-${st.tone}`}>
          <span className="sync-status-icon">{st.tone === 'off' || st.tone === 'warn' ? <CloudOffIcon /> : <CloudIcon />}</span>
          <div className="sync-status-main">
            <div className="sync-status-text">{st.text}</div>
            {enabled && (
              <div className="sync-status-sub">
                上次同步 {relTime(status?.lastSyncAt ?? meta.lastSyncAt, now)} · 上次上传 {relTime(status?.lastUploadAt ?? meta.lastUploadAt, now)}
              </div>
            )}
          </div>
          {enabled && (
            <button className="sync-icon-btn" title="立即同步" onClick={syncNow}>
              <SyncIcon className={status?.state === 'syncing' ? 'spin' : ''} />
            </button>
          )}
        </div>

        {join !== null ? (
          <div className="sync-join">
            <p>云端已经有 {join} 台设备的数据。这台电脑上的数据怎么办？</p>
            <button
              className="sync-btn primary"
              onClick={async () => {
                setJoin(null);
                await enableSync('merge');
              }}
            >
              合并本机数据
            </button>
            <button
              className="sync-btn"
              onClick={async () => {
                setJoin(null);
                await enableSync('cloud');
              }}
            >
              以云端为准（本机数据先备份）
            </button>
            <button className="sync-btn ghost" onClick={() => setJoin(null)}>
              取消
            </button>
          </div>
        ) : (
          <div className="sync-actions">
            {enabled ? (
              <button className="sync-btn" onClick={disableSync}>
                停止同步
              </button>
            ) : (
              <button className="sync-btn primary" disabled={busy} onClick={turnOn}>
                开启同步
              </button>
            )}
          </div>
        )}

        <div className="sync-section">坚果云 WebDAV</div>
        <Field label="服务器地址" value={form.baseUrl} onChange={set('baseUrl')} placeholder="https://dav.jianguoyun.com/dav/" />
        <Field label="账号" value={form.user} onChange={set('user')} placeholder="坚果云账号（邮箱）" />
        <Field
          label="应用密码"
          type="password"
          value={form.password}
          onChange={set('password')}
          placeholder={cfg?.hasPassword ? '已保存（留空则不修改）' : '在坚果云网页生成的应用密码'}
          hint="坚果云网页「账户信息 → 安全选项 → 第三方应用管理」生成。只加密保存在本机钥匙串里。"
        />
        <Field label="同步文件夹" value={form.folder} onChange={set('folder')} placeholder="FOCUS" hint="不存在会自动创建" />
        <Field label="本机名称" value={form.deviceName} onChange={set('deviceName')} placeholder="例如：MacBook" />
        <div className="sync-actions">
          <button className="sync-btn" disabled={busy} onClick={() => void save().then((ok) => ok && setNote({ text: '已保存', tone: 'ok' }))}>
            保存
          </button>
          <button className="sync-btn" disabled={busy} onClick={test}>
            测试连接
          </button>
        </div>
        {note && <p className={`sync-note tone-${note.tone}`}>{note.text}</p>}
        {cfg && !cfg.encryptionAvailable && <p className="sync-note tone-bad">系统钥匙串不可用，无法安全保存密码。</p>}

        {enabled && (
          <>
            <div className="sync-section">设备</div>
            <ul className="sync-devices">
              <li>
                <span>{form.deviceName || '本机'}（本机）</span>
                <span className="sync-device-time">{relTime(status?.lastUploadAt ?? meta.lastUploadAt, now)}</span>
              </li>
              {devices
                .filter((d) => d.id !== myId)
                .map((d) => (
                  <li key={d.id}>
                    <span>{d.name}</span>
                    <span className="sync-device-time">{relTime(d.writtenAt, now)}</span>
                  </li>
                ))}
            </ul>
          </>
        )}

        <div className="sync-section">调试</div>
        <label className="sync-toggle">
          <input
            type="checkbox"
            checked={simOffline}
            onChange={(e) => {
              setSimOffline(e.target.checked);
              void setSimulatedOffline(e.target.checked);
            }}
          />
          模拟离线（所有同步请求直接失败，用来测试断网）
        </label>
      </div>
    </motion.section>
  );
}

/** 同步设置，从标题栏 ⋯ 菜单或云朵图标进入 */
export function SyncPanel() {
  const open = useUi((s) => s.syncOpen);
  return <AnimatePresence>{open && <SyncSheet />}</AnimatePresence>;
}
