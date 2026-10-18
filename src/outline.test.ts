import { describe, expect, it } from 'vitest';
import { buildIndex, childrenOf, completeTodo, createTodo, indentTodo, nowOf, outdentTodo, reorderTodo, rootsOf, setNow } from './model';
import {
  canIndent,
  canOutdent,
  draftAfter,
  draftBackTarget,
  draftChildOf,
  draftIndent,
  draftInsert,
  draftOutdent,
  draftShift,
  levelOf,
  moveIndex,
  withDraft,
  type Draft,
} from './outline';
import type { ListId, Todo } from './types';

let clock = 0;
const add = (s: Todo[], id: string, list: ListId, parentId: string | null = null) =>
  createTodo(s, { id, title: id, list, parentId, now: ++clock });

/** 空行里打了字、回车：照 draftInsert 给的参数新建 */
const commit = (s: Todo[], d: Draft, id: string) => {
  const { list, parentId, placement } = draftInsert(d);
  return createTodo(s, { id, title: id, list, parentId, now: ++clock, placement });
};

const kids = (s: Todo[], id: string) => childrenOf(buildIndex(s), id).map((t) => t.id);
const roots = (s: Todo[], list: ListId) => rootsOf(buildIndex(s), list).map((t) => t.id);

describe('大纲编辑：回车开空行', () => {
  it('子项上回车：空行紧跟在它后面，连续回车按顺序往下排', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'inbox');
    s = add(s, 'a', 'inbox', 'p');
    s = add(s, 'b', 'inbox', 'p'); // p: a b
    let d = draftAfter(s, 'a')!;
    expect(d).toEqual({ list: 'inbox', parentId: 'p', afterId: 'a' });
    s = commit(s, d, 'a2');
    expect(kids(s, 'p')).toEqual(['a', 'a2', 'b']);
    // 新建后空行移到新的那条后面，再回车接着往下
    d = { ...d, afterId: 'a2' };
    s = commit(s, d, 'a3');
    expect(kids(s, 'p')).toEqual(['a', 'a2', 'a3', 'b']);
  });

  it('FOCUS 顶层：NOW 上回车，新的一条排在 NOW 后面（不抢 NOW）', () => {
    let s: Todo[] = [];
    s = add(s, 'q', 'focus');
    s = add(s, 'now', 'focus');
    s = setNow(s, 'now'); // now q
    s = commit(s, draftAfter(s, 'now')!, 'n2');
    expect(roots(s, 'focus')).toEqual(['now', 'n2', 'q']);
    expect(nowOf(s)?.id).toBe('now');
  });

  it('已完成的条目上回车：空行排在这一层未完成的最后', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'goal');
    s = add(s, 'a', 'goal', 'p');
    s = add(s, 'b', 'goal', 'p');
    s = completeTodo(s, 'a', 99).todos; // p: b (a 已完成)
    const d = draftAfter(s, 'a')!;
    expect(d.afterId).toBe('b');
    s = commit(s, d, 'c');
    expect(kids(s, 'p')).toEqual(['b', 'c', 'a']);
  });

  it('「添加子任务」：空行在子项最后；没有子项时就是第一个', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'inbox');
    expect(draftChildOf(s, 'p')).toEqual({ list: 'inbox', parentId: 'p', afterId: null });
    s = commit(s, draftChildOf(s, 'p')!, 'a');
    s = commit(s, draftChildOf(s, 'p')!, 'b');
    expect(kids(s, 'p')).toEqual(['a', 'b']);
  });
});

