import { describe, expect, it } from 'vitest';
import type { ListId, Todo } from '../types';
import { compareStamps, newClock, observe, tick } from './clock';
import {
  createProfile,
  expireTrash,
  findConflicts,
  keepAllTitles,
  mergeDocs,
  resolveDelete,
  resolveProfile,
  resolveTitle,
  setProfileDeleted,
  TRASH_KEEP_MS,
  viewProfile,
  emptyDoc,
  docKnowledge,
  visibleProfiles,
} from './doc';
import { buildDeviceFile, canonicalJson, docHash, parseDeviceFile } from './file';
import { legacyRecords, migrateLegacy } from './migrate';
import * as O from './ops';

const P = 'p1';

/** 一台模拟设备：状态 + 本机 collapsed + 自己的"墙钟" */
class Dev {
  st: O.DocState;
  collapsed: O.Collapsed = {};
  now: number;
  constructor(
    public id: string,
    start = 1_000_000,
  ) {
    this.st = { doc: emptyDoc(), clock: newClock(id) };
    this.now = start;
  }
  ctx(): O.OpCtx {
    this.now += 1000;
    return { profileId: P, collapsed: this.collapsed, now: this.now };
  }
  apply<R>(r: O.DocState & { collapsed: O.Collapsed; result: R }): R {
    this.st = { doc: r.doc, clock: r.clock };
    this.collapsed = r.collapsed;
    return r.result;
  }
  profile(name = '工作') {
    const e = createProfile(this.st.doc, this.st.clock, { id: P, name }, (this.now += 1000));
    this.st = e;
  }
  add(id: string, title: string, list: ListId = 'inbox', parentId: string | null = null) {
    return this.apply(O.addTodo(this.st, this.ctx(), { id, title, list, parentId }));
  }
  rename(id: string, title: string) {
    this.apply(O.renameTodo(this.st, this.ctx(), id, title));
  }
  complete(id: string) {
    return this.apply(O.completeTodo(this.st, this.ctx(), id));
  }
  move(id: string, list: ListId) {
    this.apply(O.moveTodo(this.st, this.ctx(), id, list));
  }
  remove(id: string) {
    return this.apply(O.removeTodo(this.st, this.ctx(), id));
  }
  restore(id: string) {
    return this.apply(O.restoreFromTrash(this.st, this.ctx(), id));
  }
  /** 拉取 other 的完整状态（相当于读到它在云端的设备文件） */
  pull(other: Dev) {
    this.now += 10;
    this.st = O.mergeRemote(this.st, other.st.doc, other.st.clock.knowledge, this.now);
  }
  view() {
    return viewProfile(this.st.doc, P, this.collapsed);
  }
  todo(id: string): Todo | undefined {
    return this.view().todos.find((t) => t.id === id);
  }
  conflicts() {
    return findConflicts(this.st.doc);
  }
}

function pair() {
  const a = new Dev('devA');
  const b = new Dev('devB', 1_000_500);
  a.profile();
  b.pull(a);
  return [a, b] as const;
}

const sync = (...devs: Dev[]) => {
  for (let round = 0; round < 2; round++) for (const x of devs) for (const y of devs) if (x !== y) x.pull(y);
};

describe('时钟', () => {
  it('本机写入推进计数，戳之间能分出先后与并发', () => {
    let a = newClock('a');
    let b = newClock('b');
    const t1 = tick(a, 10);
    a = t1.clock;
    const t2 = tick(b, 10);
    b = t2.clock;
    expect(compareStamps(t1.stamp, t2.stamp)).toBe('concurrent');
    b = observe(b, a.knowledge, t1.stamp.t, 11);
    const t3 = tick(b, 12);
    expect(compareStamps(t3.stamp, t1.stamp)).toBe('after');
    expect(compareStamps(t1.stamp, t3.stamp)).toBe('before');
  });

  it('看到别处记录的本机计数更大时（从备份恢复），本机计数跟上，不会重号', () => {
    const c = observe(newClock('a'), { a: 7, b: 2 }, null, 0);
    expect(c.counter).toBe(7);
    expect(tick(c, 1).stamp.vv.a).toBe(8);
  });
});

