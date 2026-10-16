import { describe, expect, it } from 'vitest';
import {
  buildIndex,
  childrenOf,
  completeTodo,
  createTodo,
  deleteTodo,
  moveTodo,
  openCount,
  reorderTodo,
  rootsOf,
  sanitize,
  uncompleteTodo,
} from './model';
import type { ListId, Todo } from './types';

let seq = 0;
function add(todos: Todo[], title: string, list: ListId, parentId: string | null = null, now = 1000 + seq) {
  seq++;
  return createTodo(todos, { id: title, title, list, parentId, now });
}

function titles(todos: Todo[], list: ListId) {
  return rootsOf(buildIndex(todos), list).map((t) => t.title);
}

describe('排序', () => {
  it('未完成在前，同状态新建的在前', () => {
    let s: Todo[] = [];
    s = add(s, 'a', 'inbox', null, 1);
    s = add(s, 'b', 'inbox', null, 2);
    s = add(s, 'c', 'inbox', null, 3);
    expect(titles(s, 'inbox')).toEqual(['c', 'b', 'a']);
    s = completeTodo(s, 'c', 10).todos;
    expect(titles(s, 'inbox')).toEqual(['b', 'a', 'c']);
    s = uncompleteTodo(s, 'c');
    expect(titles(s, 'inbox')).toEqual(['c', 'b', 'a']);
  });

  it('手动拖动只在同状态组内生效', () => {
    let s: Todo[] = [];
    for (const [i, n] of ['a', 'b', 'c', 'd'].entries()) s = add(s, n, 'goal', null, i + 1);
    s = completeTodo(s, 'a', 10).todos; // d c b | a
    s = reorderTodo(s, 'd', 2); // c b d | a
    expect(titles(s, 'goal')).toEqual(['c', 'b', 'd', 'a']);
    s = reorderTodo(s, 'b', 0); // b c d | a
    expect(titles(s, 'goal')).toEqual(['b', 'c', 'd', 'a']);
    // 新建项仍然排在最前
    s = add(s, 'e', 'goal', null, 5);
    expect(titles(s, 'goal')).toEqual(['e', 'b', 'c', 'd', 'a']);
  });

  it('order 相同时拖动结果仍然稳定', () => {
    let s: Todo[] = [];
    s = add(s, 'a', 'inbox', null, 5);
    s = add(s, 'b', 'inbox', null, 5);
    s = add(s, 'c', 'inbox', null, 5);
    s = s.map((t) => ({ ...t, order: 5 }));
    const before = titles(s, 'inbox');
    s = reorderTodo(s, before[2], 0);
    expect(titles(s, 'inbox')).toEqual([before[2], before[0], before[1]]);
  });
});

describe('子 TODO', () => {
  it('挂在父项下，并跟随父项列表', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'goal');
    s = add(s, 'c1', 'inbox', 'p');
    s = add(s, 'g1', 'focus', 'c1');
    const idx = buildIndex(s);
    expect(childrenOf(idx, 'p').map((t) => t.title)).toEqual(['c1']);
    expect(s.every((t) => t.list === 'goal')).toBe(true);
    expect(rootsOf(idx, 'goal').map((t) => t.title)).toEqual(['p']);
  });

  it('移动父项时子孙一起移动', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'inbox');
    s = add(s, 'c1', 'inbox', 'p');
    s = add(s, 'g1', 'inbox', 'c1');
    s = moveTodo(s, 'p', 'focus');
    expect(s.every((t) => t.list === 'focus')).toBe(true);
    expect(s.find((t) => t.id === 'g1')!.parentId).toBe('c1');
  });

  it('单独移动子项会脱离父项成为顶层', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'goal');
    s = add(s, 'c1', 'goal', 'p');
    s = add(s, 'g1', 'goal', 'c1');
    s = moveTodo(s, 'c1', 'focus');
    expect(titles(s, 'focus')).toEqual(['c1']);
    expect(s.find((t) => t.id === 'g1')!.list).toBe('focus');
    expect(childrenOf(buildIndex(s), 'p')).toEqual([]);
  });

  it('完成父项时子孙一并完成，取消完成只影响自身', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'goal');
    s = add(s, 'c1', 'goal', 'p');
    s = add(s, 'c2', 'goal', 'p');
    s = completeTodo(s, 'p', 99).todos;
    expect(s.every((t) => t.done)).toBe(true);
    s = uncompleteTodo(s, 'p');
    expect(s.find((t) => t.id === 'p')!.done).toBe(false);
    expect(s.find((t) => t.id === 'c1')!.done).toBe(true);
  });

  it('删除父项会删掉整棵子树', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'goal');
    s = add(s, 'c1', 'goal', 'p');
    s = add(s, 'g1', 'goal', 'c1');
    s = add(s, 'x', 'goal');
    expect(deleteTodo(s, 'p').map((t) => t.id)).toEqual(['x']);
  });
});

describe('FOCUS 完成规则', () => {
  it('FOCUS 顶层项完成后整棵移到 INBOX', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'focus');
    s = add(s, 'c1', 'focus', 'p');
    const r = completeTodo(s, 'p', 50);
    expect(r.movedTo).toBe('inbox');
    expect(r.todos.every((t) => t.list === 'inbox' && t.done)).toBe(true);
    expect(openCount(r.todos, 'focus')).toBe(0);
  });

  it('FOCUS 里的子项完成后留在父项下', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'focus');
    s = add(s, 'c1', 'focus', 'p');
    const r = completeTodo(s, 'c1', 50);
    expect(r.movedTo).toBeNull();
    expect(r.todos.find((t) => t.id === 'c1')).toMatchObject({ list: 'focus', parentId: 'p', done: true });
  });

  it('其它列表完成后留在原列表', () => {
    let s: Todo[] = [];
    s = add(s, 'a', 'inbox');
    s = add(s, 'g', 'goal');
    s = completeTodo(s, 'a', 1).todos;
    s = completeTodo(s, 'g', 1).todos;
    expect(s.map((t) => t.list)).toEqual(['inbox', 'goal']);
  });
});

describe('sanitize', () => {
  it('修复孤儿、环和父子列表不一致', () => {
    const raw = [
      { id: 'a', title: 'a', list: 'goal', parentId: null, createdAt: 1, order: 1 },
      { id: 'b', title: 'b', list: 'focus', parentId: 'a', createdAt: 2, order: 2 },
      { id: 'c', title: 'c', list: 'inbox', parentId: 'missing', createdAt: 3, order: 3 },
      { id: 'd', title: 'd', list: 'inbox', parentId: 'e', createdAt: 4 },
      { id: 'e', title: 'e', list: 'inbox', parentId: 'd', createdAt: 5 },
      { nope: true },
    ];
    const s = sanitize(raw);
    expect(s).toHaveLength(5);
    expect(s.find((t) => t.id === 'b')!.list).toBe('goal');
    expect(s.find((t) => t.id === 'c')!.parentId).toBeNull();
    const d = s.find((t) => t.id === 'd')!;
    const e = s.find((t) => t.id === 'e')!;
    expect(d.parentId === null || e.parentId === null).toBe(true);
    expect(d.order).toBe(4);
  });
});
