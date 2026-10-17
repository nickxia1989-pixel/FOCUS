/// <reference types="node" />
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeHlc, newClock } from '../../sync/clock';
import * as D from '../../sync/doc';
import * as O from '../../sync/ops';
import { applyOps } from '../core';
import { OfflineError, offlineApply, offlineRead, readOutbox, withLock } from './offline';
import { files } from './paths';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-agent-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** 模拟桌面：自己的文档和时钟，存进 focus-doc.json / focus-local.json */
class Desk {
  st: O.DocState;
  constructor() {
    this.st = D.createProfile(D.emptyDoc(), newClock('desk000001'), { id: 'default', name: '工作' }, 1000);
  }
  save() {
    fs.writeFileSync(files(dir).doc, JSON.stringify(this.st.doc));
    fs.writeFileSync(files(dir).local, JSON.stringify({ version: 2, activeProfileId: 'default', clock: this.st.clock, sync: { enabled: false, meta: {} } }));
  }
  add(title: string) {
    const r = O.addTodo(this.st, { profileId: 'default', collapsed: {}, now: Date.now() }, { id: randomUUID(), title, list: 'inbox' });
    this.st = { doc: r.doc, clock: r.clock };
  }
  rename(from: string, to: string) {
    const r = O.renameTodo(this.st, { profileId: 'default', collapsed: {}, now: Date.now() }, this.idOf(from), to);
    this.st = { doc: r.doc, clock: r.clock };
  }
  idOf(title: string) {
    return Object.values(this.st.doc.todos).find((t) => t.title?.v.title === title)!.id;
  }
  /** 桌面启动时并入 outbox（store.mergePeer 做的事） */
  mergeOutbox() {
    const f = readOutbox(dir);
    if (f) this.st = O.mergeRemote(this.st, f.doc, f.knowledge, Date.now());
  }
  titles() {
    return D.viewProfile(this.st.doc, 'default')
      .todos.map((t) => t.title)
      .sort();
  }
}

const agent = (ops: unknown[]) =>
  offlineApply(dir, (st, activeProfileId) => applyOps(st, { ops }, { now: Date.now(), newId: randomUUID, activeProfileId, live: false, allowPurge: false }));

const agentTitles = () =>
  D.viewProfile(offlineRead(dir).doc, 'default')
    .todos.map((t) => t.title)
    .sort();

const agentId = () => (JSON.parse(fs.readFileSync(files(dir).state, 'utf8')) as { deviceId: string }).deviceId;

describe('离线 outbox', () => {
  it('还没有桌面数据时拒绝写入', async () => {
    await expect(agent([{ op: 'add', title: 'x' }])).rejects.toBeInstanceOf(OfflineError);
    fs.writeFileSync(path.join(dir, 'profiles.json'), '{}');
    await expect(agent([{ op: 'add', title: 'x' }])).rejects.toThrow('迁移');
  });

  it('改动写进 outbox，用 agent 自己的设备 id 打戳，不碰桌面的文件', async () => {
    const desk = new Desk();
    desk.add('桌面上的');
    desk.save();
    const before = fs.readFileSync(files(dir).doc, 'utf8');
    const localBefore = fs.readFileSync(files(dir).local, 'utf8');
    const r = await agent([{ op: 'add', title: 'agent 加的', list: 'focus' }]);
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(files(dir).doc, 'utf8')).toBe(before);
    expect(fs.readFileSync(files(dir).local, 'utf8')).toBe(localBefore);
    const out = readOutbox(dir)!;
    expect(out.platform).toBe('agent');
    expect(out.deviceId).toBe(agentId());
    expect(out.deviceId).not.toBe('desk000001');
    const recs = Object.values(out.doc.todos);
    expect(recs.map((t) => t.title?.v.title)).toEqual(['agent 加的']);
    for (const n of D.TODO_REGS) expect(decodeHlc(recs[0][n]!.s.t).deviceId).toBe(out.deviceId);
    // agent 的戳看过桌面的全部改动：不会被误判成并发
    expect(recs[0].title!.s.vv.desk000001).toBe(desk.st.clock.counter);
    expect(agentTitles()).toEqual(['agent 加的', '桌面上的']);
    expect(offlineRead(dir).note).toContain('1 条改动');
  });

  it('桌面并入并保存以后，outbox 在下一次写入时自动清空', async () => {
    const desk = new Desk();
    desk.save();
    await agent([{ op: 'add', title: '一' }]);
    desk.mergeOutbox();
    desk.save();
    expect(offlineRead(dir).note).toBeNull();
    await agent([{ op: 'add', title: '二' }]);
    expect(Object.values(readOutbox(dir)!.doc.todos).map((t) => t.title?.v.title)).toEqual(['二']);
    desk.mergeOutbox();
    expect(desk.titles()).toEqual(['一', '二']);
  });

  it('同时来的多次写入排队执行：一条不丢，agent 的计数不重号', async () => {
    const desk = new Desk();
    desk.save();
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => agent([{ op: 'add', title: `t${i}` }])));
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(agentTitles()).toHaveLength(12);
    const out = readOutbox(dir)!;
    expect(out.knowledge[out.deviceId]).toBe(12);
    const counters = Object.values(out.doc.todos).map((t) => t.title!.s.vv[out.deviceId]);
    expect(new Set(counters).size).toBe(12);
    expect(fs.existsSync(files(dir).lock)).toBe(false);
  });

  it('agent 和桌面并发改同一条标题：并入后按冲突规则交给用户决定', async () => {
    const desk = new Desk();
    desk.add('买菜');
    desk.save();
    const read = offlineRead(dir).doc;
    const id = Object.keys(read.todos)[0];
    await agent([{ op: 'rename', id, title: '买水果' }]);
    desk.rename('买菜', '买菜和水果'); // 桌面这边没看到 agent 的改动
    desk.mergeOutbox();
    const c = D.findConflicts(desk.st.doc);
    expect(c).toHaveLength(1);
    expect(c[0].kind).toBe('title');
  });

  it('数据目录被拷到别的电脑：换一个新的 agent id，保留已知的知识', async () => {
    const desk = new Desk();
    desk.save();
    await agent([{ op: 'add', title: '一' }]);
    const first = agentId();
    const st = JSON.parse(fs.readFileSync(files(dir).state, 'utf8'));
    fs.writeFileSync(files(dir).state, JSON.stringify({ ...st, machine: 'another-machine' }));
    await agent([{ op: 'add', title: '二' }]);
    const second = agentId();
    expect(second).not.toBe(first);
    const out = readOutbox(dir)!;
    expect(out.knowledge[first]).toBe(1);
    expect(out.knowledge[second]).toBe(1);
    expect(agentTitles()).toEqual(['一', '二']);
  });

  it('锁的持有者已经退出：直接接管', async () => {
    fs.mkdirSync(files(dir).agentDir, { recursive: true });
    fs.writeFileSync(files(dir).lock, `999999 ${Date.now()} dead`);
    expect(await withLock(dir, () => 42, 500)).toBe(42);
    fs.writeFileSync(files(dir).lock, `${process.pid} ${Date.now()} alive`);
    await expect(withLock(dir, () => 1, 100)).rejects.toThrow('占用');
  });
});
