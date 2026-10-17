import { describe, expect, it } from 'vitest';
import { decodeHlc, newClock } from '../sync/clock';
import * as D from '../sync/doc';
import * as O from '../sync/ops';
import { applyOps, cursorOf, read, shortIds, summarize, type AgentState, type ApplyEnv, type Meta } from './core';

const T0 = new Date(2026, 9, 17, 15, 20).getTime();

let seq = 0;
/** 确定性的 32 位十六进制 id */
function newId() {
  seq++;
  let x = (seq * 2654435761) >>> 0;
  let h = '';
  for (let i = 0; i < 4; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    h += x.toString(16).padStart(8, '0');
  }
  return h;
}

const env = (p: Partial<ApplyEnv> = {}): ApplyEnv => ({ now: T0, newId, activeProfileId: 'default', live: false, allowPurge: false, ...p });
const meta = (p: Partial<Meta> = {}): Meta => ({ mode: 'offline', activeProfileId: 'default', now: T0, sync: null, ...p });

function fresh(deviceId = 'dev1'): AgentState {
  const e = D.createProfile(D.emptyDoc(), newClock(deviceId), { id: 'default', name: '工作' }, T0 - 86_400_000);
  return { doc: e.doc, clock: e.clock, collapsed: {} };
}

function apply(st: AgentState, ops: unknown[], extra: Record<string, unknown> = {}, e: Partial<ApplyEnv> = {}) {
  const r = applyOps(st, { ops, ...extra }, env(e));
  if (!r.ok) throw new Error(r.error);
  return r;
}

const idOf = (st: AgentState, title: string) => {
  const r = Object.values(st.doc.todos).find((t) => t.title?.v.title === title);
  if (!r) throw new Error(`no ${title}`);
  return r.id;
};

const todo = (st: AgentState, title: string) => D.viewProfile(st.doc, 'default').todos.find((t) => t.title === title)!;

const text = (st: AgentState, input: Record<string, unknown> = {}, m: Partial<Meta> = {}) => {
  const r = read(st.doc, input, meta(m));
  if (!r.ok) throw new Error(r.error);
  return r.text;
};

/** 上手示例那样的一组数据 */
function sample() {
  let st = fresh();
  st = apply(st, [
    { op: 'add', title: '写周报', list: 'focus', ref: 'w' },
    { op: 'add', title: '收集数据', parent: '$w' },
    { op: 'add', title: '画图', parent: '$w', ref: 'pic' },
    { op: 'test', id: '$pic' },
    { op: 'add', title: '买菜' },
    { op: 'add', title: '回邮件', ref: 'mail' },
    { op: 'complete', id: '$mail' },
    { op: 'add', title: '学滑雪', list: 'goal', ref: 'ski' },
    { op: 'add', title: '买装备', parent: '$ski' },
  ]).state;
  st = apply(st, [{ op: 'complete', id: idOf(st, '收集数据') }]).state;
  return st;
}