describe('自动合并', () => {
  it('一边改标题、一边勾完成：两个改动都生效，不算冲突', () => {
    const [a, b] = pair();
    a.add('x', '写周报');
    b.pull(a);
    a.rename('x', '写周报（含数据）');
    b.complete('x');
    sync(a, b);
    for (const d of [a, b]) {
      const x = d.view().todos.find((t) => t.id === 'x')!;
      expect(x.title).toBe('写周报（含数据）');
      expect(x.done).toBe(true);
      expect(d.conflicts()).toEqual([]);
    }
    expect(canonicalJson(a.st.doc)).toBe(canonicalJson(b.st.doc));
  });

  it('两边各自新建、互不相干：合并后都在', () => {
    const [a, b] = pair();
    a.add('a1', 'A 的事');
    b.add('b1', 'B 的事');
    sync(a, b);
    expect(a.view().todos.map((t) => t.id).sort()).toEqual(['a1', 'b1']);
    expect(docHash(a.st.doc)).toBe(docHash(b.st.doc));
  });

  it('并发移到不同列表：后移的赢，两边一致', () => {
    const [a, b] = pair();
    a.add('x', '事');
    b.pull(a);
    a.move('x', 'goal');
    b.move('x', 'focus');
    sync(a, b);
    expect(a.todo('x')!.list).toBe(b.todo('x')!.list);
    // b 的 HLC 已经推进到 a 之前的写入时间，a 的移动更晚，a 赢
    expect(b.todo('x')!.list).toBe('goal');
    expect(a.conflicts()).toEqual([]);
  });

  it('A 完成父项（子项随之完成），B 同时改子项标题：子项既完成又是新标题', () => {
    const [a, b] = pair();
    a.add('p', '父', 'goal');
    a.add('c', '子', 'goal', 'p');
    b.pull(a);
    a.complete('p');
    b.rename('c', '子（改）');
    sync(a, b);
    const c = a.todo('c')!;
    expect(c.done).toBe(true);
    expect(c.title).toBe('子（改）');
    expect(a.conflicts()).toEqual([]);
  });

  it('父项移到别的列表时，子项不重新盖戳（list 是派生值）', () => {
    const [a] = pair();
    a.add('p', '父', 'goal');
    a.add('c', '子', 'goal', 'p');
    const before = a.st.doc.todos.c.pos;
    a.move('p', 'focus');
    expect(a.st.doc.todos.c.pos).toBe(before);
    expect(a.todo('c')!.list).toBe('focus');
  });

  it('合并满足交换律与幂等', () => {
    const [a, b] = pair();
    a.add('x', '1');
    b.add('y', '2');
    b.pull(a);
    a.rename('x', '1a');
    b.rename('x', '1b');
    const ab = mergeDocs(a.st.doc, b.st.doc);
    const ba = mergeDocs(b.st.doc, a.st.doc);
    expect(canonicalJson(ab)).toBe(canonicalJson(ba));
    expect(mergeDocs(ab, ab)).toBe(ab);
    expect(mergeDocs(ab, a.st.doc)).toBe(ab);
  });
});

