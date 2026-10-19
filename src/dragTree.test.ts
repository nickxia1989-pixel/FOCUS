import { describe, expect, it } from 'vitest';
import { MAX_DEPTH, depthRange, originGap, projectDrop, restRows, type DragRow } from './dragTree';
import { buildIndex, childrenOf, completeTodo, createTodo, focusTodo, nowOf, placeTodo, rootsOf, zoneOf } from './model';
import type { ListId, Todo } from './types';

let seq = 0;
function add(todos: Todo[], title: string, list: ListId, parentId: string | null = null) {
  seq++;
  return createTodo(todos, { id: title, title, list, parentId, now: 1000 + seq });
}

/** 按界面的显示顺序摊平（collapsed 里的不展开） */
function flatten(todos: Todo[], list: ListId, collapsed: Set<string> = new Set()): DragRow[] {
  const idx = buildIndex(todos);
  const out: DragRow[] = [];
  const walk = (t: Todo, depth: number) => {
    const kids = childrenOf(idx, t.id);
    const folded = collapsed.has(t.id) && kids.length > 0;
    out.push({ id: t.id, depth, parentId: t.parentId, list: t.list, done: t.done, collapsed: folded });
    if (!folded) for (const k of kids) walk(k, depth + 1);
  };
  for (const r of rootsOf(idx, list)) walk(r, 0);
  return out;
}

const shape = (todos: Todo[], list: ListId) =>
  flatten(todos, list)
    .map((r) => `${'  '.repeat(r.depth)}${r.id}`)
    .join('\n');

/** 拖 id 到 rest 里的第 gap 个空隙、想要 depth 级，然后真正放下 */
function drop(todos: Todo[], list: ListId, id: string, gap: number, depth: number, collapsed?: Set<string>) {
  const p = projectDrop(flatten(todos, list, collapsed), id, gap, depth)!;
  expect(p).not.toBeNull();
  return { p, todos: placeTodo(todos, id, p) };
}

// A
//   A1
//     A1a
//   A2
// B
//   B1
// C
function sample() {
  let s: Todo[] = [];
  s = add(s, 'C', 'inbox');
  s = add(s, 'B', 'inbox');
  s = add(s, 'A', 'inbox');
  s = add(s, 'A1', 'inbox', 'A');
  s = add(s, 'A2', 'inbox', 'A');
  s = add(s, 'A1a', 'inbox', 'A1');
  s = add(s, 'B1', 'inbox', 'B');
  return s;
}

