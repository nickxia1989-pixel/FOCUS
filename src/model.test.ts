import { describe, expect, it } from 'vitest';
import {
  buildIndex,
  childrenOf,
  completeTodo,
  createTodo,
  deleteTodo,
  markForTest,
  moveTodo,
  nowOf,
  openCount,
  reorderTodo,
  reparentTodo,
  rootsOf,
  sanitize,
  sendToFocus,
  setNow,
  uncompleteTodo,
  unmarkTest,
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

describe('NOW：FOCUS 一次只做一件', () => {
  const focus3 = () => {
    let s: Todo[] = [];
    s = add(s, 'c', 'focus', null, 1);
    s = add(s, 'b', 'focus', null, 2);
    s = add(s, 'a', 'focus', null, 3); // a b c，a 是 NOW
    return s;
  };

  it('新建排在 NOW 之后，不抢掉正在做的那件', () => {
    let s = focus3();
    s = createTodo(s, { id: 'n', title: 'n', list: 'focus', now: 9, placement: 'afterNow' });
    expect(titles(s, 'focus')).toEqual(['a', 'n', 'b', 'c']);
    expect(nowOf(s)?.id).toBe('a');
    // FOCUS 是空的时候直接成为 NOW
    let e: Todo[] = [];
    e = createTodo(e, { id: 'x', title: 'x', list: 'focus', now: 1, placement: 'afterNow' });
    expect(nowOf(e)?.id).toBe('x');
    // 子项不受影响
    s = createTodo(s, { id: 'k', title: 'k', list: 'focus', parentId: 'b', now: 10, placement: 'afterNow' });
    expect(s.find((t) => t.id === 'k')?.parentId).toBe('b');
  });

  it('完成的 NOW 不算：已完成的排在后面，下一件接替', () => {
    let s = focus3();
    s = completeTodo(s, 'a', 10).todos; // FOCUS 顶层完成后进 INBOX
    expect(nowOf(s)?.id).toBe('b');
    s = createTodo(s, { id: 'n', title: 'n', list: 'focus', now: 11, placement: 'afterNow' });
    expect(titles(s, 'focus')).toEqual(['b', 'n', 'c']);
  });

  it('送进 FOCUS：整棵移过来，排在 NOW 之后', () => {
    let s = focus3();
    s = add(s, 'i', 'inbox', null, 50);
    s = add(s, 'ic', 'inbox', 'i', 51);
    s = sendToFocus(s, 'i');
    expect(titles(s, 'focus')).toEqual(['a', 'i', 'b', 'c']);
    expect(s.find((t) => t.id === 'ic')?.list).toBe('focus');
    // 已经在 FOCUS 顶层的原样返回
    expect(sendToFocus(s, 'b')).toBe(s);
  });

  it('设为现在：移到 FOCUS 第 1 位；别的列表、子项、已完成的都先归位', () => {
    let s = focus3();
    s = setNow(s, 'c');
    expect(titles(s, 'focus')).toEqual(['c', 'a', 'b']);
    s = add(s, 'g', 'goal', null, 60);
    s = setNow(s, 'g');
    expect(nowOf(s)?.id).toBe('g');
    s = add(s, 'sub', 'focus', 'a', 61);
    s = setNow(s, 'sub');
    expect(nowOf(s)?.id).toBe('sub');
    expect(s.find((t) => t.id === 'sub')?.parentId).toBeNull();
    s = completeTodo(s, 'b', 70).todos;
    s = setNow(s, 'b');
    expect(nowOf(s)?.id).toBe('b');
    expect(s.find((t) => t.id === 'b')?.done).toBe(false);
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

  it('改挂父项：子孙跟着走，列表跟随新父项，排在最前，折叠的父项自动展开', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'goal');
    s = add(s, 'old', 'goal', 'p');
    s = add(s, 'x', 'inbox');
    s = add(s, 'xc', 'inbox', 'x');
    s = s.map((t) => (t.id === 'p' ? { ...t, collapsed: true } : t));
    s = reparentTodo(s, 'x', 'p');
    const idx = buildIndex(s);
    expect(childrenOf(idx, 'p').map((t) => t.id)).toEqual(['x', 'old']);
    expect(s.find((t) => t.id === 'x')!.list).toBe('goal');
    expect(s.find((t) => t.id === 'xc')!.list).toBe('goal');
    expect(s.find((t) => t.id === 'xc')!.parentId).toBe('x');
    expect(s.find((t) => t.id === 'p')!.collapsed).toBe(false);
    expect(titles(s, 'inbox')).toEqual([]);
  });

  it('改挂父项：不能挂到自己或自己的子孙下', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'goal');
    s = add(s, 'c', 'goal', 'p');
    s = add(s, 'g', 'goal', 'c');
    expect(reparentTodo(s, 'p', 'g')).toBe(s);
    expect(reparentTodo(s, 'p', 'p')).toBe(s);
    expect(reparentTodo(s, 'c', 'p')).toBe(s);
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

describe('VERIFY 待测规则', () => {
  it('标为待测：整棵移到 VERIFY，该项回到未完成，子项状态不变', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'focus');
    s = add(s, 'c1', 'focus', 'p');
    s = completeTodo(s, 'c1', 5).todos;
    s = moveTodo(s, 'p', 'verify');
    expect(titles(s, 'verify')).toEqual(['p']);
    expect(s.find((t) => t.id === 'c1')).toMatchObject({ list: 'verify', parentId: 'p', done: true });
    expect(openCount(s, 'focus')).toBe(0);
  });

  it('已完成的项标为待测后变回未完成', () => {
    let s: Todo[] = [];
    s = add(s, 'a', 'inbox');
    s = completeTodo(s, 'a', 5).todos;
    s = moveTodo(s, 'a', 'verify');
    expect(s[0]).toMatchObject({ list: 'verify', done: false, completedAt: null });
  });

  it('顶层项标为待测：移进 VERIFY', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'focus');
    s = markForTest(s, 'p');
    expect(titles(s, 'verify')).toEqual(['p']);
    expect(s[0].testing).toBeFalsy();
  });

  it('子项标为待测：留在父项下、不换页签，只打标记', () => {
    let s: Todo[] = [];
    s = add(s, 'g', 'focus');
    s = add(s, 'step', 'focus', 'g');
    s = completeTodo(s, 'step', 5).todos;
    s = markForTest(s, 'step');
    expect(s.find((t) => t.id === 'step')).toMatchObject({
      list: 'focus',
      parentId: 'g',
      testing: true,
      done: false,
    });
    expect(titles(s, 'verify')).toEqual([]);
    s = unmarkTest(s, 'step');
    expect(s.find((t) => t.id === 'step')!.testing).toBe(false);
  });

  it('待测子项测完勾掉：清除标记、仍留在原处', () => {
    let s: Todo[] = [];
    s = add(s, 'g', 'focus');
    s = add(s, 'step', 'focus', 'g');
    s = markForTest(s, 'step');
    const r = completeTodo(s, 'step', 9);
    expect(r.movedTo).toBeNull();
    expect(r.todos.find((t) => t.id === 'step')).toMatchObject({ list: 'focus', parentId: 'g', done: true, testing: false });
  });

  it('父项带着待测子项进 VERIFY 时，子项的标记保留', () => {
    let s: Todo[] = [];
    s = add(s, 'g', 'focus');
    s = add(s, 'step', 'focus', 'g');
    s = markForTest(s, 'step');
    s = markForTest(s, 'g');
    expect(s.find((t) => t.id === 'step')).toMatchObject({ list: 'verify', parentId: 'g', testing: true });
  });

  it('VERIFY 顶层项测完勾掉后整棵进入 INBOX 已完成', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'verify');
    s = add(s, 'c1', 'verify', 'p');
    const r = completeTodo(s, 'p', 50);
    expect(r.movedTo).toBe('inbox');
    expect(r.todos.every((t) => t.list === 'inbox' && t.done)).toBe(true);
    expect(titles(r.todos, 'inbox')).toEqual(['p']);
  });

  it('VERIFY 里的子项勾掉后留在父项下', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'verify');
    s = add(s, 'c1', 'verify', 'p');
    const r = completeTodo(s, 'c1', 50);
    expect(r.movedTo).toBeNull();
    expect(r.todos.find((t) => t.id === 'c1')).toMatchObject({ list: 'verify', done: true });
  });

  it('旧数据里的 verify 列表能被正常读入', () => {
    const s = sanitize([{ id: 'v', title: 'v', list: 'verify', parentId: null, createdAt: 1 }]);
    expect(s[0].list).toBe('verify');
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