describe('需要旅行者决定的冲突', () => {
  it('标题被两边并发改成不同内容：两边都看到同一个冲突，任一边决定后全部消失', () => {
    const [a, b] = pair();
    a.add('x', '原标题');
    b.pull(a);
    a.rename('x', 'A 改的');
    b.rename('x', 'B 改的');
    sync(a, b);
    const ca = a.conflicts();
    expect(ca).toHaveLength(1);
    expect(ca[0].kind).toBe('title');
    if (ca[0].kind !== 'title') return;
    expect(ca[0].options.map((o) => o.v).sort()).toEqual(['A 改的', 'B 改的']);
    expect(b.conflicts()).toEqual(ca);

    a.st = resolveTitle(a.st.doc, a.st.clock, 'x', 'B 改的', (a.now += 1000));
    expect(a.conflicts()).toEqual([]);
    b.pull(a);
    expect(b.conflicts()).toEqual([]);
    expect(b.todo('x')!.title).toBe('B 改的');
  });

  it('并发改成相同内容不算冲突', () => {
    const [a, b] = pair();
    a.add('x', '原');
    b.pull(a);
    a.rename('x', '一样');
    b.rename('x', '一样');
    sync(a, b);
    expect(a.conflicts()).toEqual([]);
  });

  it('两边同时做了不同的决定：按时间取后决定的那个，不再反复弹出', () => {
    const [a, b] = pair();
    a.add('x', '原');
    b.pull(a);
    a.rename('x', 'A');
    b.rename('x', 'B');
    sync(a, b);
    a.st = resolveTitle(a.st.doc, a.st.clock, 'x', 'A', (a.now += 1000));
    b.st = resolveTitle(b.st.doc, b.st.clock, 'x', 'B', (b.now += 1000));
    sync(a, b);
    expect(a.conflicts()).toEqual([]);
    expect(a.todo('x')!.title).toBe(b.todo('x')!.title);
  });

  it('三台设备、不同的到达顺序：候选值被后来的改动覆盖时会被剔除，各设备结果一致', () => {
    const x = new Dev('devX');
    const y = new Dev('devY', 1_000_100);
    const z = new Dev('devZ', 1_000_200);
    x.profile();
    x.add('t', '原');
    y.pull(x);
    z.pull(x);
    const a = new Dev('devA', 1_000_300);
    a.pull(x);
    a.rename('t', 'a'); // 写入 a
    const b = new Dev('devB', 1_000_400);
    b.pull(x);
    b.rename('t', 'b'); // 与 a 并发
    z.pull(a);
    z.rename('t', 'c'); // 看过 a 之后写的 c
    x.pull(a);
    x.pull(b); // x: {a, b}
    y.pull(a);
    y.pull(z);
    y.pull(b); // y: {b, c}
    x.pull(z); // a 被 c 覆盖，x 也应当只剩 {b, c}
    expect(canonicalJson(x.st.doc.todos.t)).toBe(canonicalJson(y.st.doc.todos.t));
    const c = x.conflicts();
    expect(c[0].kind === 'title' && c[0].options.map((o) => o.v).sort()).toEqual(['b', 'c']);
  });

  it('编辑期间远端改了同一条标题：变成冲突，而不是用编辑框里的底稿盖掉远端', () => {
    const [a, b] = pair();
    a.add('x', '原');
    b.pull(a);
    const base = { ...b.st.clock.knowledge }; // b 打开编辑框
    a.rename('x', '手机上改的');
    b.pull(a); // 编辑期间收到远端改动
    b.apply(O.renameTodo(b.st, b.ctx(), 'x', '电脑上改的', base));
    const c = b.conflicts();
    expect(c[0].kind === 'title' && c[0].options.map((o) => o.v).sort()).toEqual(['手机上改的', '电脑上改的']);
    // 没有远端改动时就是普通改写
    const base2 = { ...b.st.clock.knowledge };
    b.apply(O.renameTodo(b.st, b.ctx(), 'x', '定稿', base2));
    expect(b.conflicts()).toEqual([]);
  });

  it('两个都保留：原条目留一个标题，另一个复制成新条目', () => {
    const [a, b] = pair();
    a.add('x', '原');
    b.pull(a);
    a.rename('x', 'A');
    b.rename('x', 'B');
    sync(a, b);
    a.st = keepAllTitles(a.st.doc, a.st.clock, 'x', 'A', [{ id: 'x2', title: 'B' }], (a.now += 1000));
    sync(a, b);
    expect(b.conflicts()).toEqual([]);
    expect(b.view().todos.map((t) => t.title).sort()).toEqual(['A', 'B']);
  });

  it('一边删除、另一边同时改了标题：提示恢复或保持删除', () => {
    const [a, b] = pair();
    a.add('x', '原');
    b.pull(a);
    a.remove('x');
    b.rename('x', 'B 改过');
    sync(a, b);
    const c = b.conflicts();
    expect(c).toHaveLength(1);
    expect(c[0].kind).toBe('delete');
    // 临时状态是已删除（在回收站里）
    expect(b.todo('x')).toBeUndefined();
    expect(b.view().trash.map((e) => e.id)).toEqual(['x']);

    b.st = resolveDelete(b.st.doc, b.st.clock, 'x', 'restore', (b.now += 1000));
    a.pull(b);
    expect(a.conflicts()).toEqual([]);
    expect(a.todo('x')!.title).toBe('B 改过');
  });

  it('删除 vs 修改：选保持删除后冲突消失，条目留在回收站', () => {
    const [a, b] = pair();
    a.add('x', '原');
    b.pull(a);
    a.remove('x');
    b.complete('x');
    sync(a, b);
    a.st = resolveDelete(a.st.doc, a.st.clock, 'x', 'delete', (a.now += 1000));
    sync(a, b);
    expect(b.conflicts()).toEqual([]);
    expect(b.view().trash.map((e) => e.id)).toEqual(['x']);
  });

  it('一边删了父项、另一边同时在它下面加了子项：提示；恢复后子项一起回来', () => {
    const [a, b] = pair();
    a.add('p', '父', 'goal');
    b.pull(a);
    a.remove('p');
    b.add('c', '新子项', 'goal', 'p');
    sync(a, b);
    const c = a.conflicts();
    expect(c).toHaveLength(1);
    expect(c[0].kind === 'delete' && c[0].edits.map((e) => e.what)).toEqual(['child']);
    a.st = resolveDelete(a.st.doc, a.st.clock, 'p', 'restore', (a.now += 1000));
    sync(a, b);
    expect(b.todo('c')!.parentId).toBe('p');
    expect(b.conflicts()).toEqual([]);
  });

  it('完成父项时子项被连带完成，不算"改过"子项：另一边删了这个子项不弹冲突', () => {
    const [a, b] = pair();
    a.add('p', '父', 'goal');
    a.add('c', '子', 'goal', 'p');
    b.pull(a);
    a.remove('c');
    b.complete('p');
    sync(a, b);
    expect(a.conflicts()).toEqual([]);
    expect(b.view().trash.map((e) => e.id)).toEqual(['c']);
  });

  it('连带改动不会盖过并发的直接改动：A 完成父项，B 同时把子项标为待测', () => {
    const [a, b] = pair();
    a.add('p', '父', 'goal');
    a.add('c', '子', 'goal', 'p');
    b.pull(a);
    b.now += 100_000; // 即使 B 的操作更早……
    a.now += 200_000; // ……A 的连带完成更晚，也是 B 的直接操作赢
    a.complete('p');
    b.apply(O.markForTest(b.st, b.ctx(), 'c'));
    sync(a, b);
    expect(a.todo('c')!.testing).toBe(true);
  });

  it('过期自动清理和并发的恢复：恢复赢', () => {
    const [a, b] = pair();
    a.add('x', '一');
    a.remove('x');
    b.pull(a);
    a.st = expireTrash(a.st.doc, a.st.clock, a.now + TRASH_KEEP_MS + 10_000_000); // a 的时钟快了很多
    b.restore('x');
    sync(a, b);
    expect(a.todo('x')).toBeDefined();
    expect(a.conflicts()).toEqual([]);
  });

  it('删除时已经看到了对方的修改：不算冲突', () => {
    const [a, b] = pair();
    a.add('x', '原');
    b.pull(a);
    b.rename('x', 'B 改过');
    a.pull(b);
    a.remove('x');
    sync(a, b);
    expect(b.conflicts()).toEqual([]);
  });

  it('彻底删除 vs 修改：也会提示，恢复后用修改过的内容', () => {
    const [a, b] = pair();
    a.add('x', '原');
    b.pull(a);
    a.remove('x');
    a.apply(O.purgeTrashEntry(a.st, a.ctx(), 'x'));
    b.rename('x', '还要用');
    sync(a, b);
    const c = a.conflicts();
    expect(c).toHaveLength(1);
    expect(c[0].kind === 'delete' && c[0].purged).toBe(true);
    a.st = resolveDelete(a.st.doc, a.st.clock, 'x', 'restore', (a.now += 1000));
    sync(a, b);
    expect(b.todo('x')!.title).toBe('还要用');
  });

  it('一边删了整个 profile、另一边同时在里面加了事：提示', () => {
    const [a, b] = pair();
    a.add('x', '原');
    b.pull(a);
    a.st = setProfileDeleted(a.st.doc, a.st.clock, P, true, (a.now += 1000));
    b.add('y', '新的');
    sync(a, b);
    const c = a.conflicts();
    expect(c.map((x) => x.kind)).toEqual(['profile']);
    // 冲突解决之前 profile 仍然显示
    expect(visibleProfiles(a.st.doc).map((p) => p.id)).toEqual([P]);
    a.st = resolveProfile(a.st.doc, a.st.clock, P, 'restore', (a.now += 1000));
    sync(a, b);
    expect(b.conflicts()).toEqual([]);
    expect(b.view().todos.map((t) => t.id).sort()).toEqual(['x', 'y']);
  });
});

