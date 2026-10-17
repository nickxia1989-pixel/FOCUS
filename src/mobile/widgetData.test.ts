import { describe, expect, it } from 'vitest';
import { completeTodo, createTodo, nowOf, setNow } from '../model';
import type { ListId, Todo } from '../types';
import { DAY, type Profile } from './data';
import { WIDGET_INBOX_LIMIT, WIDGET_NEXT_LIMIT, WIDGET_SUB_LIMIT, widgetSnapshot } from './widgetData';

// 固定在本地时间的某天中午，避免跨零点和时区带来的偶发失败
const NOON = new Date(2026, 9, 17, 12, 0, 0).getTime();

let seq = 0;
function add(todos: Todo[], title: string, list: ListId = 'focus', parentId: string | null = null) {
  seq++;
  return createTodo(todos, { id: title, title, list, parentId, now: NOON - 3 * DAY + seq });
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

const snap = (todos: Todo[], now = NOON) => widgetSnapshot([profile(todos)], 'p1', now).profiles[0];

describe('小组件快照', () => {
  it('NOW 是 FOCUS 第一件未完成顶层项，其余按顺序是 NEXT', () => {
    let s: Todo[] = [];
    s = add(s, 'a');
    s = add(s, 'b');
    s = add(s, 'c');
    s = add(s, 'inbox 里的', 'inbox');
    s = add(s, 'b 的子项', 'focus', 'b');
    s = completeTodo(s, 'a', NOON).todos;
    const w = snap(s);
    expect(w.now?.id).toBe(nowOf(s)?.id);
    expect(w.now?.title).toBe('c');
    expect(w.next.map((i) => i.title)).toEqual(['b']);
    expect(w.open).toBe(2);
  });

  it('设为现在后 NOW 跟着变', () => {
    let s: Todo[] = [];
    s = add(s, 'a');
    s = add(s, 'b');
    s = setNow(s, 'a');
    const w = snap(s);
    expect(w.now?.title).toBe('a');
    expect(w.next.map((i) => i.title)).toEqual(['b']);
  });

  it('NOW 带子任务进度和前几条子任务，未完成的在前', () => {
    let s: Todo[] = [];
    s = add(s, 'a');
    for (let i = 1; i <= WIDGET_SUB_LIMIT + 1; i++) s = add(s, `a${i}`, 'focus', 'a');
    s = add(s, 'a1x', 'focus', 'a1');
    s = completeTodo(s, 'a4', NOON).todos;
    const now = snap(s).now!;
    expect(now).toMatchObject({ subDone: 1, subTotal: WIDGET_SUB_LIMIT + 1 });
    expect(now.subs).toHaveLength(WIDGET_SUB_LIMIT);
    expect(now.subs.every((x) => !x.done)).toBe(true);
  });

  it('NEXT 条数有上限，总数照实计；NEXT 行也带子任务进度', () => {
    let s: Todo[] = [];
    for (let i = 0; i < WIDGET_NEXT_LIMIT + 5; i++) s = add(s, `t${i}`);
    // 新建的在前：最后建的是 NOW，倒数第二个是 NEXT 第一条
    const second = `t${WIDGET_NEXT_LIMIT + 3}`;
    s = add(s, 'k', 'focus', second);
    const w = snap(s);
    expect(w.next).toHaveLength(WIDGET_NEXT_LIMIT);
    expect(w.open).toBe(WIDGET_NEXT_LIMIT + 5);
    expect(w.next[0]).toMatchObject({ id: second, subDone: 0, subTotal: 1 });
    expect(w.next.some((i) => i.id === 't0')).toBe(false);
  });

  it('FOCUS 空了：NOW 为 null，给出 INBOX 最上面几件和总数', () => {
    let s: Todo[] = [];
    for (let i = 0; i < WIDGET_INBOX_LIMIT + 2; i++) s = add(s, `i${i}`, 'inbox');
    s = completeTodo(s, 'i0', NOON).todos;
    const w = snap(s);
    expect(w.now).toBeNull();
    expect(w.next).toEqual([]);
    expect(w.open).toBe(0);
    expect(w.inbox.map((i) => i.title)).toEqual(['i4', 'i3', 'i2']);
    expect(w.inboxOpen).toBe(WIDGET_INBOX_LIMIT + 1);
  });

  it('今天完成数和连续天数与 HISTORY 的算法一致', () => {
    let s: Todo[] = [];
    s = add(s, 'a');
    s = add(s, 'a1', 'focus', 'a');
    s = add(s, 'b', 'inbox');
    s = add(s, 'y', 'inbox');
    s = add(s, 'old', 'inbox');
    s = completeTodo(s, 'a1', NOON).todos;
    s = completeTodo(s, 'b', NOON + 1000).todos;
    s = completeTodo(s, 'y', NOON - DAY).todos;
    s = completeTodo(s, 'old', NOON - 3 * DAY).todos;
    const w = widgetSnapshot([profile(s)], 'p1', NOON + 2000);
    expect(w.profiles[0].doneToday).toBe(2);
    expect(w.profiles[0].streak).toBe(2);
    expect(w.day).toBe(new Date(2026, 9, 17).getTime());
    // 今天还没完成：从昨天往回数，不算断
    expect(snap(s, NOON + DAY).streak).toBe(2);
    expect(snap(s, NOON + DAY).doneToday).toBe(0);
  });

  it('标题压成一行，太长的截断', () => {
    let s: Todo[] = [];
    s = add(s, `第一行\n  第二行\t${'长'.repeat(200)}`);
    const title = snap(s).now!.title;
    expect(title.startsWith('第一行 第二行 长')).toBe(true);
    expect(title.length).toBe(120);
    expect(title.endsWith('…')).toBe(true);
  });

  it('每个空间各一份，带名字和头像序号', () => {
    const all = widgetSnapshot([profile(add([], 'a')), profile([], { id: 'p2', name: '生活', tint: 2 })], 'p2', NOON);
    expect(all.version).toBe(2);
    expect(all.activeId).toBe('p2');
    expect(all.profiles.map((p) => [p.id, p.name, p.tint, p.open])).toEqual([
      ['p1', '工作', 0, 1],
      ['p2', '生活', 2, 0],
    ]);
  });
});
