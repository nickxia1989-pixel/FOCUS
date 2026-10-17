/// <reference types="node" />
// 极简 MCP 服务端（stdio）：一行一条 JSON-RPC 2.0 消息。只实现工具相关的方法，不依赖 SDK。
// stdout 只写协议消息，日志一律走 stderr。
import type { Tool } from './tools';

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

type Id = string | number | null;
type Msg = { jsonrpc?: string; id?: Id; method?: unknown; params?: unknown };

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const reply = (id: Id, result: unknown) => ({ jsonrpc: '2.0', id, result });
const fail = (id: Id, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

export interface ServerInfo {
  name: string;
  title: string;
  version: string;
  instructions: string;
  tools: Tool[];
}

export function createMcpServer(info: ServerInfo) {
  const byName = new Map(info.tools.map((t) => [t.name, t]));

  async function one(m: unknown): Promise<unknown | null> {
    if (!isObj(m) || typeof (m as Msg).method !== 'string') {
      const id = isObj(m) && (typeof m.id === 'string' || typeof m.id === 'number') ? m.id : null;
      // 客户端发来的回复（我们不发请求，所以不会有）直接忽略
      if (isObj(m) && ('result' in m || 'error' in m)) return null;
      return fail(id, -32600, 'Invalid Request');
    }
    const { id, method, params } = m as Msg & { method: string };
    const isNotification = id === undefined;
    try {
      switch (method) {
        case 'initialize': {
          const asked = isObj(params) && typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOLS[0];
          return reply(id ?? null, {
            protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: info.name, title: info.title, version: info.version },
            instructions: info.instructions,
          });
        }
        case 'ping':
          return isNotification ? null : reply(id ?? null, {});
        case 'tools/list':
          return reply(id ?? null, {
            tools: info.tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })),
          });
        case 'tools/call': {
          if (!isObj(params) || typeof params.name !== 'string') return fail(id ?? null, -32602, 'tools/call 需要 name');
          const tool = byName.get(params.name);
          if (!tool) return fail(id ?? null, -32602, `Unknown tool: ${params.name}`);
          const args = params.arguments === undefined ? {} : params.arguments;
          if (!isObj(args)) return fail(id ?? null, -32602, 'arguments 要是对象');
          let out;
          try {
            out = await tool.run(args);
          } catch (e) {
            process.stderr.write(`[focus-mcp] ${tool.name} 出错：${(e as Error)?.stack ?? e}\n`);
            out = { text: `内部错误：${(e as Error)?.message ?? e}`, isError: true };
          }
          return reply(id ?? null, { content: [{ type: 'text', text: out.text }], isError: !!out.isError });
        }
        default:
          // 通知（initialized、cancelled 等）不需要回复
          if (isNotification) return null;
          return fail(id ?? null, -32601, `Method not found: ${method}`);
      }
    } catch (e) {
      return isNotification ? null : fail(id ?? null, -32603, String((e as Error)?.message ?? e));
    }
  }

  /** 处理一条消息（或一批）；返回要写回的消息，没有就是 null */
  async function handle(m: unknown): Promise<unknown | null> {
    if (Array.isArray(m)) {
      if (!m.length) return fail(null, -32600, 'Invalid Request');
      const outs = (await Promise.all(m.map(one))).filter((x) => x !== null);
      return outs.length ? outs : null;
    }
    return one(m);
  }

  return { handle };
}

/** 接上 stdin / stdout。消息按到达顺序一条条处理，写入的先后和请求一致 */
export function serveStdio(server: ReturnType<typeof createMcpServer>) {
  let buf = '';
  let chain = Promise.resolve();
  const send = (x: unknown) => process.stdout.write(`${JSON.stringify(x)}\n`);
  const onLine = (line: string) => {
    chain = chain.then(async () => {
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        send(fail(null, -32700, 'Parse error'));
        return;
      }
      const out = await server.handle(msg);
      if (out !== null) send(out);
    });
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  });
  process.stdin.on('end', () => {
    if (buf.trim()) onLine(buf.trim());
    void chain.then(() => process.exit(0));
  });
}
