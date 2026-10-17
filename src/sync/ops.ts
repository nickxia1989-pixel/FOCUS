// 高层操作：桌面和手机的 store 都调这里，随机收敛测试也走同一条路径。
// 列表内的改动全部复用 model.ts 的纯函数，再由 applyTodos 盖戳写回文档。
import * as M from '../model';
import type { ListId, Todo } from '../types';
import { mergeVV, observe, type ClockState, type VV } from './clock';
import {
  applyTodos,
  docKnowledge,
  editTitle,
  maxStampT,
  mergeDocs,
  purgeTodos,
  restoreTodo,
  softDelete,
  viewProfile,
  type SyncDoc,
} from './doc';

export interface DocState {
  doc: SyncDoc;
  clock: ClockState;
}

export type Collapsed = Record<string, true>;

/** 用 model.ts 的函数改当前 profile 的可见列表，再写回文档；collapsed 的变化单独返回（只存本机） */
export function editTodos(
  st: DocState,
  profileId: string,
  collapsed: Collapsed,
  now: number,
  fn: (todos: Todo[]) => Todo[],
  targets?: ReadonlySet<string>,
): DocState & { collapsed: Collapsed } {
  const view = viewProfile(st.doc, profileId, collapsed);
  const next = fn(view.todos);
  if (next === view.todos) return { ...st, collapsed };
  let c = collapsed;
  for (const t of next) {
    if (!!t.collapsed === !!collapsed[t.id]) continue;
    if (c === collapsed) c = { ...collapsed };
    if (t.collapsed) c[t.id] = true;
    else delete c[t.id];
  }
  const e = applyTodos(st.doc, st.clock, profileId, next, now, targets);
  return { doc: e.doc, clock: e.clock, collapsed: c };
}

export interface OpCtx {
  profileId: string;
  collapsed: Collapsed;
  now: number;
}

type Result<R = void> = DocState & { collapsed: Collapsed; result: R };

const done = <R>(s: DocState & { collapsed: Collapsed }, result: R): Result<R> => ({ ...s, result });

export function addTodo(st: DocState, ctx: OpCtx, input: { id: string; title: string; list: ListId; parentId?: string | null }) {
  if (!input.title.trim()) return done({ ...st, collapsed: ctx.collapsed }, null as string | null);
  const s = editTodos(
    st,
    ctx.profileId,
    ctx.collapsed,
    ctx.now,
    (todos) => M.createTodo(todos, { id: input.id, title: input.title, list: input.list, parentId: input.parentId ?? null, now: ctx.now }),
    new Set([input.id]),
  );
  return done(s, input.id as string | null);
}

export function completeTodo(st: DocState, ctx: OpCtx, id: string): Result<ListId | null> {
  let movedTo: ListId | null = null;
  const s = editTodos(
    st,
    ctx.profileId,
    ctx.collapsed,
    ctx.now,
    (todos) => {
      const r = M.completeTodo(todos, id, ctx.now);
      movedTo = r.movedTo;
      return r.todos;
    },
    new Set([id]),
  );
  return done(s, movedTo);
}

/** 针对单个条目的操作：第一个参数是条目 id，其它条目被连带改动的算连带改动 */
const simple =
  <A extends unknown[]>(fn: (todos: Todo[], id: string, ...args: A) => Todo[]) =>
  (st: DocState, ctx: OpCtx, id: string, ...args: A): Result =>
    done(editTodos(st, ctx.profileId, ctx.collapsed, ctx.now, (todos) => fn(todos, id, ...args), new Set([id])), undefined);

export const uncompleteTodo = simple(M.uncompleteTodo);
export const moveTodo = simple(M.moveTodo);
export const markForTest = simple(M.markForTest);
export const unmarkTest = simple(M.unmarkTest);
export const reorderTodo = simple(M.reorderTodo);
export const setCollapsed = simple(M.setCollapsed);

/**
 * 改标题。base 传开始编辑时的 clock.knowledge：编辑期间远端也改了这条标题时会变成冲突，不会悄悄覆盖远端。
 * 不传 base 就是普通改写。
 */
export function renameTodo(st: DocState, ctx: OpCtx, id: string, title: string, base: VV | null = null): Result {
  const e = editTitle(st.doc, st.clock, id, title, base, ctx.now);
  return done({ doc: e.doc, clock: e.clock, collapsed: ctx.collapsed }, undefined);
}

/** 删除进回收站，返回回收站条目 id（就是根项 id）和这次删掉的条数 */
export function removeTodo(st: DocState, ctx: OpCtx, id: string): Result<{ entryId: string; count: number } | null> {
  const view = viewProfile(st.doc, ctx.profileId);
  if (!view.todos.some((t) => t.id === id)) return done({ ...st, collapsed: ctx.collapsed }, null);
  const e = softDelete(st.doc, st.clock, id, ctx.now);
  const entry = viewProfile(e.doc, ctx.profileId).trash.find((t) => t.id === id);
  return done({ doc: e.doc, clock: e.clock, collapsed: ctx.collapsed }, { entryId: id, count: entry?.items.length ?? 1 });
}

export function restoreFromTrash(st: DocState, ctx: OpCtx, entryId: string): Result<ListId | null> {
  const e = restoreTodo(st.doc, st.clock, entryId, ctx.now);
  return done({ doc: e.doc, clock: e.clock, collapsed: ctx.collapsed }, e.list);
}

export function purgeTrashEntry(st: DocState, ctx: OpCtx, entryId: string): Result {
  const e = purgeTodos(st.doc, st.clock, [entryId], ctx.now);
  return done({ doc: e.doc, clock: e.clock, collapsed: ctx.collapsed }, undefined);
}

export function emptyTrash(st: DocState, ctx: OpCtx): Result {
  const ids = viewProfile(st.doc, ctx.profileId).trash.map((e) => e.id);
  const e = purgeTodos(st.doc, st.clock, ids, ctx.now);
  return done({ doc: e.doc, clock: e.clock, collapsed: ctx.collapsed }, undefined);
}

/**
 * 并入远端文档：合并记录，并把对方的知识并进本机时钟。
 * 第二步不能省——否则本机之后的写入"不知道"对方的改动，会被误判成并发冲突。
 */
export function mergeRemote(st: DocState, remote: SyncDoc, remoteKnowledge: VV, now: number): DocState {
  const doc = mergeDocs(st.doc, remote);
  const clock = observe(st.clock, mergeVV(remoteKnowledge, docKnowledge(remote)), maxStampT(remote), now);
  return { doc, clock };
}
