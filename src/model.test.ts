import { describe, expect, it } from 'vitest';
import {
  buildIndex,
  childrenOf,
  completeTodo,
  createTodo,
  deleteTodo,
  focusTodo,
  markForTest,
  indentTodo,
  migrateZone,
  moveTodo,
  nowOf,
  outdentTodo,
  openCount,
  queueOf,
  reorderTodo,
  reparentTodo,
  rootsOf,
  sanitize,
  sendToFocus,
  setNow,
  uncompleteTodo,
  unfocusTodo,
  unmarkTest,
  zoneOf,
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

describe('聚焦区：FOCUS 里同时盯着的几件事', () => {
  /** a b c，a 在聚焦区 */
  const focus3 = () => {
    let s: Todo[] = [];
    s = add(s, 'c', 'focus', null, 1);
    s = add(s, 'b', 'focus', null, 2);
    s = add(s, 'a', 'focus', null, 3);
    return focusTodo(s, 'a');
  };
  const zone = (s: Todo[]) => zoneOf(s).map((t) => t.id);
  const queue = (s: Todo[]) => queueOf(s).map((t) => t.id);
  /** 聚焦区的 order 都比「接下来」的大：没升级的旧版本把聚焦区第一件当 NOW */
  const ordered = (s: Todo[]) => {
    const z = zoneOf(s).map((t) => t.order);
    const q = queueOf(s).map((t) => t.order);
    return !z.length || !q.length || Math.min(...z) > Math.max(...q);
  };

  it('新建排在聚焦区后面，不打乱正在盯着的事；FOCUS 空着时直接进聚焦区', () => {
    let s = focus3();
    s = createTodo(s, { id: 'n', title: 'n', list: 'focus', now: 9, placement: 'afterNow' });
    expect(titles(s, 'focus')).toEqual(['a', 'n', 'b', 'c']);
    expect(zone(s)).toEqual(['a']);
    expect(nowOf(s)?.id).toBe('a');
    // ⌘↵：新建并放进聚焦区最前
    s = createTodo(s, { id: 't', title: 't', list: 'focus', now: 10, placement: 'top' });
    expect(zone(s)).toEqual(['t', 'a']);
    expect(ordered(s)).toBe(true);
    // FOCUS 是空的时候直接进聚焦区
    let e: Todo[] = [];
    e = createTodo(e, { id: 'x', title: 'x', list: 'focus', now: 1, placement: 'afterNow' });
    expect(nowOf(e)?.id).toBe('x');
    // 子项不受影响
    s = createTodo(s, { id: 'k', title: 'k', list: 'focus', parentId: 'b', now: 11, placement: 'afterNow' });
    expect(s.find((t) => t.id === 'k')?.parentId).toBe('b');
    expect(s.find((t) => t.id === 'k')?.focused).toBeUndefined();
  });

  it('聚焦区最后一件做完后空着，不自动补下一件', () => {
    let s = focus3();
    s = completeTodo(s, 'a', 10).todos; // FOCUS 顶层完成后进 INBOX，也离开聚焦区
    expect(nowOf(s)).toBeNull();
    expect(s.find((t) => t.id === 'a')?.focused).toBeUndefined();
    expect(queue(s)).toEqual(['b', 'c']);
    s = createTodo(s, { id: 'n', title: 'n', list: 'focus', now: 11, placement: 'afterNow' });
    expect(zone(s)).toEqual([]);
    expect(titles(s, 'focus')).toEqual(['n', 'b', 'c']);
  });

  it('送进 FOCUS：整棵移过来，排在聚焦区后面；FOCUS 空着时直接进聚焦区', () => {
    let s = focus3();
    s = add(s, 'i', 'inbox', null, 50);
    s = add(s, 'ic', 'inbox', 'i', 51);
    s = sendToFocus(s, 'i');
    expect(titles(s, 'focus')).toEqual(['a', 'i', 'b', 'c']);
    expect(zone(s)).toEqual(['a']);
    expect(s.find((t) => t.id === 'ic')?.list).toBe('focus');
    expect(ordered(s)).toBe(true);
    // 已经在 FOCUS 顶层的原样返回
    expect(sendToFocus(s, 'b')).toBe(s);
    let e: Todo[] = [];
    e = add(e, 'j', 'inbox');
    e = sendToFocus(e, 'j');
    expect(nowOf(e)?.id).toBe('j');
  });

  it('设为现在：放进聚焦区最前；别的列表、子项、已完成的都先归位', () => {
    let s = focus3();
    s = setNow(s, 'c');
    expect(titles(s, 'focus')).toEqual(['c', 'a', 'b']);
    expect(zone(s)).toEqual(['c', 'a']);
    expect(ordered(s)).toBe(true);
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

  it('放进 / 移出聚焦区：可以指定排第几，顺序始终是聚焦区在前', () => {
    let s = focus3(); // [a] b c
    s = focusTodo(s, 'c'); // 不给位置就排最后
    expect(zone(s)).toEqual(['a', 'c']);
    s = focusTodo(s, 'b', 1);
    expect(zone(s)).toEqual(['a', 'b', 'c']);
    expect(queue(s)).toEqual([]);
    s = unfocusTodo(s, 'b');
    expect(zone(s)).toEqual(['a', 'c']);
    expect(queue(s)).toEqual(['b']);
    expect(ordered(s)).toBe(true);
    // 不在聚焦区的移出时原样返回；别的列表的放进来时整棵移进 FOCUS
    expect(unfocusTodo(s, 'b')).toBe(s);
    s = add(s, 'g', 'goal', null, 60);
    s = add(s, 'gc', 'goal', 'g', 61);
    s = focusTodo(s, 'g', 0);
    expect(zone(s)).toEqual(['g', 'a', 'c']);
    expect(s.find((t) => t.id === 'gc')?.list).toBe('focus');
    expect(ordered(s)).toBe(true);
  });

  it('排序：不指定时落在聚焦区那一段就进，落在后面就出，正好在分界上保持原样', () => {
    let s = focus3(); // [a] b c
    s = focusTodo(s, 'b'); // [a b] c
    // c 拖到第 0 位：进聚焦区
    let r = reorderTodo(s, 'c', 0);
    expect(zone(r)).toEqual(['c', 'a', 'b']);
    // a 拖到最后：出聚焦区
    r = reorderTodo(s, 'a', 2);
    expect(zone(r)).toEqual(['b']);
    expect(queue(r)).toEqual(['c', 'a']);
    // 分界上：c 还在「接下来」第一位，b 还在聚焦区最后
    expect(reorderTodo(s, 'c', 2)).toBe(s);
    expect(reorderTodo(s, 'b', 1)).toBe(s);
    // 明确指定：同一个分界位置上进 / 出
    r = reorderTodo(s, 'c', 2, true);
    expect(zone(r)).toEqual(['a', 'b', 'c']);
    r = reorderTodo(s, 'b', 1, false);
    expect(zone(r)).toEqual(['a']);
    expect(queue(r)).toEqual(['b', 'c']);
    expect(ordered(r)).toBe(true);
    // 指定的位置越界时夹在那一段里
    r = reorderTodo(s, 'c', 0, false);
    expect(queue(r)).toEqual(['c']);
  });

  it('离开 FOCUS 顶层就离开聚焦区；聚焦项的子项升成顶层时留在聚焦区', () => {
    let s = focus3(); // [a] b c
    s = add(s, 'a1', 'focus', 'a', 10);
    s = add(s, 'b1', 'focus', 'b', 11);
    // 子项升成顶层：跟着原父项
    let r = outdentTodo(s, 'a1');
    expect(zone(r)).toEqual(['a', 'a1']);
    r = outdentTodo(s, 'b1');
    expect(zone(r)).toEqual(['a']);
    expect(queue(r)).toEqual(['b', 'b1', 'c']);
    // 送去验证、移到别的列表、缩进成子项：都去掉标记
    expect(markForTest(s, 'a').find((t) => t.id === 'a')?.focused).toBeUndefined();
    expect(moveTodo(s, 'a', 'goal').find((t) => t.id === 'a')?.focused).toBeUndefined();
    r = focusTodo(s, 'b'); // [a b] c
    r = indentTodo(r, 'b');
    expect(r.find((t) => t.id === 'b')?.parentId).toBe('a');
    expect(r.find((t) => t.id === 'b')?.focused).toBeUndefined();
    expect(zone(r)).toEqual(['a']);
    // 编辑时在聚焦项后面回车：新的一条也在聚焦区
    r = createTodo(s, { id: 'n', title: 'n', list: 'focus', now: 20, placement: { after: 'a' } });
    expect(zone(r)).toEqual(['a', 'n']);
    r = createTodo(s, { id: 'n', title: 'n', list: 'focus', now: 20, placement: { after: 'b' } });
    expect(queue(r)).toEqual(['b', 'n', 'c']);
  });

  it('多端并发把顺序弄乱（「接下来」的 order 比聚焦区大）时，下一次排序重新编号', () => {
    let s = focus3(); // [a] b c
    // 旧版本「设为现在」只改 order：c 的 order 跑到最大，但不在聚焦区
    s = s.map((t) => (t.id === 'c' ? { ...t, order: 100 } : t));
    expect(zone(s)).toEqual(['a']);
    expect(queue(s)).toEqual(['c', 'b']);
    expect(ordered(s)).toBe(false);
    s = reorderTodo(s, 'b', 0, false);
    expect(queue(s)).toEqual(['b', 'c']);
    expect(ordered(s)).toBe(true);
  });

  it('读入时只在 FOCUS 顶层留聚焦标记；升级时把原来的 NOW 放进聚焦区', () => {
    const raw = [
      { id: 'f', title: 'f', list: 'focus', parentId: null, order: 3, focused: true },
      { id: 'k', title: 'k', list: 'focus', parentId: 'f', order: 1, focused: true },
      { id: 'i', title: 'i', list: 'inbox', parentId: null, order: 2, focused: true },
    ];
    const t = sanitize(raw);
    expect(t.filter((x) => x.focused).map((x) => x.id)).toEqual(['f']);
    // 迁移：没有一件在聚焦区时，手动顺序排第一的那件进去
    let s: Todo[] = [];
    s = add(s, 'q', 'focus', null, 1);
    s = add(s, 'p', 'focus', null, 2);
    s = migrateZone(s);
    expect(zone(s)).toEqual(['p']);
    expect(migrateZone(s)).toBe(s);
    expect(migrateZone([])).toEqual([]);
  });
});

describe('子项顺序与缩进', () => {
  const kids = (s: Todo[], id: string) => childrenOf(buildIndex(s), id).map((t) => t.title);

  it('子项按创建顺序排，新建的在最后；顶层仍是新建的在前', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'inbox', null, 1);
    s = add(s, '1', 'inbox', 'p', 2);
    s = add(s, '2', 'inbox', 'p', 3);
    s = add(s, '3', 'inbox', 'p', 4);
    expect(kids(s, 'p')).toEqual(['1', '2', '3']);
    s = add(s, 'q', 'inbox', null, 5);
    expect(titles(s, 'inbox')).toEqual(['q', 'p']);
    // 拖动排序在升序的组里也只改被拖的那一项
    s = reorderTodo(s, '3', 0);
    expect(kids(s, 'p')).toEqual(['3', '1', '2']);
    s = reorderTodo(s, '3', 2);
    expect(kids(s, 'p')).toEqual(['1', '2', '3']);
    // 完成的子项排到后面
    s = completeTodo(s, '1', 10).todos;
    expect(kids(s, 'p')).toEqual(['2', '3', '1']);
    // 回车新建：紧跟在当前这条后面；'top' 排到第一个
    s = createTodo(s, { id: '2b', title: '2b', list: 'inbox', parentId: 'p', now: 11, placement: { after: '2' } });
    expect(kids(s, 'p')).toEqual(['2', '2b', '3', '1']);
    s = createTodo(s, { id: '0', title: '0', list: 'inbox', parentId: 'p', now: 12, placement: 'top' });
    expect(kids(s, 'p')).toEqual(['0', '2', '2b', '3', '1']);
  });

  it('order 相同的子项拖动时整组重新编号，顺序仍正确', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'goal', null, 1);
    for (const n of ['a', 'b', 'c']) s = add(s, n, 'goal', 'p', 2);
    s = s.map((t) => (t.parentId === 'p' ? { ...t, order: 7 } : t));
    const before = kids(s, 'p');
    s = reorderTodo(s, before[0], 2);
    expect(kids(s, 'p')).toEqual([before[1], before[2], before[0]]);
  });

  it('Tab：挂到上一个同级下面，成为它的最后一个子项；第一个按 Tab 不动', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'focus', null, 1);
    s = add(s, 'a', 'focus', 'p', 2);
    s = add(s, 'b', 'focus', 'p', 3);
    s = add(s, 'a1', 'focus', 'a', 4);
    s = add(s, 'bc', 'focus', 'b', 5);
    expect(indentTodo(s, 'a')).toBe(s);
    s = indentTodo(s, 'b');
    expect(kids(s, 'p')).toEqual(['a']);
    expect(kids(s, 'a')).toEqual(['a1', 'b']);
    expect(kids(s, 'b')).toEqual(['bc']); // 子孙跟着走
    // 顶层项也能缩进：成为上一个顶层项的子项
    s = add(s, 'r1', 'inbox', null, 6);
    s = add(s, 'r2', 'inbox', null, 7); // r2 r1
    s = indentTodo(s, 'r1');
    expect(titles(s, 'inbox')).toEqual(['r2']);
    expect(kids(s, 'r2')).toEqual(['r1']);
  });

  it('Shift+Tab：升一级，排在原父项紧后面；后面的兄弟留在原处；顶层不动', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'focus', null, 1);
    s = add(s, 'a', 'focus', 'p', 2);
    s = add(s, 'b', 'focus', 'a', 3);
    s = add(s, 'c', 'focus', 'a', 4);
    s = add(s, 'd', 'focus', 'p', 5); // p: a(b, c), d
    expect(outdentTodo(s, 'p')).toBe(s);
    s = outdentTodo(s, 'b');
    expect(kids(s, 'p')).toEqual(['a', 'b', 'd']);
    expect(kids(s, 'a')).toEqual(['c']);
    // 升成顶层：排在原根项后面（FOCUS 里就是 NOW 之后）
    s = add(s, 'q', 'focus', null, 6);
    s = setNow(s, 'p'); // p q
    s = outdentTodo(s, 'd');
    expect(titles(s, 'focus')).toEqual(['p', 'd', 'q']);
    expect(nowOf(s)?.id).toBe('p');
    // Tab 再 Shift+Tab 回到原来的层级
    s = indentTodo(s, 'd');
    expect(kids(s, 'p')).toEqual(['a', 'b', 'd']);
  });

  it('VERIFY 里缩进 / 反缩进时保住「待验证」', () => {
    let s: Todo[] = [];
    s = add(s, 'v1', 'verify', null, 1);
    s = add(s, 'v2', 'verify', null, 2); // v2 v1
    s = indentTodo(s, 'v1');
    expect(s.find((t) => t.id === 'v1')!.testing).toBe(true);
    s = outdentTodo(s, 'v1');
    expect(s.find((t) => t.id === 'v1')).toMatchObject({ parentId: null, testing: false });
    expect(titles(s, 'verify')).toEqual(['v2', 'v1']);
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

  it('改挂父项：子孙跟着走，列表跟随新父项，排在最后，折叠的父项自动展开', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'goal');
    s = add(s, 'old', 'goal', 'p');
    s = add(s, 'x', 'inbox');
    s = add(s, 'xc', 'inbox', 'x');
    s = s.map((t) => (t.id === 'p' ? { ...t, collapsed: true } : t));
    s = reparentTodo(s, 'x', 'p');
    const idx = buildIndex(s);
    expect(childrenOf(idx, 'p').map((t) => t.id)).toEqual(['old', 'x']);
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
