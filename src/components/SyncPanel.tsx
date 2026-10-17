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
import { BackIcon, CloudStateIcon, LaptopIcon, PhoneIcon } from './icons';
import { cloudState } from './TitleBar';

const EASE = [0.2, 0.8, 0.2, 1] as const;

export function relTime(t: number | null | undefined, now: number) {
  if (!t) return '从未';
  const d = now - t;
  if (d < 10_000) return '刚刚';
  if (d < 60_000) return `${Math.floor(d / 1000)} 秒前`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  const date = new Date(t);
  const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (d < 86_400_000 && date.getDate() === new Date(now).getDate()) return `今天 ${hm}`;
  if (d < 2 * 86_400_000) return `昨天 ${hm}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hm}`;
}

export function statusText(s: SyncStatus | null, enabled: boolean): { text: string; tone: 'ok' | 'busy' | 'warn' | 'bad' | 'off' } {
  if (!enabled || !s || s.state === 'off') return { text: '未开启同步', tone: 'off' };
  switch (s.state) {
    case 'syncing':
      return { text: '正在同步…', tone: 'busy' };
    case 'offline':
      return { text: '离线：改动已保存在本机', tone: 'warn' };
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

const TONE_COLOR = { ok: 'var(--ok)', busy: 'var(--tx)', warn: 'var(--fa)', bad: 'var(--bad)', off: 'var(--mu)' };

function Field(props: { label: string; value: string; onChange(v: string): void; placeholder?: string; type?: string }) {
  return (
    <label className="fr">
      <span>{props.label}</span>
      <input
        type={props.type ?? 'text'}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
    </label>
  );
}

const isPhone = (platform: string) => /ios|iphone|ipad|android/i.test(platform);

/** 同步设置：状态卡、坚果云账号、各设备最后更新时间、关闭同步 */
function SyncSheet() {
  const status = useData((s) => s.syncStatus);
  const enabled = useData((s) => s.local.sync.enabled);
  const meta = useData((s) => s.local.sync.meta);
  const myId = useData((s) => s.clock.deviceId);
  const conflicts = useData((s) => s.conflicts.length);
  const [cfg, setCfg] = useState<SyncConfigView | null>(null);
  const [form, setForm] = useState({ baseUrl: '', user: '', password: '', folder: '', deviceName: '' });
  const [saved, setSaved] = useState(form);
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [simOffline, setSimOffline] = useState(isSimulatedOffline);
  const [now, setNow] = useState(() => Date.now());
  const close = () => useUi.getState().set({ syncOpen: false });

  useEffect(() => {
    void loadSyncConfig().then((c) => {
      if (!c) return;
      setCfg(c);
      const f = { baseUrl: c.baseUrl, user: c.user, password: '', folder: c.folder, deviceName: c.deviceName };
      setForm(f);
      setSaved(f);
    });
    const t = setInterval(() => setNow(Date.now()), 5000);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !useUi.getState().join && close();
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k] !== saved[k]);

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
    const c = await loadSyncConfig();
    setCfg(c);
    const f = c ? { baseUrl: c.baseUrl, user: c.user, password: '', folder: c.folder, deviceName: c.deviceName } : { ...form, password: '' };
    setForm(f);
    setSaved(f);
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
      const s = useData.getState();
      if (probe.devices.length && !s.local.pristine) {
        const local = s.todos.length;
        useUi.getState().set({ join: { devices: probe.devices.length, local } });
      } else await enableSync(probe.devices.length ? 'cloud' : 'merge');
    } finally {
      setBusy(false);
    }
  };

  const st = statusText(status, enabled);
  const state = cloudState(status, enabled, conflicts);
  const devices = useMemo(() => Object.values(meta.devices).filter((d) => d.id !== myId).sort((a, b) => b.writtenAt - a.writtenAt), [meta.devices, myId]);
  const lastSync = status?.lastSyncAt ?? meta.lastSyncAt;
  const sub = !enabled
    ? cfg?.hasPassword
      ? '账号已填好，开启后每 15 秒检查一次'
      : '填好下面的坚果云账号和应用密码后开启'
    : st.tone === 'ok'
      ? `${relTime(lastSync, now)} · 每 15 秒检查一次`
      : `上次同步 ${relTime(lastSync, now)}`;

  return (
    <motion.section
      className="sheet"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6, transition: { duration: 0.12 } }}
      transition={{ duration: 0.22, ease: EASE }}
    >
      <header className="shh">
        <button className="bk" title="返回（Esc）" aria-label="返回" onClick={close}>
          <BackIcon />
        </button>
        <b>同步</b>
        <span>坚果云 WebDAV</span>
      </header>
      <div className="shb">
        <div className="card ss">
          <span className="ic" style={{ color: TONE_COLOR[st.tone] }}>
            <CloudStateIcon state={state === 'conflict' ? 'ok' : state} className={state === 'syncing' ? 'spin' : ''} />
          </span>
          <div className="tx">
            <b>{st.text}</b>
            <span>{sub}</span>
          </div>
          {enabled ? (
            <button className="btn pri" onClick={syncNow}>
              立即同步
            </button>
          ) : (
            <button className="btn pri" disabled={busy} onClick={turnOn}>
              开启同步
            </button>
          )}
        </div>

        <div className="card fl">
          <Field label="服务器" value={form.baseUrl} onChange={set('baseUrl')} placeholder="https://dav.jianguoyun.com/dav/" />
          <Field label="账号" value={form.user} onChange={set('user')} placeholder="坚果云账号（邮箱）" />
          <Field
            label="应用密码"
            type="password"
            value={form.password}
            onChange={set('password')}
            placeholder={cfg?.hasPassword ? '••••••••••（已保存，留空不修改）' : '坚果云网页生成的应用密码'}
          />
          <Field label="同步文件夹" value={form.folder} onChange={set('folder')} placeholder="FOCUS" />
          <Field label="本机名称" value={form.deviceName} onChange={set('deviceName')} placeholder="例如：MacBook Pro" />
        </div>
        {(dirty || note) && (
          <div className="row-btns">
            {dirty && (
              <button className="btn pri" disabled={busy} onClick={() => void save().then((ok) => ok && setNote({ text: '已保存', tone: 'ok' }))}>
                保存
              </button>
            )}
            <button className="btn" disabled={busy} onClick={test}>
              测试连接
            </button>
            {note && <p className={`note ${note.tone}`}>{note.text}</p>}
          </div>
        )}
        <p className="cap2">应用密码在坚果云网页「账户信息 → 安全选项 → 第三方应用管理」生成，只加密存在本机钥匙串里。同步文件夹不存在会自动创建。</p>
        {cfg && !cfg.encryptionAvailable && <p className="note bad">系统钥匙串不可用，无法安全保存密码。</p>}

        {enabled && (
          <div className="card" style={{ padding: '4px 12px' }}>
            <div className="dv">
              <LaptopIcon />
              <span>{saved.deviceName || '本机'}（本机）</span>
              <em>{relTime(status?.lastUploadAt ?? meta.lastUploadAt, now)}</em>
            </div>
            {devices.map((d) => (
              <div key={d.id} className="dv">
                {isPhone(d.platform) ? <PhoneIcon /> : <LaptopIcon />}
                <span>{d.name}</span>
                <em>{relTime(d.writtenAt, now)}</em>
              </div>
            ))}
          </div>
        )}

        {enabled && (
          <button className="btn bad" style={{ alignSelf: 'flex-start' }} onClick={disableSync}>
            关闭同步
          </button>
        )}

        <label className="dbg">
          <input
            type="checkbox"
            checked={simOffline}
            onChange={(e) => {
              setSimOffline(e.target.checked);
              void setSimulatedOffline(e.target.checked);
            }}
          />
          调试：模拟离线（所有同步请求直接失败）
        </label>
      </div>
    </motion.section>
  );
}

/** 同步设置，从标题栏的云朵或 ⋯ 菜单进入 */
export function SyncPanel() {
  const open = useUi((s) => s.syncOpen);
  return <AnimatePresence>{open && <SyncSheet />}</AnimatePresence>;
}
