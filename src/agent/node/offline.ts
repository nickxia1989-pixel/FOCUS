/// <reference types="node" />
// 离线模式：agent 是这台电脑上的另一台"设备"，有自己的 deviceId 和时钟。
// 只读桌面的 focus-doc.json；改动用 agent 自己的时钟打戳，写进自己的 agent/outbox.json（设备文件格式），
// 桌面启动时（开着时检测到文件变化）像并入远端设备一样并入、上传。绝不写桌面的文件，也不借用桌面的时钟。
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { mergeVV, newClock, observe, type ClockState } from '../../sync/clock';
import { docKnowledge, emptyDoc, maxStampT, mergeDocs, type SyncDoc } from '../../sync/doc';
import { buildDeviceFile, canonicalJson, parseDeviceFile, parseDoc, type DeviceFile } from '../../sync/file';
import type { AgentState, ApplyResult, SyncInfo } from '../core';
import { files } from './paths';

const readText = (f: string): string | null => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return null;
  }
};

const readJson = (f: string): unknown => {
  const t = readText(f);
  if (t === null) return null;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
};

/** 先写临时文件再改名，读的一方永远读不到半截 */
function writeAtomic(file: string, text: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

export interface DesktopData {
  doc: SyncDoc | null;
  /** 读不到文档的原因 */
  problem: null | 'missing' | 'legacy' | 'corrupt';
  activeProfileId: string | null;
  sync: SyncInfo | null;
}

/** 只读桌面的数据文件 */
export function readDesktop(dir: string): DesktopData {
  const f = files(dir);
  const local = readJson(f.local) as {
    activeProfileId?: unknown;
    clock?: { counter?: unknown };
    sync?: { enabled?: unknown; meta?: { lastSyncAt?: unknown; uploadedCounter?: unknown } };
  } | null;
  const activeProfileId = typeof local?.activeProfileId === 'string' ? local.activeProfileId : null;
  const sync: SyncInfo | null = local
    ? {
        enabled: !!local.sync?.enabled,
        lastSyncAt: typeof local.sync?.meta?.lastSyncAt === 'number' ? local.sync.meta.lastSyncAt : null,
        pending:
          typeof local.clock?.counter === 'number' &&
          typeof local.sync?.meta?.uploadedCounter === 'number' &&
          local.clock.counter > local.sync.meta.uploadedCounter,
      }
    : null;
  const raw = readJson(f.doc);
  if (raw === null) {
    const legacy = f.legacy.some((x) => fs.existsSync(x));
    return { doc: null, problem: legacy ? 'legacy' : 'missing', activeProfileId, sync };
  }
  const doc = raw === undefined ? null : parseDoc(raw);
  if (doc) return { doc, problem: null, activeProfileId, sync };
  // 主文件坏了：读的时候先用桌面留的备份，写入要等桌面自己修好
  const bak = parseDoc(readJson(f.docBak));
  return { doc: bak, problem: 'corrupt', activeProfileId, sync };
}

export function readOutbox(dir: string): DeviceFile | null {
  const t = readText(files(dir).outbox);
  return t === null ? null : parseDeviceFile(t);
}

const countRecords = (d: SyncDoc) => Object.keys(d.todos).length + Object.keys(d.profiles).length;

/** 离线读取：桌面文档 ⊔ outbox */
export function offlineRead(dir: string): { doc: SyncDoc; activeProfileId: string | null; sync: SyncInfo | null; note: string | null } {
  const d = readDesktop(dir);
  const out = readOutbox(dir);
  const pending = out ? pendingCount(d.doc, out.doc) : 0;
  const notes: string[] = [];
  if (d.problem === 'missing') notes.push('这个数据目录里还没有 FOCUS 数据（先打开一次 FOCUS）');
  if (d.problem === 'legacy') notes.push('数据还是旧版本格式：先打开一次新版 FOCUS 完成迁移');
  if (d.problem === 'corrupt') notes.push('focus-doc.json 读不出来，暂时显示的是备份；打开 FOCUS 会自动修复');
  if (pending) notes.push(`有 ${pending} 条改动在 agent outbox 里，等桌面下次启动时并入、上传`);
  const base = d.doc ?? emptyDoc();
  return { doc: out ? mergeDocs(base, out.doc) : base, activeProfileId: d.activeProfileId, sync: d.sync, note: notes.join('；') || null };
}

/** outbox 里桌面还没有的记录数 */
function pendingCount(desk: SyncDoc | null, outDoc: SyncDoc): number {
  if (!desk) return countRecords(outDoc);
  return countRecords(delta(mergeDocs(desk, outDoc), desk));
}

/** next 里和桌面文档不一样的记录：桌面并入、保存以后它们就和桌面一致，下一次写入时自动从 outbox 清掉 */
export function delta(next: SyncDoc, desk: SyncDoc): SyncDoc {
  const out = emptyDoc();
  for (const [id, r] of Object.entries(next.todos)) {
    const d = desk.todos[id];
    if (d !== r && (!d || canonicalJson(d) !== canonicalJson(r))) out.todos[id] = r;
  }
  for (const [id, p] of Object.entries(next.profiles)) {
    const d = desk.profiles[id];
    if (d !== p && (!d || canonicalJson(d) !== canonicalJson(p))) out.profiles[id] = p;
  }
  return out;
}

// ---------- agent 的身份 ----------

interface AgentLocal {
  v: 1;
  deviceId: string;
  nonce: string;
  /** 绑定的机器：数据目录被拷到别的电脑时换一个新 id，两边不会用同一个 id 写出不同内容 */
  machine: string;
  clock: ClockState;
  seq: number;
}

const randomId = (n: number) => Array.from(randomBytes(n), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');

let machineCache: string | null = null;
/** 本机的稳定标识（取哈希，不存原值） */
export function machineId(): string {
  if (machineCache) return machineCache;
  let raw = '';
  try {
    if (process.platform === 'darwin') {
      const out = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 3000 });
      raw = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out)?.[1] ?? '';
    } else if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', timeout: 3000 });
      raw = /MachineGuid\s+REG_SZ\s+(\S+)/.exec(out)?.[1] ?? '';
    } else {
      raw = (readText('/etc/machine-id') ?? readText('/var/lib/dbus/machine-id') ?? '').trim();
    }
  } catch {}
  if (!raw) raw = `host:${os.hostname()}`;
  machineCache = createHash('sha256').update(`focus-agent:${raw}`).digest('hex').slice(0, 16);
  return machineCache;
}