describe('回收站（软删除）', () => {
  it('删父项连同子孙进回收站；原父项还在时恢复挂回原处，否则回到原列表顶层', () => {
    const [a] = pair();
    a.add('g', '目标', 'goal');
    a.add('s', '步骤', 'goal', 'g');
    a.add('s2', '小步', 'goal', 's');
    expect(a.remove('s')).toEqual({ entryId: 's', count: 2 });
    expect(a.view().trash[0].items.map((t) => t.id).sort()).toEqual(['s', 's2']);
    expect(a.restore('s')).toBe('goal');
    expect(a.todo('s')!.parentId).toBe('g');

    a.remove('s');
    a.remove('g');
    expect(a.restore('s')).toBe('goal');
    expect(a.todo('s')!.parentId).toBeNull();
    expect(a.todo('s2')!.parentId).toBe('s');
  });

  it('超过 30 天自动写成墓碑；有待决冲突的先不动', () => {
    const [a, b] = pair();
    a.add('x', '一');
    a.add('y', '二');
    b.pull(a);
    a.remove('x');
    a.remove('y');
    b.rename('y', '二改');
    sync(a, b);
    const later = a.now + TRASH_KEEP_MS + 1000;
    a.st = expireTrash(a.st.doc, a.st.clock, later);
    expect(a.st.doc.todos.x.del!.v.purged).toBe(true);
    expect(a.st.doc.todos.y.del!.v.purged).toBeUndefined();
    expect(a.view().trash.map((e) => e.id)).toEqual(['y']);
  });
});

