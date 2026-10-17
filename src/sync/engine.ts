// 同步引擎：一轮 = 列目录 → 下载变了的设备文件并合并 → 本机有新内容就上传自己的文件。
// 同一时间只跑一轮；本地改动防抖后触发，在线时定时轮询，断网 / 限流时退避。两端共用。
import type { VV } from './clock';
import type { SyncDoc } from './doc';
import { buildDeviceFile, contentHash, docHash, parseDeviceFile } from './file';
import type { DocState } from './ops';
import { Dav, type DavError, type Transport } from './webdav';

export type SyncState = 'off' | 'idle' | 'syncing' | 'offline' | 'error' | 'auth' | 'ratelimit';

export interface SyncStatus {
  state: SyncState;
  message?: string;
  /** 上次成功完成一轮的时间 */
  lastSyncAt: number | null;
  lastUploadAt: number | null;
  /** 本机有还没上传的改动 */
  pending: boolean;
}

export interface DeviceInfo {
  id: string;
  name: string;
  platform: string;
  writtenAt: number;
}

export interface SyncMeta {
  lastUploadHash: string | null;
  /** 上次上传时本机的写入计数：计数涨了才算"有本机的新改动" */
  uploadedCounter: number;
  /** 本机上传次数，写进文件头 */
  uploadSeq: number;
  /** 上次上传的文件字节数，用来发现"上传成功了但服务器上不是这份" */
  ownSize: number | null;
  /** 各设备文件上次成功读取时的修改时间与大小 */
  files: Record<string, { lastModified: number; size: number }>;
  /** 各设备读到过的最大 seq：读到更小的就是旧文件 */
  seqs: Record<string, number>;
  devices: Record<string, DeviceInfo>;
  lastFullAt: number;
  lastSyncAt: number | null;
  lastUploadAt: number | null;
}

export const emptyMeta = (): SyncMeta => ({
  lastUploadHash: null,
  uploadedCounter: 0,
  uploadSeq: 0,
  ownSize: null,
  files: {},
  seqs: {},
  devices: {},
  lastFullAt: 0,
  lastSyncAt: null,
  lastUploadAt: null,
});

/** 读旧版本存下的 meta 时补齐字段 */
export const normalizeMeta = (m: Partial<SyncMeta> | null | undefined): SyncMeta => ({ ...emptyMeta(), ...(m ?? {}) });

export interface EngineHost {
  transport: Transport;
  folder(): string;
  deviceId(): string;
  /** 本份安装的随机数 */
  nonce(): string;
  deviceName(): string;
  platform: string;
  state(): DocState;
  /** 并入一份远端文档（store 里调用 ops.mergeRemote 并写盘、刷新界面） */
  merge(doc: SyncDoc, knowledge: VV): void;
  meta(): SyncMeta;
  setMeta(m: SyncMeta): void;
  /** 云端"自己的文件"被别的安装写过（例如整个数据目录被拷到另一台电脑）：换一个设备 id */
  identityClash(): void;
  onStatus(s: SyncStatus): void;
  now(): number;
}

const FULL_REFRESH_MS = 5 * 60 * 1000;
const LOCAL_DEBOUNCE_MS = 2000;
/** 只是并入了别人的改动、本机没有新操作时，不急着回传，最多攒这么久 */
const LAZY_ECHO_MS = 10 * 60 * 1000;
/** 两次上传至少隔这么久：坚果云的修改时间只精确到秒，太快的话别的设备会看不出文件变了 */
const MIN_PUT_GAP_MS = 1100;
const OFFLINE_BACKOFF = [15_000, 30_000, 60_000];
const RATELIMIT_BACKOFF = [60_000, 5 * 60_000, 30 * 60_000];
const ERROR_BACKOFF = [60_000, 5 * 60_000];

const FILE_RE = /^([A-Za-z0-9_-]{1,64})\.json$/;

class Abort extends Error {
  constructor(public err: DavError) {
    super(err.message);
  }
}

