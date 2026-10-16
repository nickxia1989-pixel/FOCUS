import { describe, expect, it } from 'vitest';
import { buildIndex, childrenOf, createTodo, deleteTodo, moveTodo, rootsOf } from './model';
import { purgeTrash, restoreEntry, sanitizeTrash, trashSubtree } from './trash';
import type { ListId, Todo } from './types';

let seq = 0;
const add = (s: Todo[], id: string, list: ListId, parentId: string | null = null) =>
  createTodo(s, { id, title: id, list, parentId, now: 1000 + seq++ });

const DAY = 24 * 60 * 60 * 1000;

describe('回收站', () => {
  it('删除整棵子树进回收站，恢复后原样回来', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'goal');
    s = add(s, 'c1', 'goal', 'p');
    s = add(s, 'g1', 'goal', 'c1');
    s = add(s, 'x', 'goal');
    const r = trashSubtree(s, 'p', 50, 'e1');
    expect(r.todos.map((t) => t.id)).toEqual(['x']);
    expect(r.entry).toMatchObject({ id: 'e1', rootId: 'p', parentId: null, list: 'goal', deletedAt: 50 });
    expect(r.entry!.items.map((t) => t.id).sort()).toEqual(['c1', 'g1', 'p']);

    const back = restoreEntry(r.todos, r.entry!);
    const idx = buildIndex(back);
    expect(rootsOf(idx, 'goal').map((t) => t.id).sort()).toEqual(['p', 'x']);
    expect(childrenOf(idx, 'c1').map((t) => t.id)).toEqual(['g1']);
  });

  it('子项恢复时挂回原父项，并跟随父项当前所在的列表', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'inbox');
    s = add(s, 'c1', 'inbox', 'p');
    const r = trashSubtree(s, 'c1', 5, 'e');
    s = moveTodo(r.todos, 'p', 'focus');
    const back = restoreEntry(s, r.entry!);
    expect(back.find((t) => t.id === 'c1')).toMatchObject({ parentId: 'p', list: 'focus' });
  });

  it('原父项已不在时，作为顶层项回到原列表', () => {
    let s: Todo[] = [];
    s = add(s, 'p', 'goal');
    s = add(s, 'c1', 'goal', 'p');
    s = add(s, 'g1', 'goal', 'c1');
    const r = trashSubtree(s, 'c1', 5, 'e');
    const gone = deleteTodo(r.todos, 'p');
    const back = restoreEntry(gone, r.entry!);
    expect(back.find((t) => t.id === 'c1')).toMatchObject({ parentId: null, list: 'goal' });
    expect(back.find((t) => t.id === 'g1')).toMatchObject({ parentId: 'c1', list: 'goal' });
  });

  it('超过 30 天的条目被清除', () => {
    const mk = (id: string, deletedAt: number) => ({ id, deletedAt, rootId: id, parentId: null, list: 'inbox' as ListId, items: [] });
    const now = 100 * DAY;
    const kept = purgeTrash([mk('new', now - DAY), mk('edge', now - 30 * DAY), mk('old', now - 31 * DAY)], now);
    expect(kept.map((e) => e.id)).toEqual(['new', 'edge']);
  });

  it('读入时保留根条目的原父项信息，丢弃无效条目', () => {
    const raw = [
      {
        id: 'e',
        deletedAt: 1,
        rootId: 'c',
        parentId: 'p',
        list: 'focus',
        items: [{ id: 'c', title: 'c', list: 'focus', parentId: 'p', createdAt: 1 }],
      },
      { id: 'bad', deletedAt: 1, rootId: 'zzz', items: [] },
      null,
    ];
    const t = sanitizeTrash(raw);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ parentId: 'p', list: 'focus' });
  });
});