describe('设备文件', () => {
  it('写出再读回内容不变；坏数据一律拒收', () => {
    const [a] = pair();
    a.add('x', '一');
    const text = buildDeviceFile({
      deviceId: 'devA',
      deviceName: 'Mac',
      platform: 'darwin',
      writtenAt: 1,
      seq: 1,
      nonce: 'n',
      knowledge: a.st.clock.knowledge,
      doc: a.st.doc,
    });
    const f = parseDeviceFile(text)!;
    expect(canonicalJson(f.doc)).toBe(canonicalJson(a.st.doc));
    expect(parseDeviceFile(text.slice(0, text.length / 2))).toBeNull();
    expect(parseDeviceFile('{"app":"other"}')).toBeNull();
    expect(parseDeviceFile('null')).toBeNull();
  });

  it('坏掉的寄存器单独丢弃，记录其余部分保留', () => {
    const [a] = pair();
    a.add('x', '一');
    const raw = JSON.parse(
      buildDeviceFile({ deviceId: 'devA', deviceName: 'Mac', platform: '', writtenAt: 1, seq: 1, nonce: 'n', knowledge: {}, doc: a.st.doc }),
    );
    raw.doc.todos.x.status = { v: { done: 'yes' }, s: {} };
    raw.doc.todos['bad id!'] = { id: 'bad id!', p: P, createdAt: 1 };
    const f = parseDeviceFile(JSON.stringify(raw))!;
    expect(f.doc.todos.x.status).toBeUndefined();
    expect(f.doc.todos.x.title!.v.title).toBe('一');
    expect(f.doc.todos['bad id!']).toBeUndefined();
  });
});

describe('迁移', () => {
  it('旧数据的 todos 与回收站都搬进文档，可见列表和回收站保持原样', () => {
    const now = 5_000;
    const todos: Todo[] = [
      { id: 'a', title: 'A', done: false, list: 'focus', parentId: null, createdAt: 1, completedAt: null, order: 1 },
      { id: 'b', title: 'B', done: true, list: 'inbox', parentId: null, createdAt: 2, completedAt: 3, completedFrom: 'focus', order: 2 },
    ];
    const trash = [
      {
        id: 'e1',
        deletedAt: 4,
        rootId: 'c',
        parentId: 'a',
        list: 'focus' as ListId,
        items: [
          { id: 'c', title: 'C', done: false, list: 'focus' as ListId, parentId: 'a', createdAt: 1, completedAt: null, order: 1 },
          { id: 'd', title: 'D', done: false, list: 'focus' as ListId, parentId: 'c', createdAt: 1, completedAt: null, order: 1 },
        ],
      },
    ];
    const { doc } = migrateLegacy([{ id: P, name: '默认', createdAt: 1, todos, trash }], newClock('m'), now);
    const v = viewProfile(doc, P);
    expect(v.todos.map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(v.todos.find((t) => t.id === 'b')!.completedFrom).toBe('focus');
    expect(v.trash.map((e) => [e.id, e.parentId, e.items.length])).toEqual([['c', 'a', 2]]);
    expect(Object.keys(legacyRecords(todos, trash, P, { t: 'x', vv: {} }))).toHaveLength(4);
    expect(docKnowledge(doc)).toEqual({ m: 1 });
  });
});