export class SyncEngine {
  private dav: Dav;
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private poller: ReturnType<typeof setInterval> | null = null;
  private failures = 0;
  private retryAt = 0;
  private lastPutAt = 0;
  /** 并入了本机其它写入方（AI agent 的 outbox）的改动，要像本机改动一样尽快上传：请求次数 / 已经传上去的那次 */
  private uploadWanted = 0;
  private uploadServed = 0;
  enabled = false;
  status: SyncStatus;

  private minPutGapMs: number;

  constructor(
    private host: EngineHost,
    opts: { minPutGapMs?: number } = {},
  ) {
    this.minPutGapMs = opts.minPutGapMs ?? MIN_PUT_GAP_MS;
    this.dav = new Dav(host.transport);
    const m = host.meta();
    this.status = { state: 'off', lastSyncAt: m.lastSyncAt, lastUploadAt: m.lastUploadAt, pending: false };
  }

  private setStatus(p: Partial<SyncStatus>) {
    this.status = { ...this.status, ...p };
    this.host.onStatus(this.status);
  }

  start(pollMs = 15_000) {
    if (this.enabled) return;
    this.enabled = true;
    this.failures = 0;
    this.retryAt = 0;
    this.setStatus({ state: 'idle', message: undefined, pending: this.computePending() });
    this.schedule(0);
    if (pollMs > 0) this.poller = setInterval(() => this.schedule(0, true), pollMs);
  }

