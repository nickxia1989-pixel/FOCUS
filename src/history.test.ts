import { describe, expect, it } from 'vitest';
import { addDays, countsByDay, dayStart, groupByDay, heatmap, streak, weekStart } from './history';
import { completeTodo, createTodo, uncompleteTodo } from './model';
import type { ListId, Todo } from './types';

/** 2026-10-14（周三）中午，避开零点边界 */
const WED = new Date(2026, 9, 14, 12, 0, 0).getTime();
const at = (dayOffset: number, hour = 12) => addDays(dayStart(WED), dayOffset) + hour * 3600_000;

function add(todos: Todo[], id: string, list: ListId = 'focus', parentId: string | null = null) {
  return createTodo(todos, { id, title: id, list, parentId, now: 1 });
}

describe('完成记录', () => {
  it('记下完成时所在的列表，取消完成后清掉', () => {
    let s = add([], 'a');
    s = completeTodo(s, 'a', at(0)).todos;
    const a = s.find((t) => t.id === 'a')!;
    expect(a.list).toBe('inbox');
    expect(a.completedFrom).toBe('focus');
    s = uncompleteTodo(s, 'a');
    expect(s.find((t) => t.id === 'a')!.completedFrom).toBeUndefined();
  });

  it('按天分组，新的在前；同一天一起完成的子项挂在父项下', () => {
    let s = add([], 'p', 'goal');
    s = add(s, 'c1', 'goal', 'p');
    s = add(s, 'c2', 'goal', 'p');
    s = add(s, 'x', 'inbox');
    s = completeTodo(s, 'c2', at(-1, 9)).todos; // 昨天先完成一个子项
    s = completeTodo(s, 'p', at(0, 10)).todos; // 今天完成父项，c1 随之完成
    s = completeTodo(s, 'x', at(0, 15)).todos;

    const days = groupByDay(s);
    expect(days.map((d) => d.day)).toEqual([dayStart(at(0)), dayStart(at(-1))]);

    const today = days[0];
    expect(today.count).toBe(3);
    expect(today.items.map((i) => i.todo.id)).toEqual(['x', 'p']);
    expect(today.items[1].children.map((i) => i.todo.id)).toEqual(['c1']);

    const yesterday = days[1];
    expect(yesterday.items.map((i) => i.todo.id)).toEqual(['c2']);
    expect(yesterday.items[0].parentTitle).toBe('p');
  });

  it('未完成的条目不出现', () => {
    const s = add([], 'a');
    expect(groupByDay(s)).toEqual([]);
  });
});

describe('热力图与连续天数', () => {
  const countsOf = (offsets: number[]) => {
    let s: Todo[] = [];
    offsets.forEach((o, i) => {
      s = add(s, `t${i}`);
      s = completeTodo(s, `t${i}`, at(o)).todos;
    });
    return countsByDay(s);
  };

  it('按周一到周日排列，最后一列是本周，未来的日子标出来', () => {
    const cols = heatmap(countsOf([0, 0, -1]), WED, 3);
    expect(cols).toHaveLength(3);
    expect(cols.every((c) => c.length === 7)).toBe(true);
    expect(cols[2][0].day).toBe(weekStart(WED));
    const wed = cols[2][2];
    expect(wed.day).toBe(dayStart(WED));
    expect(wed.count).toBe(2);
    expect(wed.level).toBe(4);
    expect(cols[2][1].level).toBe(2);
    expect(cols[2][3].future).toBe(true);
    expect(cols[2][2].future).toBe(false);
  });

  it('连续天数：今天没完成时从昨天往回数', () => {
    expect(streak(countsOf([0, -1, -2, -4]), WED)).toBe(3);
    expect(streak(countsOf([-1, -2]), WED)).toBe(2);
    expect(streak(countsOf([-2]), WED)).toBe(0);
  });
});
