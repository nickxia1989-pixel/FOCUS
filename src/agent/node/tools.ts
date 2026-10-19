/// <reference types="node" />
// 三个 MCP 工具：focus_read（只读）、focus_apply（可恢复的批量写）、focus_purge（彻底删除，不可撤销）。
// 每次调用重新判断：桌面开着走实时模式，否则走离线 outbox。
import { randomUUID } from 'node:crypto';
import { emptyDoc } from '../../sync/doc';
import { parseDoc } from '../../sync/file';
import { applyOps, read, type ApplyInput, type Mode, type SyncInfo } from '../core';
import { liveCall } from './live';
import { OfflineError, offlineApply, offlineRead } from './offline';
import { forcedMode, userDataDir } from './paths';

export interface ToolOutput {
  text: string;
  isError?: boolean;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<ToolOutput>;
}

/** 实时模式下桌面回的快照 */
export interface LiveSnapshot {
  doc: unknown;
  activeProfileId: string | null;
  sync: SyncInfo | null;
}

/** 实时模式下桌面回的写入结果 */
export interface LiveApply {
  ok: boolean;
  lines?: string[];
  cursor?: string;
  changed?: boolean;
  error?: string;
}

const join = (...xs: (string | null | undefined)[]) => xs.filter(Boolean).join('；') || null;

async function focusRead(args: Record<string, unknown>): Promise<ToolOutput> {
  const dir = userDataDir();
  const forced = forcedMode();
  let note: string | null = null;
  if (forced !== 'offline') {
    const r = await liveCall<LiveSnapshot>(dir, 'read', {}, 5000);
    if (r.kind === 'ok') {
      const doc = parseDoc(r.value.doc) ?? emptyDoc();
      const out = read(doc, args, { mode: 'live', activeProfileId: r.value.activeProfileId, now: Date.now(), sync: r.value.sync });
      return out.ok ? { text: out.text } : { text: out.error, isError: true };
    }
    if (forced === 'live') return { text: `实时模式不可用：${r.reason}`, isError: true };
    // 读取不改数据，哪种情况改走离线都安全
    if (r.kind !== 'unavailable') note = `桌面接口没有回应（${r.reason}），这次读的是磁盘上的数据`;
  }
  const o = offlineRead(dir);
  const out = read(o.doc, args, { mode: 'offline', activeProfileId: o.activeProfileId, now: Date.now(), sync: o.sync, note: join(note, o.note) });
  return out.ok ? { text: out.text } : { text: out.error, isError: true };
}

function formatApply(mode: Mode, r: LiveApply, note: string | null, pending?: number): ToolOutput {
  if (!r.ok) return { text: `失败（整批没有生效）：${r.error}`, isError: true };
  const where =
    mode === 'live'
      ? '实时：桌面已刷新，约 2 秒后同步'
      : r.changed
        ? `离线：已存进本机 outbox（共 ${pending ?? 0} 条待并入），桌面下次启动时并入并同步`
        : '离线：没有改动';
  return { text: [`ok · ${where} · ${r.lines?.length ?? 0} 项 · cursor ${r.cursor}`, note, ...(r.lines ?? [])].filter(Boolean).join('\n') };
}

async function write(input: ApplyInput, allowPurge: boolean): Promise<ToolOutput> {
  const dir = userDataDir();
  const forced = forcedMode();
  let note: string | null = null;
  if (forced !== 'offline') {
    const r = await liveCall<LiveApply>(dir, 'apply', { input, allowPurge }, 15_000);
    if (r.kind === 'ok') return formatApply('live', r.value, null);
    // 已经发出去了却没等到回复：不能再走离线重做一遍，否则可能重复新增
    if (r.kind === 'unknown')
      return { text: `${r.reason}：这批操作可能已经执行，也可能没有。先 focus_read（可以带 since）确认，再决定要不要重做。`, isError: true };
    if (forced === 'live') return { text: `实时模式不可用：${r.reason}`, isError: true };
    if (r.kind === 'refused') note = `桌面接口拒绝了请求（${r.reason}），改用离线方式写入`;
  }
  try {
    const r = await offlineApply(dir, (st, activeProfileId) =>
      applyOps(st, input, { now: Date.now(), newId: randomUUID, activeProfileId, live: false, allowPurge }),
    );
    return r.ok
      ? formatApply('offline', { ok: true, lines: r.lines, cursor: r.cursor, changed: r.changed }, note, r.pending)
      : formatApply('offline', { ok: false, error: r.error }, note);
  } catch (e) {
    if (e instanceof OfflineError) return { text: e.message, isError: true };
    throw e;
  }
}

