// 随机收敛测试：几台模拟设备随机增删改，随机离线、部分同步、乱序和重复读取，
// 最后全部互相同步，断言各设备完全一致、没有丢记录、冲突在任一设备决定后全体消失。
import { describe, expect, it } from 'vitest';
import { LIST_IDS, type ListId } from '../types';
import { newClock } from './clock';
import {
  createProfile,
  emptyDoc,
  findConflicts,
  keepAllTitles,
  mergeDocs,
  resolveDelete,
  resolveProfile,
  resolveTitle,
  setProfileDeleted,
  updateProfile,
  viewProfile,
  type SyncDoc,
} from './doc';
import { buildDeviceFile, canonicalJson, parseDeviceFile } from './file';
import * as O from './ops';

/** 可复现的随机数（mulberry32） */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const P = 'p1';
const TITLES = ['甲', '乙', '丙', '丁'];

interface Sim {
  id: string;
  st: O.DocState;
  collapsed: O.Collapsed;
  now: number;
  /** 上次"上传"到云端的文件内容；离线时不更新 */
  uploaded: string | null;
  /** 模拟一个早先打开、还没提交的标题编辑框 */
  editBase?: Record<string, number>;
}

function runSeed(seed: number, devices = 3, steps = 260) {
  const r = rng(seed);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(r() * arr.length)];
  const created = new Set<string>();
  let idSeq = 0;
  const newId = () => `t${seed}-${++idSeq}`;

  // 设备的时钟各有偏差，测 HLC 不依赖墙钟准确
  const sims: Sim[] = Array.from({ length: devices }, (_, i) => ({
    id: `d${i}`,
    st: { doc: emptyDoc(), clock: newClock(`d${i}`) },
    collapsed: {},
    now: 1_000_000 + Math.floor(r() * 600_000) - 300_000,
    uploaded: null,
  }));
  {
    const s0 = sims[0];
    s0.st = createProfile(s0.st.doc, s0.st.clock, { id: P, name: '工作' }, s0.now);
  }

  const upload = (s: Sim) => {
    s.uploaded = buildDeviceFile({
      deviceId: s.id,
      deviceName: s.id,
      platform: 'test',
      writtenAt: s.now,
      seq: 1,
      nonce: s.id,
      knowledge: s.st.clock.knowledge,
      doc: s.st.doc,
    });
  };
  const download = (s: Sim, from: Sim) => {
    if (!from.uploaded) return;
    // 偶尔读到半截文件：必须被拒收，不能当成"对方没数据"
    const text = r() < 0.05 ? from.uploaded.slice(0, Math.floor(from.uploaded.length * r())) : from.uploaded;
    const f = parseDeviceFile(text);
    if (!f) return;
    s.now += 5;
    s.st = O.mergeRemote(s.st, f.doc, f.knowledge, s.now);
  };

  const ctx = (s: Sim): O.OpCtx => {
    s.now += 1 + Math.floor(r() * 3000);
    return { profileId: P, collapsed: s.collapsed, now: s.now };
  };
  const apply = <R,>(s: Sim, res: O.DocState & { collapsed: O.Collapsed; result: R }) => {
    s.st = { doc: res.doc, clock: res.clock };
    s.collapsed = res.collapsed;
    return res.result;
  };

  const op = (s: Sim) => {
    if (!s.st.doc.profiles[P]) return;
    const view = viewProfile(s.st.doc, P, s.collapsed);
    const todos = view.todos;
    const any = () => pick(todos);
    const k = r();
    if (k < 0.22 || todos.length === 0) {
      const parent = todos.length && r() < 0.35 ? any() : null;
      const id = newId();
      created.add(id);
      apply(s, O.addTodo(s.st, ctx(s), { id, title: pick(TITLES), list: pick(LIST_IDS) as ListId, parentId: parent?.id ?? null }));
    } else if (k < 0.36) {
      // 一半的改标题带"开始编辑时的知识"，模拟编辑期间收到远端改动
      const base = r() < 0.5 ? (s.editBase ?? null) : null;
      apply(s, O.renameTodo(s.st, ctx(s), any().id, pick(TITLES) + (r() < 0.5 ? '' : s.id), base));
      s.editBase = { ...s.st.clock.knowledge };
    }
    else if (k < 0.46) apply(s, O.completeTodo(s.st, ctx(s), any().id));
    else if (k < 0.52) apply(s, O.uncompleteTodo(s.st, ctx(s), any().id));
    else if (k < 0.58) apply(s, O.moveTodo(s.st, ctx(s), any().id, pick(LIST_IDS) as ListId));
    else if (k < 0.62) apply(s, O.markForTest(s.st, ctx(s), any().id));
    else if (k < 0.68) apply(s, O.reorderTodo(s.st, ctx(s), any().id, Math.floor(r() * 4)));
    else if (k < 0.76) apply(s, O.removeTodo(s.st, ctx(s), any().id));
    else if (k < 0.82 && view.trash.length) apply(s, O.restoreFromTrash(s.st, ctx(s), pick(view.trash).id));
    else if (k < 0.85 && view.trash.length) apply(s, O.purgeTrashEntry(s.st, ctx(s), pick(view.trash).id));
    else if (k < 0.88) s.st = updateProfile(s.st.doc, s.st.clock, P, { name: pick(['工作', '生活', '学习']) }, (s.now += 100));
    else if (k < 0.9) s.st = setProfileDeleted(s.st.doc, s.st.clock, P, true, (s.now += 100));
    else resolveSome(s, 1);
  };

  const resolveSome = (s: Sim, max: number) => {
    const cs = findConflicts(s.st.doc).slice(0, max);
    for (const c of cs) {
      s.now += 100;
      if (c.kind === 'title') {
        if (r() < 0.2) {
          const others = c.options.filter((o) => o.v !== c.options[0].v).map((o) => ({ id: newId(), title: o.v }));
          others.forEach((o) => created.add(o.id));
          s.st = keepAllTitles(s.st.doc, s.st.clock, c.id, c.options[0].v, others, s.now);
        } else s.st = resolveTitle(s.st.doc, s.st.clock, c.id, pick(c.options).v, s.now);
      } else if (c.kind === 'delete') s.st = resolveDelete(s.st.doc, s.st.clock, c.id, r() < 0.5 ? 'restore' : 'delete', s.now);
      else s.st = resolveProfile(s.st.doc, s.st.clock, c.profileId, r() < 0.7 ? 'restore' : 'delete', s.now);
    }
  };

  // 随机阶段：每台设备有时离线（只改本地，不上传也不下载）
  const offline = sims.map(() => false);
  for (let i = 0; i < steps; i++) {
    const s = pick(sims);
    const idx = sims.indexOf(s);
    const k = r();
    if (k < 0.08) offline[idx] = !offline[idx];
    else if (k < 0.62) op(s);
    else if (!offline[idx]) {
      if (k < 0.8) upload(s);
      else download(s, pick(sims));
    }
    // 交换律抽查
    if (i % 37 === 0) {
      const [x, y] = [pick(sims), pick(sims)];
      expect(canonicalJson(mergeDocs(x.st.doc, y.st.doc))).toBe(canonicalJson(mergeDocs(y.st.doc, x.st.doc)));
    }
  }

  // 全部上线、互相同步到稳定
  const fullSync = () => {
    for (let round = 0; round < 3; round++) {
      for (const s of sims) upload(s);
      for (const s of sims) for (const o of sims) if (o !== s) s.st = O.mergeRemote(s.st, o.st.doc, o.st.clock.knowledge, (s.now += 5));
    }
  };
  fullSync();
  const docs = sims.map((s) => canonicalJson(s.st.doc));
  for (const d of docs) expect(d).toBe(docs[0]);

  // 没有丢记录：创建过的每条都还在文档里（删除只是打标记）
  const doc: SyncDoc = sims[0].st.doc;
  for (const id of created) expect(doc.todos[id], `丢了 ${id}`).toBeDefined();

  // 不变量：可见列表里没有"已完成又待测"，子项的列表跟随根
  const v = viewProfile(doc, P);
  const byId = new Map(v.todos.map((t) => [t.id, t]));
  for (const t of v.todos) {
    expect(t.done && t.testing).toBeFalsy();
    if (t.parentId && byId.has(t.parentId)) expect(t.list).toBe(byId.get(t.parentId)!.list);
  }

  // 冲突：各设备看到的一致；全部在一台设备上决定后，同步完所有设备都没有冲突
  const c0 = JSON.stringify(findConflicts(sims[0].st.doc));
  for (const s of sims) expect(JSON.stringify(findConflicts(s.st.doc))).toBe(c0);
  const conflicts = findConflicts(doc).length;
  for (let guard = 0; guard < 5 && findConflicts(sims[0].st.doc).length; guard++) {
    resolveSome(sims[Math.floor(r() * sims.length)], 100);
    fullSync();
  }
  for (const s of sims) expect(findConflicts(s.st.doc)).toEqual([]);
  const after = sims.map((s) => canonicalJson(s.st.doc));
  for (const d of after) expect(d).toBe(after[0]);
  return { conflicts, todos: created.size };
}

describe('随机收敛', () => {
  it('3 台设备、150 组随机种子：最终一致、不丢记录、冲突能全部解决', () => {
    let totalConflicts = 0;
    for (let seed = 1; seed <= 150; seed++) totalConflicts += runSeed(seed).conflicts;
    // 确认随机过程确实制造出了冲突，测试不是空转
    expect(totalConflicts).toBeGreaterThan(10);
  });

  it('4～5 台设备、更长的随机过程', () => {
    for (let seed = 1000; seed < 1030; seed++) runSeed(seed, 4 + (seed % 2), 500);
  });
});
