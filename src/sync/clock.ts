// 同步用的时钟：混合逻辑时钟（HLC）给自动合并定先后，版本向量（VV）判断两次改动是先后还是并发。
// 纯函数，两端共用。

/** HLC 编码成定长字符串，可直接按字典序比较：墙钟毫秒(36 进制 9 位).计数(36 进制 4 位).设备 id */
export type Hlc = string;

/** 版本向量：设备 id → 该设备的写入计数。表示"写入时已经知道哪些改动" */
export type VV = Record<string, number>;

/** 每个寄存器的戳 */
export interface Stamp {
  t: Hlc;
  vv: VV;
}

const WALL_LEN = 9;
const CTR_LEN = 4;

export function encodeHlc(wall: number, counter: number, deviceId: string): Hlc {
  return `${Math.max(0, Math.floor(wall)).toString(36).padStart(WALL_LEN, '0')}.${counter.toString(36).padStart(CTR_LEN, '0')}.${deviceId}`;
}

export function decodeHlc(t: Hlc): { wall: number; counter: number; deviceId: string } {
  const [w, c, ...rest] = t.split('.');
  return { wall: parseInt(w, 36) || 0, counter: parseInt(c, 36) || 0, deviceId: rest.join('.') };
}

/** 本机时钟状态（存在本机，不同步） */
export interface ClockState {
  deviceId: string;
  /** 本机写入计数，单调递增 */
  counter: number;
  /** 已知的全部改动（含本机） */
  knowledge: VV;
  /** HLC 的墙钟部分与计数 */
  hlcWall: number;
  hlcCounter: number;
}

export function newClock(deviceId: string): ClockState {
  return { deviceId, counter: 0, knowledge: {}, hlcWall: 0, hlcCounter: 0 };
}

/** 远端时间最多允许领先本机这么多；更远的视为对方时钟错误，不拿来推进本机 HLC */
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

/** 本机写一次：返回新戳和推进后的时钟 */
export function tick(clock: ClockState, now: number): { stamp: Stamp; clock: ClockState } {
  const wall = Math.max(clock.hlcWall, now);
  const hlcCounter = wall === clock.hlcWall ? clock.hlcCounter + 1 : 0;
  const counter = clock.counter + 1;
  const knowledge = { ...clock.knowledge, [clock.deviceId]: counter };
  return {
    stamp: { t: encodeHlc(wall, hlcCounter, clock.deviceId), vv: knowledge },
    clock: { ...clock, counter, knowledge, hlcWall: wall, hlcCounter },
  };
}

/** 收到远端数据后：并入对方的知识，推进 HLC */
export function observe(clock: ClockState, remoteKnowledge: VV, remoteMaxT: Hlc | null, now: number): ClockState {
  let { hlcWall, hlcCounter } = clock;
  if (remoteMaxT) {
    const r = decodeHlc(remoteMaxT);
    if (r.wall <= now + MAX_FUTURE_MS && (r.wall > hlcWall || (r.wall === hlcWall && r.counter > hlcCounter))) {
      hlcWall = r.wall;
      hlcCounter = r.counter;
    }
  }
  const knowledge = mergeVV(clock.knowledge, remoteKnowledge);
  // 别处记录的本机计数比本机还大：说明本机数据比云端旧（例如从备份恢复），计数要跟上，否则新戳会和旧戳重号
  const counter = Math.max(clock.counter, knowledge[clock.deviceId] ?? 0);
  knowledge[clock.deviceId] = counter;
  return { ...clock, knowledge, counter, hlcWall, hlcCounter };
}

export function mergeVV(a: VV, b: VV): VV {
  const out: VV = { ...a };
  for (const [k, v] of Object.entries(b)) if (!(k in out) || v > out[k]) out[k] = v;
  return out;
}

/** a 是否覆盖 b：b 知道的每一项 a 都知道（相等也算覆盖） */
export function dominates(a: VV, b: VV): boolean {
  for (const [k, v] of Object.entries(b)) if ((a[k] ?? 0) < v) return false;
  return true;
}

export function vvEqual(a: VV, b: VV): boolean {
  return dominates(a, b) && dominates(b, a);
}

export type Order = 'equal' | 'before' | 'after' | 'concurrent';

/** 比较两个戳：a 相对 b 是更早（before，被 b 覆盖）、更晚（after）、相同还是并发 */
export function compareStamps(a: Stamp, b: Stamp): Order {
  const ab = dominates(a.vv, b.vv);
  const ba = dominates(b.vv, a.vv);
  if (ab && ba) return a.t === b.t ? 'equal' : a.t > b.t ? 'after' : 'before';
  if (ab) return 'after';
  if (ba) return 'before';
  return 'concurrent';
}

export const maxHlc = (a: Hlc | null, b: Hlc | null): Hlc | null => (a === null ? b : b === null ? a : a > b ? a : b);

export const wallOf = (t: Hlc) => decodeHlc(t).wall;
export const deviceOf = (t: Hlc) => decodeHlc(t).deviceId;
