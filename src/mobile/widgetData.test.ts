import { describe, expect, it } from 'vitest';
import { completeTodo, createTodo } from '../model';
import type { ListId, Todo } from '../types';
import { DAY, PROFILE_TINTS, type Profile } from './data';
import { WIDGET_ITEM_LIMIT, widgetSnapshot } from './widgetData';

// 固定在本地时间的某天中午，避免跨零点和时区带来的偶发失败
const NOON = new Date(2026, 9, 17, 12, 0, 0).getTime();

let seq = 0;
function add(todos: Todo[], title: string, list: ListId = 'focus', parentId: string | null = null) {
  seq++;
  return createTodo(todos, { id: title, title, list, parentId, now: NOON - DAY + seq });
}

const profile = (todos: Todo[], over: Partial<Profile> = {}): Profile => ({
  id: 'p1',
  name: '工作',
  tint: 0,
  createdAt: 0,
  todos,
  trash: [],
  ...over,
});

describe('小组件快照', () => {
  it('只取 FOCUS 里未完成的顶层项，顺序和列表一致（新建的在前）', () => {
    let s: Todo[] = [];
    s = add(s, 'a');
    s = add(s, 'b');
    s = add(s, 'inbox 里的', 'inbox');
    s = add(s, 'a 的子项', 'focus', 'a');
    s = add(s, 'c');
    s = completeTodo(s, 'c', NOON).todos;
    const w = widgetSnapshot([profile(s)], 'p1', NOON).profiles[0];
    expect(w.items.map((i) => i.title)).toEqual(['b', 'a']);
    expect(w.roots).toBe(2);
    // 未完成数和 App 的页头一样含子任务
    expect(w.open).toBe(3);
  });

  it('带上直接子任务的进度', () => {
    let s: Todo[] = [];
    s = add(s, 'a');
    s = add(s, 'a1', 'focus', 'a');
    s = add(s, 'a2', 'focus', 'a');
    s = add(s, 'a2x', 'focus', 'a2');
    s = completeTodo(s, 'a1', NOON).todos;
    const item = widgetSnapshot([profile(s)], 'p1', NOON).profiles[0].items[0];
    expect(item).toMatchObject({ id: 'a', subDone: 1, subTotal: 2 });
  });

  it('条数有上限，总数照实计', () => {
    let s: Todo[] = [];
    for (let i = 0; i < WIDGET_ITEM_LIMIT + 5; i++) s = add(s, `t${i}`);
    const w = widgetSnapshot([profile(s)], 'p1', NOON).profiles[0];
    expect(w.items).toHaveLength(WIDGET_ITEM_LIMIT);
    expect(w.roots).toBe(WIDGET_ITEM_LIMIT + 5);
  });

  it('今天完成数只算今天的，含子任务', () => {
    let s: Todo[] = [];
    s = add(s, 'a');
    s = add(s, 'a1', 'focus', 'a');
    s = add(s, 'b', 'inbox');
    s = add(s, 'old');
    s = completeTodo(s, 'a1', NOON).todos;
    s = completeTodo(s, 'b', NOON + 1000).todos;
    s = completeTodo(s, 'old', NOON - DAY).todos;
    const snap = widgetSnapshot([profile(s)], 'p1', NOON + 2000);
    expect(snap.profiles[0].doneToday).toBe(2);
    expect(snap.day).toBe(new Date(2026, 9, 17).getTime());
  });

  it('标题压成一行，太长的截断', () => {
    let s: Todo[] = [];
    s = add(s, `第一行\n  第二行\t${'长'.repeat(200)}`);
    const title = widgetSnapshot([profile(s)], 'p1', NOON).profiles[0].items[0].title;
    expect(title.startsWith('第一行 第二行 长')).toBe(true);
    expect(title.length).toBe(120);
    expect(title.endsWith('…')).toBe(true);
  });

  it('每个空间各一份，带名字和头像颜色；空列表也照样给出', () => {
    const snap = widgetSnapshot(
      [profile(add([], 'a')), profile([], { id: 'p2', name: '生活', tint: 2 })],
      'p2',
      NOON,
    );
    expect(snap.activeId).toBe('p2');
    expect(snap.profiles.map((p) => [p.id, p.name, p.color, p.open])).toEqual([
      ['p1', '工作', PROFILE_TINTS[0], 1],
      ['p2', '生活', PROFILE_TINTS[2], 0],
    ]);
    expect(snap.profiles[1].items).toEqual([]);
  });
});
