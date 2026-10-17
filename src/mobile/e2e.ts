// 联调专用：只有 VITE_FOCUS_E2E=1 构建的测试包才会加载（见 main.tsx），正式包里没有这段代码。
// 从本机测试服务器取命令，经过真实的 store、原生 HTTP 和钥匙串执行，把结果回传。
import { CapacitorHttp } from '@capacitor/core';
import type { ListId, Todo } from '../types';
import { useChrome } from './chrome';
import { activeOf, useData } from './store';
import { disableSync, enableSync, loadConfig, probeCloud, saveConfig, setSimulatedOffline, syncNow } from './sync';
import { useUi } from './ui';

const BASE = 'http://127.0.0.1:8765/__e2e';

const find = (title: string): Todo => {
  const t = activeOf(useData.getState())?.todos.find((x) => x.title === title);
  if (!t) throw new Error(`找不到「${title}」`);
  return t;
};

const commands: Record<string, (a: Record<string, unknown>) => unknown> = {
  config: (a) => saveConfig(a as Parameters<typeof saveConfig>[0]),
  loadConfig: () => loadConfig(),
  probe: () => probeCloud(),
  enable: (a) => enableSync((a.mode as 'merge' | 'cloud') ?? 'merge').then(() => true),
  disable: () => disableSync(),
  offline: (a) => setSimulatedOffline(!!a.flag),
  syncNow: () => syncNow(),
  section: (a) => useData.getState().setSection(a.name as ListId),
  add: (a) => useData.getState().add(String(a.title), (a.list as ListId) ?? 'inbox'),
  rename: (a) => useData.getState().rename(find(String(a.from)).id, String(a.to), useData.getState().clock.knowledge),
  remove: (a) => useData.getState().remove(find(String(a.title)).id),
  complete: (a) => useData.getState().complete(find(String(a.title)).id),
  move: (a) => useData.getState().move(find(String(a.title)).id, a.list as ListId),
  switchProfile: (a) => {
    const p = useData.getState().profiles.find((x) => x.name === a.name);
    if (!p) throw new Error(`找不到空间「${a.name}」`);
    useData.getState().switchProfile(p.id);
  },
  resolveTitle: (a) => {
    const c = useData.getState().conflicts.find((x) => x.kind === 'title' && x.options.some((o) => o.v === a.title));
    if (!c || c.kind !== 'title') throw new Error('没有这个标题冲突');
    useData.getState().resolveTitle(c.id, String(a.title));
  },
  resolveDelete: (a) => {
    const c = useData.getState().conflicts.find((x) => x.kind === 'delete' && x.title === a.title);
    if (!c || c.kind !== 'delete') throw new Error('没有这个删除冲突');
    useData.getState().resolveDelete(c.id, a.choice as 'restore' | 'delete');
  },
  sheet: (a) => useUi.getState().set({ sheet: (a.name as 'sync' | 'conflicts' | null) ?? null }),
  // 只动界面、不改数据的联调命令（Duo 合上时模拟器点不了，靠它们截各种状态）
  ui: (a) => useUi.getState().set(a as Parameters<ReturnType<typeof useUi.getState>['set']>[0]),
  /** 原生外壳报来的几何信息（栏占掉的边距、折痕、铰链、页签位置） */
  chrome: () => useChrome.getState().geo,
  /** 在页面里执行一段表达式并返回结果（读布局、滚动、量尺寸） */
  eval: (a) => (0, eval)(String(a.js)),
  state: () => {
    const s = useData.getState();
    return {
      deviceId: s.clock.deviceId,
      active: activeOf(s)?.name,
      profiles: s.profiles.map((p) => ({ name: p.name, todos: p.todos.map((t) => (t.done ? `✓${t.title}` : t.title)), trash: p.trash.length })),
      status: s.syncStatus,
      conflicts: s.conflicts.map((c) => (c.kind === 'title' ? `title:${c.options.map((o) => o.v).join('|')}` : c.kind === 'delete' ? `delete:${c.title}` : `profile:${c.name}`)),
      sheet: useUi.getState().sheet,
    };
  },
};

async function poll() {
  for (;;) {
    try {
      const r = await CapacitorHttp.get({ url: `${BASE}/next?client=ios`, responseType: 'json' });
      const job = (typeof r.data === 'string' ? JSON.parse(r.data || 'null') : r.data) as { id: number; cmd: string; args: Record<string, unknown> } | null;
      if (job) {
        let out: Record<string, unknown>;
        try {
          const fn = commands[job.cmd];
          if (!fn) throw new Error(`未知命令 ${job.cmd}`);
          out = { id: job.id, ok: true, value: (await fn(job.args)) ?? null };
        } catch (e) {
          out = { id: job.id, ok: false, error: String((e as Error)?.message ?? e) };
        }
        await CapacitorHttp.post({ url: `${BASE}/result`, headers: { 'Content-Type': 'application/json' }, data: out });
        continue;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
}

void poll();