describe('批量写入', () => {
  it('新增：ref 引用、子任务跟随父项列表、默认进 INBOX、同一批按给出的顺序排在最前', () => {
    const st = sample();
    const v = D.viewProfile(st.doc, 'default').todos;
    const w = todo(st, '写周报');
    expect(w.list).toBe('focus');
    expect(v.filter((t) => t.parentId === w.id).every((t) => t.list === 'focus')).toBe(true);
    expect(todo(st, '买菜').list).toBe('inbox');
    const kids = v.filter((t) => t.parentId === w.id).sort((a, b) => b.order - a.order).map((t) => t.title);
    expect(kids).toEqual(['收集数据', '画图']);
    // 再加一批到 INBOX：A B 按顺序排在最前，都在原来的条目前面
    const r = apply(st, [
      { op: 'add', title: 'A' },
      { op: 'add', title: 'B' },
    ]);
    const roots = D.viewProfile(r.state.doc, 'default')
      .todos.filter((t) => t.list === 'inbox' && !t.parentId && !t.done)
      .sort((a, b) => b.order - a.order)
      .map((t) => t.title);
    expect(roots).toEqual(['A', 'B', '买菜']);
  });

  it('每个寄存器都经本机时钟打戳；完成父项时子项是连带改动', () => {
    const st = sample();
    for (const r of Object.values(st.doc.todos))
      for (const n of D.TODO_REGS) if (r[n]) expect(decodeHlc(r[n]!.s.t).deviceId).toBe('dev1');
    const r = apply(st, [{ op: 'complete', id: idOf(st, '写周报') }]);
    const kid = r.state.doc.todos[idOf(st, '画图')];
    expect(kid.status!.v.done).toBe(true);
    expect(kid.status!.d).toBe(1);
    expect(r.state.doc.todos[idOf(st, '写周报')].status!.d).toBeUndefined();
    expect(r.lines[0]).toContain('移到 INBOX 的已完成');
    expect(r.state.clock.counter).toBe(st.clock.counter + 1);
  });

  it('不修改传入的状态；任何一条失败整批不生效', () => {
    const st = sample();
    const before = JSON.stringify(st.doc);
    const r = applyOps(st, { ops: [{ op: 'add', title: '新的' }, { op: 'complete', id: 'zzzzzz' }] }, env());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/第 2 项（complete）：找不到 id「zzzzzz」/);
    expect(JSON.stringify(st.doc)).toBe(before);
  });

  it('移动：换列表、子项脱离父项、改挂父项、不能成环', () => {
    const st = sample();
    let r = apply(st, [{ op: 'move', id: idOf(st, '买菜'), list: 'FOCUS' }]);
    expect(todo(r.state, '买菜').list).toBe('focus');
    r = apply(r.state, [{ op: 'move', id: idOf(st, '画图'), list: 'inbox' }]);
    expect(todo(r.state, '画图')).toMatchObject({ list: 'inbox', parentId: null });
    expect(r.lines[0]).toContain('脱离原父项');
    r = apply(r.state, [{ op: 'move', id: idOf(st, '买菜'), parent: idOf(st, '学滑雪') }]);
    expect(todo(r.state, '买菜')).toMatchObject({ list: 'goal', parentId: idOf(st, '学滑雪') });
    const bad = applyOps(r.state, { ops: [{ op: 'move', id: idOf(st, '学滑雪'), parent: idOf(st, '买装备') }] }, env());
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain('子孙');
    const both = applyOps(r.state, { ops: [{ op: 'move', id: idOf(st, '买菜'), list: 'goal', parent: idOf(st, '学滑雪') }] }, env());
    expect(both.ok).toBe(false);
  });

  it('待测：顶层进 VERIFY、子项原地标；untest 让 VERIFY 顶层项退回 FOCUS', () => {
    const st = sample();
    let r = apply(st, [{ op: 'test', id: idOf(st, '买菜') }]);
    expect(todo(r.state, '买菜').list).toBe('verify');
    expect(todo(r.state, '画图').testing).toBe(true);
    r = apply(r.state, [
      { op: 'untest', id: idOf(st, '买菜') },
      { op: 'untest', id: idOf(st, '画图') },
    ]);
    expect(todo(r.state, '买菜').list).toBe('focus');
    expect(todo(r.state, '画图').testing).toBe(false);
  });

  it('排序：before / after / to / index，只在同一组里', () => {
    let st = sample();
    st = apply(st, [
      { op: 'add', title: 'a' },
      { op: 'add', title: 'b' },
      { op: 'add', title: 'c' },
    ]).state;
    const order = (s: AgentState) =>
      D.viewProfile(s.doc, 'default')
        .todos.filter((t) => t.list === 'inbox' && !t.parentId && !t.done)
        .sort((x, y) => y.order - x.order)
        .map((t) => t.title)
        .join('');
    expect(order(st)).toBe('abc买菜');
    st = apply(st, [{ op: 'reorder', id: idOf(st, 'c'), before: idOf(st, 'a') }]).state;
    expect(order(st)).toBe('cab买菜');
    st = apply(st, [{ op: 'reorder', id: idOf(st, 'c'), to: 'bottom' }]).state;
    expect(order(st)).toBe('ab买菜c');
    st = apply(st, [{ op: 'reorder', id: idOf(st, '买菜'), index: 0 }]).state;
    expect(order(st)).toBe('买菜abc');
    st = apply(st, [{ op: 'reorder', id: idOf(st, 'a'), after: idOf(st, 'b') }]).state;
    expect(order(st)).toBe('买菜bac');
    const bad = applyOps(st, { ops: [{ op: 'reorder', id: idOf(st, 'a'), before: idOf(st, '写周报') }] }, env());
    expect(bad.ok).toBe(false);
  });

  it('删除进回收站、恢复；彻底删除只能走 focus_purge', () => {
    const st = sample();
    const ski = idOf(st, '学滑雪');
    let r = apply(st, [{ op: 'delete', id: ski }]);
    expect(r.lines[0]).toContain('含 1 个子项');
    const child = applyOps(r.state, { ops: [{ op: 'restore', id: idOf(st, '买装备') }] }, env());
    expect(child.ok).toBe(false);
    if (!child.ok) expect(child.error).toContain('学滑雪');
    const noPurge = applyOps(r.state, { ops: [{ op: 'purge', id: ski }] }, env());
    expect(noPurge.ok).toBe(false);
    if (!noPurge.ok) expect(noPurge.error).toContain('focus_purge');
    r = apply(r.state, [{ op: 'restore', id: ski }]);
    expect(todo(r.state, '买装备').parentId).toBe(ski);
    r = apply(r.state, [{ op: 'delete', id: ski }]);
    const purged = apply(r.state, [{ op: 'purge', id: ski }], {}, { allowPurge: true });
    expect(purged.state.doc.todos[ski].del!.v.purged).toBe(true);
    const onlyPurge = applyOps(r.state, { ops: [{ op: 'add', title: 'x' }] }, env({ allowPurge: true }));
    expect(onlyPurge.ok).toBe(false);
    const visible = applyOps(st, { ops: [{ op: 'purge', id: ski }] }, env({ allowPurge: true }));
    expect(visible.ok).toBe(false);
    if (!visible.ok) expect(visible.error).toContain('先用 focus_apply 的 delete');
  });

  it('id：显示至少 6 位的唯一前缀；输入可用 4 位以上的唯一前缀，有歧义时报错不猜', () => {
    const m = shortIds(['abcdef1234567890', 'abcdef9934567890', 'ffff00001111aaaa', 'default']);
    expect(m.get('abcdef1234567890')).toBe('abcdef1');
    expect(m.get('ffff00001111aaaa')).toBe('ffff00');
    expect(m.get('default')).toBe('default');
    let st = fresh();
    const ids = ['abcd1111000000000000000000000000', 'abcd2222000000000000000000000000'];
    let i = 0;
    st = apply(st, [{ op: 'add', title: '一' }, { op: 'add', title: '二' }], {}, { newId: () => ids[i++] }).state;
    const amb = applyOps(st, { ops: [{ op: 'complete', id: 'abcd' }] }, env());
    expect(amb.ok).toBe(false);
    if (!amb.ok) expect(amb.error).toMatch(/有歧义.*abcd11.*abcd22/);
    const short = applyOps(st, { ops: [{ op: 'complete', id: 'abc' }] }, env());
    expect(short.ok).toBe(false);
    const ok = apply(st, [{ op: 'complete', id: 'ABCD2' }]);
    expect(ok.lines[0]).toContain('二');
  });

  it('profile：新建（可用 ref）、改名、重名报错、至少保留一个、删除后恢复', () => {
    let st = fresh();
    let r = apply(st, [
      { op: 'profile_create', name: '  生活  ', ref: 'p' },
      { op: 'add', title: '遛狗', profile: '$p' },
    ]);
    st = r.state;
    const life = D.visibleProfiles(st.doc).find((p) => p.name === '生活')!;
    expect(D.viewProfile(st.doc, life.id).todos.map((t) => t.title)).toEqual(['遛狗']);
    expect(applyOps(st, { ops: [{ op: 'profile_create', name: '工作' }] }, env()).ok).toBe(false);
    r = apply(st, [{ op: 'profile_rename', profile: '生活', name: '家' }]);
    expect(r.lines[0]).toBe('1 profile_rename 生活 → 家');
    r = apply(r.state, [{ op: 'profile_delete', profile: '家' }]);
    expect(D.visibleProfiles(r.state.doc).map((p) => p.name)).toEqual(['工作']);
    expect(text(r.state)).toContain('已删除的 profile：家');
    expect(applyOps(r.state, { ops: [{ op: 'profile_delete', profile: '工作' }] }, env()).ok).toBe(false);
    r = apply(r.state, [{ op: 'profile_restore', profile: '家' }]);
    expect(D.visibleProfiles(r.state.doc).map((p) => p.name)).toEqual(['工作', '家']);
  });

  it('if_unchanged_since：涉及的条目在 cursor 之后被改过就整批拒绝', () => {
    const st = sample();
    const cursor = cursorOf(st.doc);
    // 旅行者在界面上改了「买菜」
    const ui = O.renameTodo(st, { profileId: 'default', collapsed: {}, now: T0 + 1 }, idOf(st, '买菜'), '买菜和水果');
    const st2: AgentState = { doc: ui.doc, clock: ui.clock, collapsed: {} };
    const r = applyOps(st2, { if_unchanged_since: cursor, ops: [{ op: 'rename', id: idOf(st, '买菜'), title: '买水果' }] }, env());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('「买菜和水果」');
    expect(apply(st2, [{ op: 'complete', id: idOf(st, '写周报') }], { if_unchanged_since: cursor }).ok).toBe(true);
  });

  it('冲突：读取时列出，resolve_title / keep_all_titles 处理', () => {
    const a = sample();
    const id = idOf(a, '买菜');
    // 另一台设备并发改了同一条标题
    let b: O.DocState = O.mergeRemote({ doc: D.emptyDoc(), clock: newClock('dev2') }, a.doc, a.clock.knowledge, T0);
    b = O.renameTodo(b, { profileId: 'default', collapsed: {}, now: T0 + 5 }, id, '买水果');
    const ra = apply(a, [{ op: 'rename', id, title: '买菜和水果' }]);
    const merged = O.mergeRemote({ doc: ra.state.doc, clock: ra.state.clock }, b.doc, b.clock.knowledge, T0 + 10);
    const st: AgentState = { ...merged, collapsed: {} };
    const t = text(st);
    expect(t).toMatch(/## 冲突 · 1\n- 标题冲突 \w+：现在「买(菜和)?水果」，候选 「买(菜和)?水果」 「买(菜和)?水果」 → resolve_title \/ keep_all_titles/);
    const keep = apply(st, [{ op: 'keep_all_titles', id }]);
    expect(D.findConflicts(keep.state.doc)).toEqual([]);
    expect(D.viewProfile(keep.state.doc, 'default').todos.filter((x) => x.title.startsWith('买')).length).toBe(3);
    const pick = apply(st, [{ op: 'resolve_title', id, title: '买水果' }]);
    expect(D.findConflicts(pick.state.doc)).toEqual([]);
    expect(todo(pick.state, '买水果')).toBeTruthy();
    expect(applyOps(pick.state, { ops: [{ op: 'resolve_title', id, title: 'x' }] }, env()).ok).toBe(false);
  });

  it('界面类操作：离线模式拒绝；实时模式返回效果，折叠不动文档', () => {
    const st = sample();
    const off = applyOps(st, { ops: [{ op: 'show', section: 'goal' }] }, env());
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.error).toContain('需要桌面开着');
    const r = apply(
      st,
      [
        { op: 'show', profile: '工作', section: 'GOAL' },
        { op: 'collapse', id: idOf(st, '写周报') },
        { op: 'sync_now' },
      ],
      {},
      { live: true },
    );
    expect(r.ui).toEqual({ show: { profileId: 'default', view: 'goal' }, syncNow: true });
    expect(r.state.doc).toBe(st.doc);
    expect(r.state.collapsed[idOf(st, '写周报')]).toBe(true);
    expect(r.counts).toEqual({});
  });

  it('提示条文字', () => {
    expect(summarize({ add: 2, complete: 1, resolve_title: 1, keep_all_titles: 1 })).toBe('AI：新增 2 · 处理冲突 2 · 完成 1');
    expect(summarize({ add: 4, test: 1, move: 1, reorder: 1, complete: 1 })).toBe('AI：新增 4 · 标待测 1 · 移动 1 等 8 处');
    expect(summarize({})).toBeNull();
  });
});