function loadIdentity(dir: string): AgentLocal {
  const raw = readJson(files(dir).state) as Partial<AgentLocal> | null | undefined;
  const machine = machineId();
  const ok = raw && raw.v === 1 && typeof raw.deviceId === 'string' && /^[a-z0-9]{10}$/.test(raw.deviceId) && raw.clock && typeof raw.nonce === 'string';
  if (ok && raw.machine === machine) {
    return { v: 1, deviceId: raw.deviceId!, nonce: raw.nonce!, machine, clock: { ...newClock(raw.deviceId!), ...raw.clock }, seq: typeof raw.seq === 'number' ? raw.seq : 0 };
  }
  // 第一次用，或数据目录是从别的电脑拷来的：新身份，保留已知的知识
  const deviceId = randomId(10);
  const knowledge = ok && raw.clock?.knowledge ? raw.clock.knowledge : {};
  return { v: 1, deviceId, nonce: randomId(16), machine, clock: { ...newClock(deviceId), knowledge: { ...knowledge } }, seq: ok ? (raw.seq ?? 0) : 0 };
}

export function agentDeviceId(dir: string): string | null {
  const raw = readJson(files(dir).state) as Partial<AgentLocal> | null | undefined;
  return raw && typeof raw.deviceId === 'string' ? raw.deviceId : null;
}

// ---------- 文件锁：同时开着的几个 MCP 进程共用一个身份，读改写要排队 ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const LOCK_STALE_MS = 10_000;

export async function withLock<T>(dir: string, fn: () => T, waitMs = 5000): Promise<T> {
  const f = files(dir);
  fs.mkdirSync(f.agentDir, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + waitMs;
  const mine = `${process.pid} ${Date.now()} ${randomId(6)}`;
  for (;;) {
    try {
      fs.writeFileSync(f.lock, mine, { flag: 'wx', mode: 0o600 });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const held = readText(f.lock);
      const [pid, at] = (held ?? '').split(' ').map(Number);
      // 持有者已经退出，或卡住太久：接管（删之前再确认一次还是同一把锁）
      if (held !== null && (!pidAlive(pid) || Date.now() - at > LOCK_STALE_MS)) {
        if (readText(f.lock) === held) fs.rmSync(f.lock, { force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error('agent 数据被另一个进程占用超过 5 秒，稍后再试');
      await sleep(10 + Math.random() * 20);
    }
  }
  try {
    return fn();
  } finally {
    if (readText(f.lock) === mine) fs.rmSync(f.lock, { force: true });
  }
}

// ---------- 离线写入 ----------

export class OfflineError extends Error {}

/**
 * 离线写入：拿锁 → 读桌面文档和 outbox → 用 agent 时钟并入已知的一切 → fn 执行操作（只经 ops/doc 打戳）
 * → 把桌面还没有的记录写进 outbox → 释放锁。
 */
export async function offlineApply(
  dir: string,
  fn: (st: AgentState, activeProfileId: string | null) => ApplyResult,
  now: () => number = Date.now,
): Promise<ApplyResult & { pending?: number }> {
  return withLock(dir, () => {
    const d = readDesktop(dir);
    if (d.problem === 'missing') throw new OfflineError('这个数据目录里还没有 FOCUS 数据：先打开一次 FOCUS');
    if (d.problem === 'legacy') throw new OfflineError('数据还是旧版本格式：先打开一次新版 FOCUS 完成迁移');
    if (d.problem === 'corrupt' || !d.doc) throw new OfflineError('focus-doc.json 读不出来：先打开 FOCUS 让它用备份修复');
    const id = loadIdentity(dir);
    const out = readOutbox(dir);
    const base = out ? mergeDocs(d.doc, out.doc) : d.doc;
    const t = now();
    const clock = observe(id.clock, mergeVV(docKnowledge(base), out?.knowledge ?? {}), maxStampT(base), t);
    const r = fn({ doc: base, clock, collapsed: {} }, d.activeProfileId);
    if (!r.ok || !r.changed) return r;
    const seq = id.seq + 1;
    const dl = delta(r.state.doc, d.doc);
    fs.mkdirSync(files(dir).agentDir, { recursive: true, mode: 0o700 });
    writeAtomic(
      files(dir).outbox,
      buildDeviceFile({
        deviceId: id.deviceId,
        deviceName: `AI agent（${os.hostname().replace(/\.local$/i, '')}）`,
        platform: 'agent',
        writtenAt: now(),
        seq,
        nonce: id.nonce,
        knowledge: r.state.clock.knowledge,
        doc: dl,
      }),
    );
    writeAtomic(files(dir).state, JSON.stringify({ ...id, clock: r.state.clock, seq }));
    return { ...r, pending: countRecords(dl) };
  });
}
