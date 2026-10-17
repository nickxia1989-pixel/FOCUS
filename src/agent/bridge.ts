// 桌面渲染进程这边的 AI agent 接口：
// - 实时模式：响应主进程（electron/agent.cjs）转来的读写请求，在 store 的文档上执行，界面立刻刷新；
// - 离线模式的善后：启动时、outbox 变化时，把 agent 写的 outbox 像远端设备一样并入，并尽快上传。
import { api } from '../platform';
import { showToast, useData } from '../store';
import { parseDeviceFile } from '../sync/file';
import { requestUpload, syncNow } from '../syncDesktop';
import { applyOps, summarize, type ApplyInput, type SyncInfo } from './core';

const newId = () => crypto.randomUUID();

async function mergeOutbox() {
  const text = await api!.readAgentOutbox();
  const f = text ? parseDeviceFile(text) : null;
  if (f && useData.getState().mergePeer(f.doc, f.knowledge)) requestUpload();
}

function syncInfo(): SyncInfo {
  const s = useData.getState();
  return {
    enabled: s.local.sync.enabled,
    state: s.syncStatus?.state,
    lastSyncAt: s.syncStatus?.lastSyncAt ?? s.local.sync.meta.lastSyncAt,
    pending: s.syncStatus?.pending,
  };
}

function handle(method: string, params: unknown): unknown {
  const s = useData.getState();
  if (method === 'read') return { doc: s.doc, activeProfileId: s.profileId || null, sync: syncInfo() };
  if (method !== 'apply') throw new Error(`未知方法 ${method}`);
  const { input, allowPurge } = (params ?? {}) as { input?: ApplyInput; allowPurge?: boolean };
  let result: ReturnType<typeof applyOps> | null = null;
  useData.getState().applyExternal((st) => {
    result = applyOps(st, input ?? {}, { now: Date.now(), newId, activeProfileId: s.profileId || null, live: true, allowPurge: !!allowPurge });
    return result.ok && result.changed ? result.state : null;
  });
  const r = result as ReturnType<typeof applyOps> | null;
  if (!r) throw new Error('没有执行');
  if (!r.ok) return { ok: false, error: r.error };
  if (r.ui.show) {
    const { profileId, view } = r.ui.show;
    void useData
      .getState()
      .switchProfile(profileId)
      .then(() => view && useData.getState().setPrefs({ activeView: view }));
  }
  if (r.ui.syncNow) syncNow();
  const toast = summarize(r.counts);
  if (toast) showToast(toast);
  return { ok: true, lines: r.lines, cursor: r.cursor, changed: r.changed };
}

let started = false;

function start() {
  if (started || !api?.onAgentRequest) return;
  started = true;
  api.onAgentRequest(({ id, method, params }) => {
    try {
      api!.agentRespond({ id, ok: true, value: handle(method, params) });
    } catch (e) {
      api!.agentRespond({ id, ok: false, error: String((e as Error)?.message ?? e) });
    }
  });
  api.onAgentOutbox(() => void mergeOutbox());
  // 选了「以云端为准」：替换完成后再并入一次，免得 agent 的改动在替换时被清掉
  useData.subscribe((s, prev) => {
    if (prev.local.sync.replacePending && !s.local.sync.replacePending) void mergeOutbox();
  });
  void mergeOutbox().finally(() => api!.agentReady());
}

/** 数据加载完再挂接口；在 main.tsx 里调用 */
export function initAgentBridge() {
  if (!api?.onAgentRequest) return;
  if (useData.getState().loaded) return start();
  const off = useData.subscribe((s) => {
    if (!s.loaded) return;
    off();
    start();
  });
}