  stop() {
    this.enabled = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.poller) clearInterval(this.poller);
    this.timer = this.poller = null;
    this.setStatus({ state: 'off', message: undefined });
  }

  /** 改轮询间隔（iOS 切后台时停掉轮询，回前台再开） */
  setPolling(pollMs: number) {
    if (this.poller) clearInterval(this.poller);
    this.poller = this.enabled && pollMs > 0 ? setInterval(() => this.schedule(0, true), pollMs) : null;
  }

  /** 本机有改动：防抖后同步 */
  notifyLocalChange() {
    if (!this.enabled) return;
    this.setStatus({ pending: true });
    this.schedule(LOCAL_DEBOUNCE_MS);
  }

  /**
   * 并入了只在本机、别的设备还没有的改动（AI agent 的 outbox）：本机写入计数没涨，
   * 但不能按"只是并入了别人的改动"攒 10 分钟，防抖后照常上传
   */
  requestUpload() {
    if (!this.enabled) return;
    this.uploadWanted++;
    this.setStatus({ pending: true });
    this.schedule(LOCAL_DEBOUNCE_MS);
  }

  /** 窗口获得焦点、回到前台、网络恢复、电脑唤醒、手动点"立即同步"：马上来一轮（会跳过退避等待） */
  requestSync() {
    if (!this.enabled) return;
    this.retryAt = 0;
    this.schedule(0);
  }

  /** 立即跑一轮并等它结束（退出、睡眠、切后台前用） */
  async flush(): Promise<void> {
    if (!this.enabled) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running) await this.running;
    await this.run();
  }

  private schedule(delay: number, fromPoll = false) {
    if (!this.enabled) return;
    const now = Date.now();
    // 退避期间轮询不打扰；用户主动触发的会先把 retryAt 清零
    if (fromPoll && now < this.retryAt) return;
    const wait = Math.max(delay, this.retryAt - now, 0);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, wait);
  }

  private run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.round().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        this.schedule(0);
      }
    });
    return this.running;
  }

  /** 有本机的新改动还没上传 */
  private computePending() {
    return this.uploadWanted > this.uploadServed || this.host.state().clock.counter > this.host.meta().uploadedCounter;
  }

  private devicesDir() {
    return `${this.host.folder().replace(/^\/+|\/+$/g, '')}/devices/`;
  }

  private async ensureFolders() {
    const folder = this.host.folder().replace(/^\/+|\/+$/g, '');
    // 逐级建：允许 "我的坚果云/FOCUS" 这种多级路径
    const parts = folder.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const r = await this.dav.mkcol(parts.slice(0, i).join('/'));
      if ('error' in r && !(i < parts.length && r.error.kind === 'forbidden')) {
        if (r.error.kind === 'forbidden' || r.error.kind === 'missing')
          throw new Abort({ ...r.error, kind: 'forbidden', message: `无法创建同步文件夹「${folder}」，可以改成「我的坚果云/${parts[parts.length - 1]}」` });
        throw new Abort(r.error);
      }
    }
    const d = await this.dav.mkcol(`${folder}/devices`);
    if ('error' in d) throw new Abort(d.error);
  }

  private async round() {
    if (!this.enabled) return;
    this.setStatus({ state: 'syncing', message: undefined });
    try {
      await this.syncOnce();
      this.failures = 0;
      this.retryAt = 0;
      const now = this.host.now();
      const meta = { ...this.host.meta(), lastSyncAt: now };
      this.host.setMeta(meta);
      this.setStatus({ state: 'idle', message: undefined, lastSyncAt: now, pending: this.computePending() });
    } catch (e) {
      const err: DavError = e instanceof Abort ? e.err : { kind: 'http', message: String(e) };
      // 网络断开和服务器临时 5xx 都按短间隔重试；限流按长间隔；其它错误（鉴权、权限）等更久
      const transient = err.kind === 'network' || err.kind === 'timeout' || (err.kind === 'http' && (err.status ?? 0) >= 500);
      const table = transient ? OFFLINE_BACKOFF : err.kind === 'ratelimit' ? RATELIMIT_BACKOFF : ERROR_BACKOFF;
      this.retryAt = Date.now() + table[Math.min(this.failures, table.length - 1)];
      this.failures++;
      const state: SyncState =
        err.kind === 'network' || err.kind === 'timeout'
          ? 'offline'
          : err.kind === 'ratelimit'
            ? 'ratelimit'
            : err.kind === 'auth' || err.kind === 'config'
              ? 'auth'
              : 'error';
      this.setStatus({ state, message: err.message, pending: this.computePending() });
      this.schedule(0);
    }
  }

  /** 一轮同步。出错抛 Abort，由 round() 统一处理 */
  async syncOnce() {
    const dir = this.devicesDir();
    let listed = await this.dav.list(dir);
    if ('error' in listed && listed.error.kind === 'missing') {
      await this.ensureFolders();
      listed = await this.dav.list(dir);
    }
    if ('error' in listed) throw new Abort(listed.error);

    const me = this.host.deviceId();
    const ownName = `${me}.json`;
    const base = this.host.meta();
    let meta: SyncMeta = { ...base, files: { ...base.files }, devices: { ...base.devices }, seqs: { ...base.seqs } };
    const now = this.host.now();
    const full = now - meta.lastFullAt > FULL_REFRESH_MS;
    let ownEntry: { lastModified: number; size: number } | null = null;
    let forceUpload = false;

    for (const e of listed.entries) {
      const m = FILE_RE.exec(e.name);
      if (e.isDir || !m) continue; // 网盘偶尔生成的冲突副本等一律忽略
      const id = m[1];
      const seen = meta.files[e.name];
      const changed = !seen || seen.lastModified !== e.lastModified || seen.size !== e.size;
      if (id === me) {
        ownEntry = e;
        const sizeOff = meta.ownSize !== null && e.size !== meta.ownSize;
        if (sizeOff || (seen && changed)) {
          const got = await this.dav.get(dir + e.name);
          if ('error' in got) throw new Abort(got.error);
          const f = parseDeviceFile(got.body);
          if (f && f.nonce && f.nonce !== this.host.nonce()) {
            // 另一份安装在用同一个设备 id：先把它的数据并进来，再给本机换个新 id
            this.host.merge(f.doc, f.knowledge);
            this.host.identityClash();
            this.host.setMeta({ ...emptyMeta(), devices: meta.devices });
            return;
          }
          // 是本机自己的旧上传（上次 PUT 实际没生效等）：重新上传
          if (!f || docHash(f.doc) !== meta.lastUploadHash) forceUpload = true;
          else meta.files[e.name] = { lastModified: e.lastModified, size: e.size };
        }
        continue;
      }
      if (!changed && !full) continue;
      const got = await this.dav.get(dir + e.name);
      if ('error' in got) {
        if (got.error.kind === 'missing') continue; // 列完目录后被删了
        throw new Abort(got.error);
      }
      const f = parseDeviceFile(got.body);
      // 读到半截 / 坏文件：本轮跳过，不记修改时间，下轮再读。
      // 列表显示文件变了、读到的 seq 却不比读过的新：读到的是旧内容（缓存），同样下轮再读
      const lastSeq = meta.seqs[id];
      if (!f || f.deviceId !== id || (lastSeq !== undefined && (changed ? f.seq <= lastSeq : f.seq < lastSeq))) continue;
      this.host.merge(f.doc, f.knowledge);
      meta.files[e.name] = { lastModified: e.lastModified, size: e.size };
      meta.seqs[id] = f.seq;
      meta.devices[id] = { id, name: f.deviceName, platform: f.platform, writtenAt: f.writtenAt };
    }
    if (full) meta.lastFullAt = now;
    this.host.setMeta(meta);

    // 上传：本机有新操作就马上传；只是并入了别人的改动就攒着，最多 10 分钟；云端没有自己的文件或内容不对也要传
    const st = this.host.state();
    const hash = docHash(st.doc);
    // 和读取 st 在同一时刻记下请求号：上传成功才算处理过，上传途中又来的请求留到下一轮
    const wanted = this.uploadWanted;
    const urgent = st.clock.counter > meta.uploadedCounter || !ownEntry || forceUpload || wanted > this.uploadServed;
    const lazy = hash !== meta.lastUploadHash && now - (meta.lastUploadAt ?? 0) > LAZY_ECHO_MS;
    if (urgent || lazy) {
      const gap = this.minPutGapMs - (Date.now() - this.lastPutAt);
      if (gap > 0) await new Promise((r) => setTimeout(r, gap));
      const seq = meta.uploadSeq + 1;
      const body = buildDeviceFile({
        deviceId: me,
        deviceName: this.host.deviceName(),
        platform: this.host.platform,
        writtenAt: this.host.now(),
        seq,
        nonce: this.host.nonce(),
        knowledge: st.clock.knowledge,
        doc: st.doc,
      });
      let put = await this.dav.put(dir + ownName, body);
      if ('error' in put && put.error.kind === 'missing') {
        await this.ensureFolders();
        put = await this.dav.put(dir + ownName, body);
      }
      this.lastPutAt = Date.now();
      if ('error' in put) throw new Abort(put.error);
      this.uploadServed = Math.max(this.uploadServed, wanted);
      const at = this.host.now();
      // 自己文件的修改时间要等下一次列目录才知道：先清掉，下一轮再记基准
      const files = { ...meta.files };
      delete files[ownName];
      meta = {
        ...meta,
        files,
        lastUploadHash: hash,
        uploadedCounter: st.clock.counter,
        uploadSeq: seq,
        ownSize: utf8Length(body),
        lastUploadAt: at,
      };
      this.host.setMeta(meta);
      this.setStatus({ lastUploadAt: at });
    } else if (ownEntry && !meta.files[ownName]) {
      meta = { ...meta, files: { ...meta.files, [ownName]: { lastModified: ownEntry.lastModified, size: ownEntry.size } } };
      this.host.setMeta(meta);
    }
  }

  /** 加入前探测云端：有没有别的设备的数据 */
  async probe(): Promise<{ devices: DeviceInfo[] } | { error: DavError }> {
    const listed = await this.dav.list(this.devicesDir());
    if ('error' in listed) {
      if (listed.error.kind === 'missing') return { devices: [] };
      return { error: listed.error };
    }
    const me = this.host.deviceId();
    const devices: DeviceInfo[] = [];
    for (const e of listed.entries) {
      const m = FILE_RE.exec(e.name);
      if (!m || e.isDir || m[1] === me) continue;
      devices.push({ id: m[1], name: m[1], platform: '', writtenAt: e.lastModified });
    }
    return { devices };
  }
}

/** 给"测试连接"用：列一下 WebDAV 根目录，看账号密码对不对 */
export async function testConnection(t: Transport): Promise<{ ok: true } | { error: DavError }> {
  const r = await new Dav(t).list('');
  return 'error' in r ? r : { ok: true };
}

export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

export { contentHash };