describe('大纲编辑：空行上 Tab / Shift+Tab / 退格', () => {
  it('Tab：空行成为上一条的最后一个子项', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'inbox');
    s = add(s, 'p1', 'inbox', 'p'); // p: p1
    s = add(s, 'q', 'inbox'); // q p
    const d = draftIndent(s, draftAfter(s, 'q')!)!;
    // q 下面还没有子项：空行就是它的第一个
    expect(d).toEqual({ list: 'inbox', parentId: 'q', afterId: null });
    s = commit(s, d, 'q1');
    expect(kids(s, 'q')).toEqual(['q1']);
    // p 已有子项：空行排在 p1 后面
    const d2 = draftIndent(s, draftAfter(s, 'p')!)!;
    expect(d2).toEqual({ list: 'inbox', parentId: 'p', afterId: 'p1' });
    s = commit(s, d2, 'p2');
    expect(kids(s, 'p')).toEqual(['p1', 'p2']);
  });

  it('Tab：这一层最前面的空行没有上一条，不动', () => {
    expect(draftIndent([], { list: 'inbox', parentId: null, afterId: null })).toBeNull();
  });

  it('Shift+Tab：升一级，排在原父项后面；顶层不动', () => {
    let s: Todo[] = [];
    s = add(s, 'r', 'focus');
    s = add(s, 'p', 'focus', 'r');
    s = add(s, 'x', 'focus', 'r'); // r: p x
    s = add(s, 'c', 'focus', 'p'); // p: c
    const d = draftOutdent(s, draftAfter(s, 'c')!)!;
    expect(d).toEqual({ list: 'focus', parentId: 'r', afterId: 'p' });
    s = commit(s, d, 'n');
    expect(kids(s, 'r')).toEqual(['p', 'n', 'x']);
    expect(draftOutdent(s, { list: 'focus', parentId: null, afterId: 'r' })).toBeNull();
  });

  it('Tab 再 Shift+Tab 回到原来的位置', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'goal');
    s = add(s, 'a', 'goal', 'p');
    s = add(s, 'b', 'goal', 'p');
    const d = draftAfter(s, 'a')!;
    expect(draftOutdent(s, draftIndent(s, d)!)).toEqual(d);
  });

  it('退格：回到上一条；最前面的空行回到父项', () => {
    expect(draftBackTarget({ list: 'inbox', parentId: 'p', afterId: 'a' })).toBe('a');
    expect(draftBackTarget({ list: 'inbox', parentId: 'p', afterId: null })).toBe('p');
    expect(draftBackTarget({ list: 'inbox', parentId: null, afterId: null })).toBeNull();
  });

  it('⌥⇧↑↓：空行在同级之间挪一格，到头不动', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'inbox');
    for (const id of ['a', 'b', 'c']) s = add(s, id, 'inbox', 'p');
    const d: Draft = { list: 'inbox', parentId: 'p', afterId: 'b' };
    expect(draftShift(s, d, -1)).toEqual({ ...d, afterId: 'a' });
    expect(draftShift(s, d, 1)).toEqual({ ...d, afterId: 'c' });
    expect(draftShift(s, { ...d, afterId: 'a' }, -1)).toEqual({ ...d, afterId: null });
    expect(draftShift(s, { ...d, afterId: null }, -1)).toBeNull();
    expect(draftShift(s, { ...d, afterId: 'c' }, 1)).toBeNull();
  });
});

describe('大纲编辑：正在编辑的条目', () => {
  it('Tab / Shift+Tab 的边界：同级第一个不能缩进，顶层不能反缩进', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'inbox');
    s = add(s, 'a', 'inbox', 'p');
    s = add(s, 'b', 'inbox', 'p');
    expect(canIndent(s, 'a')).toBe(false);
    expect(canIndent(s, 'b')).toBe(true);
    expect(canOutdent(s, 'p')).toBe(false);
    expect(canOutdent(s, 'a')).toBe(true);
    // 和 model 的实际结果一致
    expect(indentTodo(s, 'a')).toBe(s);
    expect(outdentTodo(s, 'p')).toBe(s);
  });

  it('⌥⇧↑↓：在同级同状态里上移 / 下移，到头不动', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'goal');
    for (const id of ['a', 'b', 'c']) s = add(s, id, 'goal', 'p');
    const up = moveIndex(s, 'b', -1)!;
    s = reorderTodo(s, 'b', up);
    expect(kids(s, 'p')).toEqual(['b', 'a', 'c']);
    s = reorderTodo(s, 'b', moveIndex(s, 'b', 1)!);
    s = reorderTodo(s, 'b', moveIndex(s, 'b', 1)!);
    expect(kids(s, 'p')).toEqual(['a', 'c', 'b']);
    expect(moveIndex(s, 'b', 1)).toBeNull();
    expect(moveIndex(s, 'a', -1)).toBeNull();
    // 顶层同样适用：FOCUS 里上移到第一个就成了 NOW
    let f: Todo[] = [];
    f = add(f, 'x', 'focus');
    f = add(f, 'y', 'focus'); // y x
    f = reorderTodo(f, 'x', moveIndex(f, 'x', -1)!);
    expect(nowOf(f)?.id).toBe('x');
  });
});

describe('空行插进列表', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  it('排在 afterId 后面；afterId 为空或不在这一层时放在最前', () => {
    expect(withDraft(items, { list: 'inbox', parentId: null, afterId: 'a' }, 'inbox', null)).toEqual([{ id: 'a' }, 'draft', { id: 'b' }]);
    expect(withDraft(items, { list: 'inbox', parentId: null, afterId: null }, 'inbox', null)).toEqual(['draft', { id: 'a' }, { id: 'b' }]);
    // FOCUS 顶层：NOW 在卡片里，不在「接下来」这一层
    expect(withDraft(items, { list: 'focus', parentId: null, afterId: 'now' }, 'focus', null)).toEqual(['draft', { id: 'a' }, { id: 'b' }]);
  });
  it('别的层、别的列表不插', () => {
    expect(withDraft(items, { list: 'inbox', parentId: 'p', afterId: null }, 'inbox', null)).toBe(items);
    expect(withDraft(items, { list: 'goal', parentId: null, afterId: null }, 'inbox', null)).toBe(items);
  });
  it('levelOf 和界面顺序一致：未完成在前，子项按创建顺序', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'inbox');
    for (const id of ['a', 'b']) s = add(s, id, 'inbox', 'p');
    s = completeTodo(s, 'a', 1).todos;
    expect(levelOf(s, 'inbox', 'p').map((t) => t.id)).toEqual(['b', 'a']);
  });
});