describe('读取', () => {
  it('紧凑文本：列表只列未完成顶层项和子树，已完成的顶层项进 HISTORY，带回收站', () => {
    let st = sample();
    st = apply(st, [{ op: 'delete', id: idOf(st, '学滑雪') }]).state;
    const t = text(st);
    const sid = (title: string) => shortIds(Object.keys(st.doc.todos)).get(idOf(st, title));
    expect(t.split('\n')[0]).toMatch(/^FOCUS · 离线.* · 10-17 15:20 · cursor c1\.dev1:\w+$/);
    expect(t).toContain('profile：工作 [default]（当前）');
    expect(t).toContain(
      ['## FOCUS · 1', `- [ ] ${sid('写周报')} 写周报`, `  - [ ] ${sid('画图')} 画图 #待测`, `  - [x] ${sid('收集数据')} 收集数据`].join('\n'),
    );
    expect(t).toContain('## VERIFY · 空');
    expect(t).toContain(`## INBOX · 1 · 另有 1 条已完成（见 HISTORY）\n- [ ] ${sid('买菜')} 买菜`);
    expect(t).toContain('## GOAL · 空');
    expect(t).toContain('## HISTORY · 近 7 天 2 条 · 共 2 条\n10-17 周六（今天）\n');
    expect(t).toContain(`\n  15:20 ${sid('回邮件')} 回邮件 ←INBOX\n`);
    expect(t).toContain(`\n  15:20 ${sid('收集数据')} 收集数据 ←FOCUS ↑${sid('写周报')}「写周报」\n`);
    expect(t).toContain(`## 回收站 · 1\n- ${sid('学滑雪')} 学滑雪 · GOAL · 10-17 删除 · 含 1 个子项`);
    const full = text(st, { trash: 'full', sections: ['trash'] });
    expect(full).toContain(`  - [ ] ${sid('买装备')} 买装备`);
    expect(full).not.toContain('## FOCUS');
  });

  it('按 profile、分区、关键字过滤；history_days', () => {
    const st = sample();
    const q = text(st, { query: '图' });
    expect(q).toContain('写周报');
    expect(q).toContain('画图');
    expect(q).not.toContain('买菜');
    expect(text(st, { sections: ['inbox'] })).not.toContain('## FOCUS');
    expect(text(st, { history_days: 0 })).not.toContain('## HISTORY');
    expect(text(st, { history_days: 'all' })).toContain('## HISTORY · 全部 2 条');
    expect(read(st.doc, { profile: '不存在' }, meta()).ok).toBe(false);
    expect(read(st.doc, { sections: ['nope'] }, meta()).ok).toBe(false);
  });

  it('JSON 格式', () => {
    const st = sample();
    const j = JSON.parse(text(st, { format: 'json' }));
    expect(j.cursor).toBe(cursorOf(st.doc));
    const focus = j.profiles[0].lists.focus.items;
    expect(focus[0].t).toBe('写周报');
    expect(focus[0].kids.map((k: { t: string; test?: number; done?: number }) => [k.t, k.test ?? 0, k.done ?? 0])).toEqual([
      ['画图', 1, 0],
      ['收集数据', 0, 1],
    ]);
  });

  it('since：只列 cursor 之后的变化，包括刚同步来、时间更早的改动', () => {
    const st = sample();
    const cursor = cursorOf(st.doc);
    expect(text(st, { since: cursor })).toContain('没有变化');
    // 另一台设备（时钟慢一小时）在 cursor 之前就知道的基础上改了一条，之后才同步过来
    let other: O.DocState = O.mergeRemote({ doc: D.emptyDoc(), clock: newClock('dev2') }, st.doc, st.clock.knowledge, T0 - 3_600_000);
    other = O.completeTodo(other, { profileId: 'default', collapsed: {}, now: T0 - 3_600_000 }, idOf(st, '买菜'));
    let r = apply(st, [
      { op: 'add', title: '新想法' },
      { op: 'rename', id: idOf(st, '写周报'), title: '写周报（周五前）' },
      { op: 'delete', id: idOf(st, '学滑雪') },
    ]);
    const merged = O.mergeRemote({ doc: r.state.doc, clock: r.state.clock }, other.doc, other.clock.knowledge, T0 + 100);
    const t = text({ ...merged, collapsed: {} }, { since: cursor });
    expect(t).toContain('4 处变化');
    expect(t).toMatch(/\+ 工作\/INBOX \[ \] \w+ 新想法/);
    expect(t).toMatch(/~ 工作\/FOCUS \[ \] \w+ 写周报（周五前）（标题）/);
    expect(t).toMatch(/~ 工作\/INBOX \[x\] \w+ 买菜（状态）/);
    expect(t).toMatch(/- 工作 \w+ 学滑雪 → 进了回收站/);
    r = apply({ ...merged, collapsed: {} }, [{ op: 'add', title: 'x' }]);
    expect(text(r.state, { since: r.cursor })).toContain('没有变化');
    expect(read(st.doc, { since: 'bogus' }, meta()).ok).toBe(false);
  });
});
