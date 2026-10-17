import { describe, expect, it } from 'vitest';
import { completeTodo, createTodo, sanitize } from '../model';
import type { ListId, Todo } from '../types';
import { DAY, historyDays, recentCounts, sanitizeSnapshot, seedSnapshot, streak } from './data';

// 固定在本地时间的某天中午，避免跨零点和时区带来的偶发失败
const NOON = new Date(2026, 9, 17, 12, 0, 0).getTime();

let seq = 0;
function add(todos: Todo[], title: string, list: ListId, parentId: string | null = null) {
  seq++;
  return createTodo(todos, { id: title, title, list, parentId, now: NOON - DAY * 30 + seq });
}

function done(todos: Todo[], id: string, at: number) {
  return completeTodo(todos, id, at).todos;
}

describe('HISTORY 按天分组', () => {
  it('新的日期在前，同一天内新完成的在前', () => {
    let s: Todo[] = [];
    s = add(s, 'a', 'focus');
    s = add(s, 'b', 'inbox');
    s = add(s, 'c', 'goal');
    s = done(s, 'a', NOON - DAY);
    s = done(s, 'b', NOON + 60_000);
    s = done(s, 'c', NOON);
    const days = historyDays(s);
    expect(days.map((d) => d.items.map((i) => i.todo.id))).toEqual([['b', 'c'], ['a']]);
    expect(days[0].total).toBe(2);
  });

  it('父项当天一起完成的子项折叠进父项，不单独列出', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'goal');
    s = add(s, 'c1', 'goal', 'p');
    s = add(s, 'c2', 'goal', 'c1');
    s = done(s, 'p', NOON); // 子孙一并完成
    const [day] = historyDays(s);
    expect(day.items.map((i) => i.todo.id)).toEqual(['p']);
    expect(day.items[0].folded).toBe(2);
    expect(day.total).toBe(3);
  });

  it('子项比父项早一天完成时单独列出，并带上父项路径', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'goal');
    s = add(s, 'c', 'goal', 'p');
    s = done(s, 'c', NOON - DAY);
    s = done(s, 'p', NOON);
    const days = historyDays(s);
    expect(days.map((d) => d.items.map((i) => i.todo.id))).toEqual([['p'], ['c']]);
    expect(days[0].items[0].folded).toBe(0);
    expect(days[1].items[0].path).toEqual(['p']);
  });

  it('未完成的不出现', () => {
    let s: Todo[] = [];
    s = add(s, 'a', 'focus');
    expect(historyDays(s)).toEqual([]);
  });
});

describe('近几天统计与连续天数', () => {
  it('最近 7 天每天完成数，旧的在前，超出范围的不计', () => {
    let s: Todo[] = [];
    for (const n of ['a', 'b', 'c', 'd']) s = add(s, n, 'inbox');
    s = done(s, 'a', NOON);
    s = done(s, 'b', NOON - 2 * DAY);
    s = done(s, 'c', NOON - 2 * DAY + 1000);
    s = done(s, 'd', NOON - 9 * DAY);
    const counts = recentCounts(s, NOON, 7).map((d) => d.count);
    expect(counts).toEqual([0, 0, 0, 0, 2, 0, 1]);
  });

  it('今天还没完成也不算断档', () => {
    let s: Todo[] = [];
    for (const n of ['a', 'b', 'c']) s = add(s, n, 'inbox');
    s = done(s, 'a', NOON - DAY);
    s = done(s, 'b', NOON - 2 * DAY);
    s = done(s, 'c', NOON - 4 * DAY);
    expect(streak(s, NOON)).toBe(2);
    s = add(s, 'd', 'inbox');
    s = done(s, 'd', NOON);
    expect(streak(s, NOON)).toBe(3);
  });
});

describe('快照清洗', () => {
  it('不认识的数据返回 null', () => {
    expect(sanitizeSnapshot(null, NOON)).toBeNull();
    expect(sanitizeSnapshot({ profiles: [] }, NOON)).toBeNull();
    expect(sanitizeSnapshot({ profiles: 'x' }, NOON)).toBeNull();
  });

  it('去掉坏 profile 和重复 id，当前空间和分区无效时回退', () => {
    const snap = sanitizeSnapshot(
      {
        activeProfileId: 'gone',
        prefs: { section: 'nope', sound: false },
        profiles: [
          { id: 'w', name: '  工作 ', tint: 99, todos: [{ id: 't', title: 'x', list: 'focus' }] },
          { id: 'w', name: '重复' },
          { name: '没有 id' },
          { id: 'l', name: '' },
        ],
      },
      NOON,
    )!;
    expect(snap.profiles.map((p) => [p.id, p.name])).toEqual([
      ['w', '工作'],
      ['l', '未命名'],
    ]);
    expect(snap.profiles[0].tint).toBeLessThan(8);
    expect(snap.profiles[0].todos).toHaveLength(1);
    expect(snap.activeProfileId).toBe('w');
    expect(snap.prefs.section).toBe('focus');
    expect(snap.prefs.sound).toBe(false);
  });

  it('首次启动的示例数据本身是干净的', () => {
    const seed = sanitizeSnapshot(seedSnapshot(NOON), NOON)!;
    expect(seed.profiles.map((p) => p.name)).toEqual(['工作', '生活']);
    for (const p of seed.profiles) expect(sanitize(p.todos)).toEqual(p.todos);
  });
});
