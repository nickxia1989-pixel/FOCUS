// 同步引擎：内存里的假 WebDAV，按坚果云的特点（修改时间精确到秒、父目录不存在回 409）加各种故障。
import { describe, expect, it } from 'vitest';
import { newClock } from './clock';
import { createProfile, emptyDoc, viewProfile } from './doc';
import { emptyMeta, SyncEngine, type EngineHost, type SyncMeta, type SyncStatus } from './engine';
import { parseDeviceFile } from './file';
import * as O from './ops';
import type { HttpRequest, HttpResult, Transport } from './webdav';

/** 假的坚果云 */
class FakeDav {
  files = new Map<string, { body: string; mtime: number; history: string[] }>();
  dirs = new Set<string>(['']);
  now = 1_700_000_000_000;
  offline = new Set<string>();
  rateLimited = false;
  /** 下一次 PUT 实际写进去了，但回给客户端的是网络错误 */
  putAppliedButFails = 0;
  /** 下一次 GET 返回该文件的上一个版本（模拟缓存 / 最终一致） */
  staleNextGet = 0;
  log: string[] = [];

  transport(device: string): Transport {
    return { request: (req) => this.handle(device, req) };
  }

  private parent(path: string) {
    const p = path.replace(/\/+$/, '');
    return p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
  }

  async handle(device: string, req: HttpRequest): Promise<HttpResult> {
    this.log.push(`${device} ${req.method} ${req.path}`);
    if (this.offline.has(device)) return { ok: false, error: 'network', message: 'offline' };
    if (this.rateLimited) return { ok: true, status: 503, body: 'Too many requests', headers: {} };
    const path = req.path.replace(/\/+$/, '');
    const sec = Math.floor(this.now / 1000) * 1000;
    switch (req.method) {
      case 'MKCOL':
        if (this.dirs.has(path)) return { ok: true, status: 405, body: '', headers: {} };
        if (!this.dirs.has(this.parent(path))) return { ok: true, status: 409, body: '', headers: {} };
        this.dirs.add(path);
        return { ok: true, status: 201, body: '', headers: {} };
      case 'PUT': {
        if (!this.dirs.has(this.parent(path))) return { ok: true, status: 409, body: '', headers: {} };
        const prev = this.files.get(path);
        this.files.set(path, { body: req.body ?? '', mtime: sec, history: [...(prev?.history ?? []), prev?.body ?? ''] });
        if (this.putAppliedButFails > 0) {
          this.putAppliedButFails--;
          return { ok: false, error: 'network', message: 'connection reset after write' };
        }
        return { ok: true, status: prev ? 204 : 201, body: '', headers: {} };
      }
      case 'GET': {
        const f = this.files.get(path);
        if (!f) return { ok: true, status: this.dirs.has(this.parent(path)) ? 404 : 409, body: '', headers: {} };
        if (this.staleNextGet > 0 && f.history.length && f.history[f.history.length - 1]) {
          this.staleNextGet--;
          return { ok: true, status: 200, body: f.history[f.history.length - 1], headers: {} };
        }
        return { ok: true, status: 200, body: f.body, headers: {} };
      }
      case 'PROPFIND': {
        if (!this.dirs.has(path)) return { ok: true, status: 404, body: '', headers: {} };
        const rows = [`<d:response><d:href>/dav/${path}/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>`];
        for (const [p, f] of this.files) {
          if (this.parent(p) !== path) continue;
          const name = p.slice(p.lastIndexOf('/') + 1);
          rows.push(
            `<d:response><d:href>/dav/${p}</d:href><d:propstat><d:prop><d:resourcetype/><d:getlastmodified>${new Date(f.mtime).toUTCString()}</d:getlastmodified><d:getcontentlength>${new TextEncoder().encode(f.body).length}</d:getcontentlength><d:displayname>${name}</d:displayname></d:prop></d:propstat></d:response>`,
          );
        }
        for (const d of this.dirs) {
          if (d && this.parent(d) === path)
            rows.push(`<d:response><d:href>/dav/${d}/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>`);
        }
        return { ok: true, status: 207, body: `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${rows.join('')}</d:multistatus>`, headers: {} };
      }
      default:
        return { ok: true, status: 405, body: '', headers: {} };
    }
  }

