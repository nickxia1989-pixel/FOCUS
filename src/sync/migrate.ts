// 旧数据 → 可同步文档。桌面 v1（每个 profile 一份 todos + 回收站）与手机快照都走这里。
import type { Todo, TrashEntry } from '../types';
import { tick, type ClockState, type Stamp } from './clock';
import type { ProfileRec, SyncDoc, TodoRec } from './doc';

function todoRec(t: Todo, profileId: string, s: Stamp, del: number | null, pos?: { parentId: string | null; list: Todo['list'] }): TodoRec {
  const status: TodoRec['status'] = { v: { done: t.done, completedAt: t.completedAt }, s };
  if (t.completedFrom) status.v.completedFrom = t.completedFrom;
  if (t.testing && !t.done) status.v.testing = true;
  return {
    id: t.id,
    p: profileId,
    createdAt: t.createdAt,
    title: { v: { title: t.title }, s },
    status,
    pos: { v: pos ?? { parentId: t.parentId, list: t.list }, s },
    order: { v: t.order, s },
    del: { v: { deletedAt: del }, s },
  };
}

/** 一个 profile 的旧数据 → 记录。回收站条目放回文档，根项记上删除时间与删除时的位置 */
export function legacyRecords(todos: Todo[], trash: TrashEntry[], profileId: string, s: Stamp): Record<string, TodoRec> {
  const out: Record<string, TodoRec> = {};
  for (const t of todos) out[t.id] = todoRec(t, profileId, s, null);
  for (const e of trash) {
    for (const t of e.items) {
      if (out[t.id]) continue; // 以在用的为准
      out[t.id] =
        t.id === e.rootId ? todoRec(t, profileId, s, e.deletedAt, { parentId: e.parentId, list: e.list }) : todoRec(t, profileId, s, null);
    }
  }
  return out;
}

export interface LegacyProfile {
  id: string;
  name: string;
  tint?: number;
  createdAt: number;
  todos: Todo[];
  trash: TrashEntry[];
}

/** 一次迁移只走一次时钟：所有寄存器共用同一个戳 */
export function migrateLegacy(profiles: LegacyProfile[], clock: ClockState, now: number): { doc: SyncDoc; clock: ClockState } {
  const t = tick(clock, now);
  const doc: SyncDoc = { profiles: {}, todos: {} };
  for (const p of profiles) {
    const meta: NonNullable<ProfileRec['meta']> = { v: { name: p.name, createdAt: p.createdAt }, s: t.stamp };
    if (p.tint !== undefined) meta.v.tint = p.tint;
    doc.profiles[p.id] = { id: p.id, meta, del: { v: { deletedAt: null }, s: t.stamp } };
    Object.assign(doc.todos, legacyRecords(p.todos, p.trash, p.id, t.stamp));
  }
  return { doc, clock: t.clock };
}