const SECTION_ENUM = ['focus', 'verify', 'inbox', 'goal', 'history', 'trash'];
const LIST_ENUM = ['focus', 'verify', 'inbox', 'goal'];
const OP_ENUM = [
  'add',
  'rename',
  'complete',
  'uncomplete',
  'move',
  'test',
  'untest',
  'reorder',
  'focus',
  'unfocus',
  'delete',
  'restore',
  'profile_create',
  'profile_rename',
  'profile_delete',
  'profile_restore',
  'resolve_title',
  'keep_all_titles',
  'resolve_delete',
  'resolve_profile',
  'show',
  'collapse',
  'expand',
  'sync_now',
];

export const TOOLS: Tool[] = [
  {
    name: 'focus_read',
    title: '读取 FOCUS 待办',
    description: [
      '读取 FOCUS 待办，一次拿全量。默认返回所有 profile 的四个列表——FOCUS（当下要做）、VERIFY（做完待测）、INBOX（随手记）、GOAL（长期目标）——以及近 7 天的 HISTORY（完成记录）、回收站、待决冲突和 cursor。',
      '格式：`- [ ] <id> 标题`，每缩进两格是下一级子任务；`[x]` 是已完成；`#待测` 是原地标为待测的子任务；FOCUS 里带 `#聚焦` 的是聚焦区（同时盯着的几件事，排在最前），其余是「接下来」。列表里只列未完成的顶层项（带整棵子树）；已完成的顶层项在 HISTORY 里按完成日期列出，`←FOCUS` 是完成时所在的列表，`↑<id>` 是父项。`## FOCUS · 2` 里的数字是未完成的顶层项数。',
      'id 是唯一前缀，写入时原样使用。',
      '省 token 的用法：用 profile 只看一个 profile；用 sections 只看几个分区；用 query 按关键字搜；过一会儿再看时传 since=上次的 cursor，只返回之后的变化，包括其它设备同步过来的改动。',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        profile: { type: 'string', description: '只看这个 profile（名字或 id）；不填 = 全部' },
        sections: { type: 'array', items: { type: 'string', enum: SECTION_ENUM }, description: '只要这些分区；不填 = 全部' },
        history_days: { type: ['integer', 'string'], description: 'HISTORY 看最近几天，默认 7；0 = 不要；"all" = 全部' },
        trash: { type: 'string', enum: ['summary', 'full'], description: '回收站默认每条一行摘要；full 连子项一起列出' },
        query: { type: 'string', description: '只看标题含这个关键字的条目（连同它的父项和子项）' },
        since: { type: 'string', description: '上次返回的 cursor：只返回之后的变化' },
        format: { type: 'string', enum: ['text', 'json'], description: '默认 text，最省 token；json 适合程序处理' },
      },
      additionalProperties: false,
    },
    annotations: { title: '读取 FOCUS 待办', readOnlyHint: true, openWorldHint: false },
    run: focusRead,
  },
  {
    name: 'focus_apply',
    title: '批量修改 FOCUS 待办',
    description: [
      '批量修改 FOCUS 待办。整批原子执行：任何一条失败都不生效。一次调用就能做完多处改动。ops 按顺序执行，每项是 {op, ...}：',
      '- add {title, list?, parent?, profile?, ref?}：新建，list 不填时进 inbox。给 parent 就是子任务，跟随父项所在的列表。ref 给这条起个名字，本批后面的操作可以写 "$名字" 引用它。同一批里加到同一处的多条按给出的顺序排在最前。',
      '- rename {id, title}',
      '- complete / uncomplete {id}：完成父项时子项一并完成；FOCUS、VERIFY 的顶层项完成后自动移到 INBOX 的已完成。',
      '- move {id, list}：换列表，子孙跟着走；子项换列表会脱离父项，成为顶层。move {id, parent}：改挂到另一条下面。',
      '- test {id}：标为待测，顶层项移进 VERIFY，子项原地标。untest {id}：取消待测，VERIFY 的顶层项退回 FOCUS。',
      '- reorder {id, before|after: 另一条的 id | to: "top"|"bottom" | index}：只在同一父项（或同一列表的顶层）、同为未完成或已完成的条目之间排序。FOCUS 顶层只在聚焦区内或「接下来」内排，进出聚焦区用 focus / unfocus。',
      '- focus {id, to?: "top"|"bottom", index?}：放进 FOCUS 的聚焦区（同时盯着的几件事），默认排在聚焦区最后；别的列表、子项会先整棵移进 FOCUS，已完成的恢复为未完成。unfocus {id}：移出聚焦区，回到「接下来」第一位。',
      '- delete {id}：进回收站，30 天内可恢复。restore {id}：从回收站恢复到原处。',
      '- profile_create {name, ref?} / profile_rename {profile, name} / profile_delete {profile} / profile_restore {profile}：profile 用名字或 id 指定。',
      '- 冲突，只在用户明确要求时处理：resolve_title {id, title} / keep_all_titles {id} / resolve_delete {id, choice: "restore"|"delete"} / resolve_profile {profile, choice}。',
      '- 桌面界面，只在桌面开着时可用：show {profile?, section?} 让桌面切到那里；collapse / expand {id} 折叠或展开子项；sync_now 立即同步。',
      '顶层的 profile 是 add 的默认 profile，不填就是桌面当前的 profile。if_unchanged_since 填 focus_read 返回的 cursor：涉及的条目在那之后被改过（例如用户刚在界面上改了），整批拒绝。',
      '返回每项的结果（含新条目的 id）和新的 cursor，改完不用再读全量。彻底删除用 focus_purge。',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        ops: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: OP_ENUM },
              id: { type: 'string', description: '条目 id（focus_read 里的前缀）或 "$ref"' },
              title: { type: 'string' },
              list: { type: 'string', enum: LIST_ENUM },
              parent: { type: 'string', description: '父项 id 或 "$ref"' },
              profile: { type: 'string', description: 'profile 名字或 id，或 "$ref"' },
              ref: { type: 'string', description: '给新建的条目 / profile 起个名字，本批后面用 "$名字" 引用' },
              before: { type: 'string' },
              after: { type: 'string' },
              to: { type: 'string', enum: ['top', 'bottom'] },
              index: { type: 'integer', minimum: 0 },
              name: { type: 'string', description: 'profile 名字' },
              choice: { type: 'string', enum: ['restore', 'delete'] },
              section: { type: 'string', enum: [...LIST_ENUM, 'history'] },
            },
            required: ['op'],
          },
        },
        profile: { type: 'string', description: 'add 默认加到这个 profile；不填 = 桌面当前的 profile' },
        if_unchanged_since: { type: 'string', description: 'focus_read 返回的 cursor：涉及的条目在那之后被改过就整批拒绝' },
      },
      required: ['ops'],
      additionalProperties: false,
    },
    annotations: { title: '批量修改 FOCUS 待办', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (args) => write(args as ApplyInput, false),
  },
  {
    name: 'focus_purge',
    title: '彻底删除 FOCUS 回收站里的条目',
    description: [
      '彻底删除，不可撤销。只在用户明确要求彻底删除或清空回收站时使用；普通删除用 focus_apply 的 delete，它会进回收站，30 天内能恢复。',
      'ids：回收站里条目的 id（focus_read 回收站部分列出的 id），连同子项一起彻底删除。empty_trash：填 profile 名字，清空它的回收站；填 true 表示桌面当前的 profile。',
      '正常的条目要先用 focus_apply 的 delete 删除，再在这里彻底删除。',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: '回收站条目的 id' },
        empty_trash: { type: ['string', 'boolean'], description: '清空这个 profile 的回收站（名字或 id；true = 当前 profile）' },
      },
      additionalProperties: false,
    },
    annotations: { title: '彻底删除（不可撤销）', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: async (args) => {
      const ops: Record<string, unknown>[] = [];
      const ids = typeof args.ids === 'string' ? [args.ids] : args.ids;
      if (ids !== undefined && !Array.isArray(ids)) return { text: 'ids 要是数组', isError: true };
      for (const id of ids ?? []) ops.push({ op: 'purge', id });
      if (args.empty_trash === true) ops.push({ op: 'empty_trash' });
      else if (typeof args.empty_trash === 'string' && args.empty_trash) ops.push({ op: 'empty_trash', profile: args.empty_trash });
      if (!ops.length) return { text: '要给 ids 或 empty_trash', isError: true };
      return write({ ops }, true);
    },
  },
];

export const INSTRUCTIONS = [
  'FOCUS 是一个桌面 TODO 应用，每个 profile 有 FOCUS / VERIFY / INBOX / GOAL 四个列表，另有 HISTORY（完成记录）和回收站。',
  '用法：先 focus_read 拿全量和 cursor；再用 focus_apply 一次批量改多处。返回里有新条目的 id 和新 cursor，改完不用重读。',
  '想知道别人（用户在界面上、其它设备同步来的）改了什么，用 focus_read 传 since=cursor。',
  '桌面开着时改动立刻显示在界面上；没开时先存在本机，桌面下次启动时并入并同步。',
].join('\n');