  puts(device: string) {
    return this.log.filter((l) => l.startsWith(`${device} PUT`)).length;
  }
}

const P = 'p1';

/** 一台设备：状态 + 引擎 */
class Node {
  st: O.DocState;
  meta: SyncMeta = emptyMeta();
  collapsed: O.Collapsed = {};
  statuses: SyncStatus[] = [];
  clashes = 0;
  now = 2_000_000;
  engine: SyncEngine;
  constructor(
    public dav: FakeDav,
    public id: string,
    public nonce = `${id}-nonce`,
  ) {
    this.st = { doc: emptyDoc(), clock: newClock(id) };
    const host: EngineHost = {
      transport: dav.transport(id),
      folder: () => 'FOCUS',
      deviceId: () => this.st.clock.deviceId,
      nonce: () => this.nonce,
      deviceName: () => this.id,
      platform: 'test',
      state: () => this.st,
      merge: (doc, knowledge) => {
        this.st = O.mergeRemote(this.st, doc, knowledge, (this.now += 1));
      },
      meta: () => this.meta,
      setMeta: (m) => (this.meta = m),
      identityClash: () => {
        this.clashes++;
        this.st = { ...this.st, clock: { ...newClock(`${id}x`), knowledge: this.st.clock.knowledge } };
      },
      onStatus: (s) => this.statuses.push(s),
      now: () => (this.now += 1),
    };
    this.engine = new SyncEngine(host, { minPutGapMs: 0 });
  }
  ctx(): O.OpCtx {
    this.now += 1000;
    return { profileId: P, collapsed: this.collapsed, now: this.now };
  }
  add(id: string, title: string) {
    const r = O.addTodo(this.st, this.ctx(), { id, title, list: 'inbox' });
    this.st = { doc: r.doc, clock: r.clock };
  }
  titles() {
    return viewProfile(this.st.doc, P)
      .todos.map((t) => t.title)
      .sort();
  }
  /** 跑一轮带状态处理的同步（不启动定时器） */
  async round() {
    this.engine.enabled = true;
    await this.engine.flush();
    this.engine.stop();
    this.engine.enabled = false;
    return this.statuses[this.statuses.length - 2] ?? this.statuses[this.statuses.length - 1];
  }
}

function setup() {
  const dav = new FakeDav();
  const a = new Node(dav, 'devA');
  const b = new Node(dav, 'devB');
  a.st = createProfile(a.st.doc, a.st.clock, { id: P, name: '工作' }, 1);
  return { dav, a, b };
}