describe('自由拖拽：落点算法', () => {
  it('样例树的摊平顺序', () => {
    expect(shape(sample(), 'inbox')).toBe(['A', '  A1', '    A1a', '  A2', 'B', '  B1', 'C'].join('\n'));
  });

  it('拿掉被拖的那一项连同子孙；原位空隙', () => {
    const rows = flatten(sample(), 'inbox');
    expect(restRows(rows, 'A1').map((r) => r.id)).toEqual(['A', 'A2', 'B', 'B1', 'C']);
    expect(originGap(rows, 'A2')).toBe(3);
  });

  it('空隙允许的深度：最深是上一行 + 1，最浅是下一行', () => {
    const rest = restRows(flatten(sample(), 'inbox'), 'C');
    expect(depthRange(rest, 0)).toEqual({ min: 0, max: 0 });
    expect(depthRange(rest, 1)).toEqual({ min: 1, max: 1 }); // A 和 A1 之间只能当 A 的子项
    expect(depthRange(rest, 3)).toEqual({ min: 1, max: 3 }); // A1a 和 A2 之间
    expect(depthRange(rest, rest.length)).toEqual({ min: 0, max: 2 }); // 最后：B1 下面
  });

  it('子子项往左拖成子项', () => {
    const { todos } = drop(sample(), 'inbox', 'A1a', 2, 1); // rest：A A1 | A2 …
    expect(shape(todos, 'inbox')).toBe(['A', '  A1', '  A1a', '  A2', 'B', '  B1', 'C'].join('\n'));
  });

  it('子子项拖到最外面成顶层', () => {
    const { todos } = drop(sample(), 'inbox', 'A1a', 6, 0);
    expect(rootsOf(buildIndex(todos), 'inbox').map((t) => t.id)).toEqual(['A', 'B', 'C', 'A1a']);
  });

  it('外面的项拖进子项下面、子子项下面', () => {
    let { todos } = drop(sample(), 'inbox', 'C', 6, 2); // B1 下面再往右一级
    expect(childrenOf(buildIndex(todos), 'B1').map((t) => t.id)).toEqual(['C']);
    ({ todos } = drop(sample(), 'inbox', 'C', 3, 2)); // A1a 下面、和 A1a 同级
    expect(childrenOf(buildIndex(todos), 'A1').map((t) => t.id)).toEqual(['A1a', 'C']);
    ({ todos } = drop(sample(), 'inbox', 'C', 3, 3)); // A1a 下面再往右一级：成为 A1a 的子项
    expect(childrenOf(buildIndex(todos), 'A1a').map((t) => t.id)).toEqual(['C']);
  });

  it('整棵带着子孙挪；拖到父项和第一个子项之间时被夹成第一个子项', () => {
    const { todos } = drop(sample(), 'inbox', 'B', 1, 0); // 想要顶层，但 A 和 A1 之间最浅是 1
    expect(shape(todos, 'inbox')).toBe(['A', '  B', '    B1', '  A1', '    A1a', '  A2', 'C'].join('\n'));
  });

  it('深度超出范围时夹住；最多 MAX_DEPTH 级', () => {
    const p = projectDrop(flatten(sample(), 'inbox'), 'C', 6, 99)!;
    expect(p.depth).toBe(2);
    expect(projectDrop(flatten(sample(), 'inbox'), 'C', 0, -5)!.depth).toBe(0);
    let s: Todo[] = [];
    s = add(s, 'x', 'goal');
    s = add(s, 'r', 'goal');
    let parent = 'r';
    for (let i = 0; i < MAX_DEPTH; i++) {
      s = add(s, `d${i}`, 'goal', parent);
      parent = `d${i}`;
    }
    const rows = flatten(s, 'goal');
    const p2 = projectDrop(rows, 'x', restRows(rows, 'x').length, 99)!;
    expect(p2.depth).toBe(MAX_DEPTH);
  });

  it('落回原处标记 unchanged', () => {
    const s = sample();
    const rows = flatten(s, 'inbox');
    const p = projectDrop(rows, 'A2', originGap(rows, 'A2'), 1)!;
    expect(p.unchanged).toBe(true);
    expect(placeTodo(s, 'A2', p)).toBe(s);
    expect(projectDrop(rows, 'A2', originGap(rows, 'A2'), 2)!.unchanged).toBe(false); // 往右一级就变成 A1a 的兄弟
  });

  it('折叠着的父项：落到它下面一级时排到子项最后，并自动展开', () => {
    const folded = new Set(['B']);
    const { todos } = drop(sample(), 'inbox', 'C', 5, 1, folded); // rest：A A1 A1a A2 B(折叠) |
    expect(childrenOf(buildIndex(todos), 'B').map((t) => t.id)).toEqual(['B1', 'C']);
  });

  it('已完成的兄弟不占未完成的位置', () => {
    let s: Todo[] = [];
    s = add(s, 'P', 'goal');
    s = add(s, 'o1', 'goal', 'P');
    s = add(s, 'o2', 'goal', 'P');
    s = add(s, 'd1', 'goal', 'P');
    s = completeTodo(s, 'd1', 5000).todos;
    const { todos } = drop(s, 'goal', 'o1', 3, 1); // rest：P o2 d1 |
    expect(childrenOf(buildIndex(todos), 'P').map((t) => t.id)).toEqual(['o2', 'o1', 'd1']);
  });

  it('FOCUS：不指定时落在聚焦区那一段就进聚焦区，分界上保持原样（手机端拖动走这里）', () => {
    let s: Todo[] = [];
    s = add(s, 'q2', 'focus');
    s = add(s, 'q1', 'focus');
    s = add(s, 'now', 'focus');
    s = add(s, 'sub', 'focus', 'now');
    s = focusTodo(s, 'now'); // [now] q1 q2
    let { todos } = drop(s, 'focus', 'q2', 0, 0);
    expect(nowOf(todos)?.id).toBe('q2');
    expect(zoneOf(todos).map((t) => t.id)).toEqual(['q2', 'now']);
    // 聚焦项的子任务拖出来成「接下来」的第一项
    ({ todos } = drop(s, 'focus', 'sub', 1, 0)); // rest：now | q1 q2
    expect(rootsOf(buildIndex(todos), 'focus').map((t) => t.id)).toEqual(['now', 'sub', 'q1', 'q2']);
    expect(zoneOf(todos).map((t) => t.id)).toEqual(['now']);
    // 桌面明确指定：同一个分界位置放进聚焦区末尾
    todos = placeTodo(s, 'sub', { list: 'focus', parentId: null, index: 1, focused: true });
    expect(zoneOf(todos).map((t) => t.id)).toEqual(['now', 'sub']);
    // 聚焦项拖进「接下来」的项下面当子任务：离开聚焦区
    todos = placeTodo(s, 'now', { list: 'focus', parentId: 'q1', index: 0 });
    expect(zoneOf(todos)).toEqual([]);
    expect(todos.find((t) => t.id === 'now')?.focused).toBeUndefined();
  });

  it('VERIFY：顶层项拖成子项时保住待验证，子项拖成顶层时去掉', () => {
    let s: Todo[] = [];
    s = add(s, 'v1', 'verify');
    s = add(s, 'v2', 'verify'); // v2 v1
    let { todos } = drop(s, 'verify', 'v1', 1, 1);
    expect(todos.find((t) => t.id === 'v1')).toMatchObject({ parentId: 'v2', testing: true });
    ({ todos } = drop(todos, 'verify', 'v1', 1, 0));
    expect(todos.find((t) => t.id === 'v1')).toMatchObject({ parentId: null, testing: false });
  });
});

describe('placeTodo', () => {
  it('不能放进自己或自己的子孙下面；父项不存在时不动', () => {
    const s = sample();
    expect(placeTodo(s, 'A', { list: 'inbox', parentId: 'A1a', index: 0 })).toBe(s);
    expect(placeTodo(s, 'A', { list: 'inbox', parentId: 'A', index: 0 })).toBe(s);
    expect(placeTodo(s, 'A', { list: 'inbox', parentId: 'nope', index: 0 })).toBe(s);
  });

  it('换列表：子孙的列表跟着变；放进 VERIFY 顶层时回到未完成', () => {
    let s = sample();
    s = completeTodo(s, 'C', 9000).todos;
    s = placeTodo(s, 'C', { list: 'verify', parentId: null, index: 0 });
    expect(s.find((t) => t.id === 'C')).toMatchObject({ list: 'verify', done: false, testing: false });
    s = placeTodo(s, 'A', { list: 'goal', parentId: null, index: 0 });
    expect(s.filter((t) => ['A', 'A1', 'A1a', 'A2'].includes(t.id)).every((t) => t.list === 'goal')).toBe(true);
  });
});
