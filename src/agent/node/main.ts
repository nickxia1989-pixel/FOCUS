/// <reference types="node" />
// focus-mcp：不带参数时是 MCP 服务端（stdio）；带子命令时是命令行工具，方便脚本和调试。
//   focus-mcp                       启动 MCP（Claude Code / Claude 桌面版等客户端用这个）
//   focus-mcp read  ['<JSON>']      等同 focus_read，例如 focus-mcp read '{"sections":["focus"]}'
//   focus-mcp apply '<JSON>' | -    等同 focus_apply；"-" 从标准输入读 JSON
//   focus-mcp purge '<JSON>' | -    等同 focus_purge
//   focus-mcp status                数据目录、桌面是否开着、outbox 里待并入的改动
// 环境变量：FOCUS_USER_DATA 指定数据目录（和桌面版一致）；FOCUS_AGENT_MODE=live|offline 强制只走一种模式。
import fs from 'node:fs';
import { version } from '../../../package.json';
import { createMcpServer, serveStdio } from './mcp';
import { agentDeviceId, offlineRead, readOutbox } from './offline';
import { files, forcedMode, userDataDir } from './paths';
import { INSTRUCTIONS, TOOLS } from './tools';

const USAGE = `用法：
  focus-mcp                     启动 MCP 服务端（stdio）
  focus-mcp read  ['<JSON>']    读取（参数同 focus_read）
  focus-mcp apply '<JSON>' | -  批量修改（参数同 focus_apply，"-" 从标准输入读）
  focus-mcp purge '<JSON>' | -  彻底删除（参数同 focus_purge）
  focus-mcp status              数据目录、桌面是否开着、outbox 状态
环境变量：FOCUS_USER_DATA=<数据目录>  FOCUS_AGENT_MODE=live|offline`;

async function readArg(raw: string | undefined): Promise<Record<string, unknown>> {
  let text = raw ?? '{}';
  if (raw === '-') {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    text = Buffer.concat(chunks).toString('utf8');
  }
  const v = JSON.parse(text) as unknown;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('参数要是 JSON 对象');
  return v as Record<string, unknown>;
}

function status() {
  const dir = userDataDir();
  const f = files(dir);
  let endpoint = '没有（桌面没开）';
  try {
    const e = JSON.parse(fs.readFileSync(f.endpoint, 'utf8')) as { port: number; pid: number };
    endpoint = `127.0.0.1:${e.port}（pid ${e.pid}）`;
  } catch {}
  const o = offlineRead(dir);
  const out = readOutbox(dir);
  return [
    `数据目录：${dir}`,
    `本地接口：${endpoint}`,
    `强制模式：${forcedMode() ?? '无（自动）'}`,
    `agent 设备 id：${agentDeviceId(dir) ?? '还没有（第一次离线写入时生成）'}`,
    `outbox：${out ? `第 ${out.seq} 次写入，${new Date(out.writtenAt).toLocaleString()}` : '没有'}`,
    o.note ? `提示：${o.note}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (!cmd) {
    serveStdio(createMcpServer({ name: 'focus', title: 'FOCUS', version, instructions: INSTRUCTIONS, tools: TOOLS }));
    return;
  }
  if (cmd === 'status') return void process.stdout.write(`${status()}\n`);
  const tool = { read: 'focus_read', apply: 'focus_apply', purge: 'focus_purge' }[cmd];
  if (!tool) {
    process.stdout.write(`${USAGE}\n`);
    process.exitCode = cmd === 'help' || cmd === '--help' || cmd === '-h' ? 0 : 2;
    return;
  }
  const out = await TOOLS.find((t) => t.name === tool)!.run(await readArg(arg));
  process.stdout.write(`${out.text}\n`);
  if (out.isError) process.exitCode = 1;
}

main().catch((e) => {
  process.stderr.write(`${(e as Error)?.message ?? e}\n`);
  process.exitCode = 1;
});