describe('同步引擎', () => {
  it('第一次同步自动建文件夹；A 的改动传到 B', async () => {
    const { dav, a, b } = setup();
    a.add('x', '写周报');
    await a.engine.syncOnce();
    expect(dav.dirs.has('FOCUS')).toBe(true);
    expect(dav.dirs.has('FOCUS/devices')).toBe(true);
    expect(dav.files.has('FOCUS/devices/devA.json')).toBe(true);
    await b.engine.syncOnce();
    expect(b.titles()).toEqual(['写周报']);
  });

  it('断网：状态变成离线、改动留在本机；联网后补传', async () => {
    const { dav, a, b } = setup();
    dav.offline.add('devA');
    a.add('x', '离线时加的');
    const s = await a.round();
    expect(s.state).toBe('offline');
    expect(a.engine.status.pending).toBe(true);
    dav.offline.delete('devA');
    const s2 = await a.round();
    expect(s2.state).toBe('idle');
    expect(a.engine.status.pending).toBe(false);
    await b.engine.syncOnce();
    expect(b.titles()).toEqual(['离线时加的']);
  });

  it('坚果云限流：状态是 ratelimit', async () => {
    const { dav, a } = setup();
    dav.rateLimited = true;
    const s = await a.round();
    expect(s.state).toBe('ratelimit');
  });

  it('只是并入了别人的改动、本机没有新操作时不立即回传', async () => {
    const { dav, a, b } = setup();
    a.add('x', '一');
    await a.engine.syncOnce();
    await b.engine.syncOnce(); // B 第一次要传自己的文件
    const putsBefore = dav.puts('devB');
    dav.now += 5000;
    a.add('y', '二');
    await a.engine.syncOnce();
    await b.engine.syncOnce();
    expect(b.titles()).toEqual(['一', '二']);
    expect(dav.puts('devB')).toBe(putsBefore);
    // B 自己有改动时一起带上
    b.add('z', '三');
    await b.engine.syncOnce();
    expect(dav.puts('devB')).toBe(putsBefore + 1);
  });

  it('读到旧文件（缓存）：本轮跳过，下一轮读到新的', async () => {
    const { dav, a, b } = setup();
    a.add('x', '一');
    await a.engine.syncOnce();
    await b.engine.syncOnce();
    dav.now += 5000;
    a.add('y', '二');
    await a.engine.syncOnce();
    dav.staleNextGet = 1;
    await b.engine.syncOnce();
    expect(b.titles()).toEqual(['一']);
    await b.engine.syncOnce();
    expect(b.titles()).toEqual(['一', '二']);
  });

  it('上传其实成功了但回报失败：下一轮重传，内容一致，不会重复', async () => {
    const { dav, a, b } = setup();
    a.add('x', '一');
    dav.putAppliedButFails = 1;
    const s = await a.round();
    expect(s.state).toBe('offline');
    dav.now += 5000;
    await a.round();
    await b.engine.syncOnce();
    expect(b.titles()).toEqual(['一']);
  });

  it('服务器上自己的文件不是最后上传的那份：重新上传', async () => {
    const { dav, a } = setup();
    a.add('x', '一');
    await a.engine.syncOnce();
    const f = dav.files.get('FOCUS/devices/devA.json')!;
    dav.files.set('FOCUS/devices/devA.json', { ...f, body: f.body.replace('"一"', '"一一"') }); // 大小变了
    const puts = dav.puts('devA');
    await a.engine.syncOnce();
    expect(dav.puts('devA')).toBe(puts + 1);
    expect(parseDeviceFile(dav.files.get('FOCUS/devices/devA.json')!.body)!.doc.todos.x.title!.v.title).toBe('一');
  });

  it('另一份安装冒用同一个设备 id：并入它的数据，然后本机换 id', async () => {
    const dav = new FakeDav();
    const a = new Node(dav, 'devA', 'nonce-1');
    a.st = createProfile(a.st.doc, a.st.clock, { id: P, name: '工作' }, 1);
    a.add('x', '本机');
    await a.engine.syncOnce();
    const clone = new Node(dav, 'devA', 'nonce-2'); // 数据目录被拷到另一台电脑
    clone.st = { doc: a.st.doc, clock: a.st.clock };
    clone.meta = a.meta;
    clone.add('y', '克隆机');
    await clone.engine.syncOnce();
    dav.now += 5000;
    await a.engine.syncOnce();
    expect(a.clashes).toBe(1);
    expect(a.titles()).toEqual(['克隆机', '本机']);
    expect(a.st.clock.deviceId).not.toBe('devA');
  });

  it('网盘生成的冲突副本、别的文件一律忽略', async () => {
    const { dav, a, b } = setup();
    a.add('x', '一');
    await a.engine.syncOnce();
    dav.files.set('FOCUS/devices/devA (conflicted copy).json', { body: 'garbage', mtime: dav.now, history: [] });
    dav.files.set('FOCUS/devices/notes.txt', { body: 'hi', mtime: dav.now, history: [] });
    await b.engine.syncOnce();
    expect(b.titles()).toEqual(['一']);
  });
});
