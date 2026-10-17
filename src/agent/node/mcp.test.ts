/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { createMcpServer } from './mcp';
import { TOOLS } from './tools';

const server = createMcpServer({
  name: 'focus',
  title: 'FOCUS',
  version: '0.0.0',
  instructions: 'test',
  tools: [
    { name: 'echo', title: 'Echo', description: 'd', inputSchema: { type: 'object' }, annotations: {}, run: async (a) => ({ text: JSON.stringify(a) }) },
    { name: 'boom', title: 'Boom', description: 'd', inputSchema: { type: 'object' }, annotations: {}, run: async () => Promise.reject(new Error('坏了')) },
  ],
});

describe('MCP 协议', () => {
  it('initialize：认得的版本原样回，不认得的回最新版', async () => {
    const a = (await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })) as { result: { protocolVersion: string; capabilities: unknown } };
    expect(a.result.protocolVersion).toBe('2025-03-26');
    expect(a.result.capabilities).toEqual({ tools: { listChanged: false } });
    const b = (await server.handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })) as { result: { protocolVersion: string } };
    expect(b.result.protocolVersion).toBe('2025-11-25');
  });

  it('通知不回复；不认识的方法报 -32601', async () => {
    expect(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect(await server.handle({ jsonrpc: '2.0', id: 3, method: 'resources/list' })).toMatchObject({ error: { code: -32601 } });
  });

  it('tools/call：参数原样交给工具；未知工具报错；工具抛错变成 isError 结果', async () => {
    expect(await server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'echo', arguments: { a: 1 } } })).toEqual({
      jsonrpc: '2.0',
      id: 4,
      result: { content: [{ type: 'text', text: '{"a":1}' }], isError: false },
    });
    expect(await server.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } })).toMatchObject({ error: { code: -32602 } });
    expect(await server.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'boom' } })).toMatchObject({ result: { isError: true } });
  });

  it('批量消息', async () => {
    const out = await server.handle([
      { jsonrpc: '2.0', id: 7, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/cancelled' },
    ]);
    expect(out).toEqual([{ jsonrpc: '2.0', id: 7, result: {} }]);
  });

  it('三个 FOCUS 工具：名字、只读 / 破坏性标记', () => {
    expect(TOOLS.map((t) => [t.name, t.annotations.readOnlyHint, t.annotations.destructiveHint])).toEqual([
      ['focus_read', true, undefined],
      ['focus_apply', false, false],
      ['focus_purge', false, true],
    ]);
  });
});
