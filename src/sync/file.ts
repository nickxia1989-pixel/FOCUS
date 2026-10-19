// 云端设备文件：每台设备只写自己的 devices/<deviceId>.json，内容是它合并后的完整文档。
// 读进来的一切都当不可信数据逐项校验，坏掉的记录 / 寄存器直接丢弃。
import { LIST_IDS, type ListId } from '../types';
import type { Stamp, VV } from './clock';
import type { DelVal, PosVal, ProfileRec, Reg, StatusVal, SyncDoc, TitleAlt, TitleVal, TodoRec } from './doc';

export const FILE_SCHEMA = 2;

export interface DeviceFile {
  app: 'focus';
  schema: number;
  deviceId: string;
  deviceName: string;
  platform: string;
  writtenAt: number;
  /** 该设备的第几次上传，用来识别读到的是不是旧文件 */
  seq: number;
  /** 每份安装各自的随机数：云端"自己的文件"里不是本机的 nonce，说明另一份安装在冒用这个设备 id */
  nonce: string;
  /** 写入方当时的全部知识（版本向量） */
  knowledge: VV;
  doc: SyncDoc;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isList = (x: unknown): x is ListId => LIST_IDS.includes(x as ListId);

function parseVV(x: unknown): VV | null {
  if (!isObj(x)) return null;
  const out: VV = {};
  for (const [k, v] of Object.entries(x)) {
    if (!ID_RE.test(k) || !isNum(v) || v < 0) return null;
    out[k] = v;
  }
  return out;
}

function parseStamp(x: unknown): Stamp | null {
  if (!isObj(x) || typeof x.t !== 'string' || x.t.length > 120) return null;
  const vv = parseVV(x.vv);
  return vv ? { t: x.t, vv } : null;
}

function parseReg<T>(x: unknown, val: (v: unknown) => T | null): Reg<T> | undefined {
  if (!isObj(x)) return undefined;
  const s = parseStamp(x.s);
  const v = val(x.v);
  if (!s || v === null) return undefined;
  const r: Reg<T> = { v, s };
  if (x.d === 1) r.d = 1;
  if (x.r === 1) r.r = 1;
  return r;
}

const titleVal = (v: unknown): TitleVal | null => {
  if (!isObj(v) || typeof v.title !== 'string') return null;
  const out: TitleVal = { title: v.title.slice(0, 2000) };
  if (Array.isArray(v.alts)) {
    const alts: TitleAlt[] = [];
    for (const a of v.alts) {
      if (!isObj(a) || typeof a.v !== 'string' || typeof a.t !== 'string') continue;
      const vv = parseVV(a.vv);
      if (!vv) continue;
      const alt: TitleAlt = { v: a.v.slice(0, 2000), t: a.t, vv };
      if (a.r === 1) alt.r = 1;
      alts.push(alt);
    }
    if (alts.length > 1) out.alts = alts.slice(0, 20);
  }
  return out;
};

const statusVal = (v: unknown): StatusVal | null => {
  if (!isObj(v) || typeof v.done !== 'boolean') return null;
  const out: StatusVal = { done: v.done, completedAt: isNum(v.completedAt) ? v.completedAt : null };
  if (isList(v.completedFrom)) out.completedFrom = v.completedFrom;
  if (v.testing === true && !v.done) out.testing = true;
  return out;
};

const posVal = (v: unknown): PosVal | null => {
  if (!isObj(v) || !isList(v.list)) return null;
  const parentId = typeof v.parentId === 'string' && ID_RE.test(v.parentId) ? v.parentId : null;
  if (v.focused === true && parentId === null && v.list === 'focus') return { parentId, list: v.list, focused: true };
  return { parentId, list: v.list };
};

const numVal = (v: unknown): number | null => (isNum(v) ? v : null);

const delVal = (v: unknown): DelVal | null => {
  if (!isObj(v)) return null;
  const out: DelVal = { deletedAt: isNum(v.deletedAt) ? v.deletedAt : null };
  if (v.purged === true) out.purged = true;
  return out;
};

function parseTodo(x: unknown): TodoRec | null {
  if (!isObj(x) || typeof x.id !== 'string' || !ID_RE.test(x.id) || typeof x.p !== 'string' || !ID_RE.test(x.p)) return null;
  if (!isNum(x.createdAt)) return null;
  const r: TodoRec = { id: x.id, p: x.p, createdAt: x.createdAt };
  const title = parseReg(x.title, titleVal);
  const status = parseReg(x.status, statusVal);
  const pos = parseReg(x.pos, posVal);
  const order = parseReg(x.order, numVal);
  const del = parseReg(x.del, delVal);
  if (title) r.title = title;
  if (status) r.status = status;
  if (pos) r.pos = pos;
  if (order) r.order = order;
  if (del) r.del = del;
  return r;
}

function parseProfile(x: unknown): ProfileRec | null {
  if (!isObj(x) || typeof x.id !== 'string' || !ID_RE.test(x.id)) return null;
  const r: ProfileRec = { id: x.id };
  const meta = parseReg(x.meta, (v) => {
    if (!isObj(v) || typeof v.name !== 'string' || !isNum(v.createdAt)) return null;
    const m: { name: string; tint?: number; createdAt: number } = { name: v.name.slice(0, 64) || '未命名', createdAt: v.createdAt };
    if (isNum(v.tint)) m.tint = v.tint;
    return m;
  });
  const del = parseReg(x.del, (v) => (isObj(v) ? { deletedAt: isNum(v.deletedAt) ? v.deletedAt : null } : null));
  if (meta) r.meta = meta;
  if (del) r.del = del;
  return r;
}

export function parseDoc(x: unknown): SyncDoc | null {
  if (!isObj(x) || !isObj(x.todos) || !isObj(x.profiles)) return null;
  const doc: SyncDoc = { profiles: {}, todos: {} };
  for (const [id, raw] of Object.entries(x.profiles)) {
    const p = parseProfile(raw);
    if (p && p.id === id) doc.profiles[id] = p;
  }
  for (const [id, raw] of Object.entries(x.todos)) {
    const t = parseTodo(raw);
    if (t && t.id === id) doc.todos[id] = t;
  }
  return doc;
}

/** 解析设备文件；不是本应用的、版本不认识的、读到半截的一律返回 null（本轮跳过，下轮再试） */
export function parseDeviceFile(text: string): DeviceFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw) || raw.app !== 'focus' || raw.schema !== FILE_SCHEMA) return null;
  if (typeof raw.deviceId !== 'string' || !ID_RE.test(raw.deviceId)) return null;
  const knowledge = parseVV(raw.knowledge);
  const doc = parseDoc(raw.doc);
  if (!knowledge || !doc) return null;
  return {
    app: 'focus',
    schema: FILE_SCHEMA,
    deviceId: raw.deviceId,
    deviceName: typeof raw.deviceName === 'string' ? raw.deviceName.slice(0, 64) : raw.deviceId,
    platform: typeof raw.platform === 'string' ? raw.platform.slice(0, 32) : '',
    writtenAt: isNum(raw.writtenAt) ? raw.writtenAt : 0,
    seq: isNum(raw.seq) ? raw.seq : 0,
    nonce: typeof raw.nonce === 'string' ? raw.nonce.slice(0, 64) : '',
    knowledge,
    doc,
  };
}

/** 键排序后的 JSON，内容相同的文档得到相同的字符串 */
export function canonicalJson(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonicalJson).join(',')}]`;
  if (isObj(x)) {
    const keys = Object.keys(x)
      .filter((k) => x[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(x[k])}`).join(',')}}`;
  }
  return JSON.stringify(x) ?? 'null';
}

/** FNV-1a 64 位，只用来判断"内容有没有变"，不做安全用途 */
export function contentHash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000193 ^ 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export const docHash = (doc: SyncDoc) => contentHash(canonicalJson(doc));

export function buildDeviceFile(input: Omit<DeviceFile, 'app' | 'schema'>): string {
  return JSON.stringify({ app: 'focus', schema: FILE_SCHEMA, ...input });
}
