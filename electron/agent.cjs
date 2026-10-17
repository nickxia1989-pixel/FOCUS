// AI agent 本地接口（实时模式）：桌面开着时，MCP 进程经这里把读写交给渲染进程的 store 执行，界面立刻刷新。
// 只绑 127.0.0.1；每次启动换随机端口和随机令牌，写进只有本人可读的 agent-endpoint.json，退出时删掉。
// 另外监听 agent/outbox.json（桌面没开时 agent 写下的改动），有变化就通知渲染进程并入。
// 设置环境变量 FOCUS_AGENT=off 可以关掉。
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/** 和 src/agent/core.ts 的 AGENT_API 一致 */
const AGENT_API = 1;
const MAX_BODY = 1024 * 1024;
const RENDERER_TIMEOUT_MS = 10_000;

function startAgentServer({ app, ipcMain, userDir, getWin }) {
  if (process.env.FOCUS_AGENT === 'off') return { stop() {} };
  const endpointFile = path.join(userDir, 'agent-endpoint.json');
  const agentDir = path.join(userDir, 'agent');
  const outboxFile = path.join(agentDir, 'outbox.json');
  const token = crypto.randomBytes(32).toString('base64url');
  const expected = Buffer.from(`Bearer ${token}`);

  // ---------- 和渲染进程之间 ----------

  /** 已经挂好接口的页面（webContents id）；页面开始重载时清掉，等它重新报到 */
  let readyId = null;
  let seq = 0;
  const pending = new Map();

  ipcMain.on('agent:ready', (e) => {
    readyId = e.sender.id;
  });
  ipcMain.on('agent:response', (e, msg) => {
    const p = msg && pending.get(msg.id);
    if (!p || p.senderId !== e.sender.id) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    p.resolve(msg);
  });
  ipcMain.handle('agent:readOutbox', () => {
    try {
      return fs.readFileSync(outboxFile, 'utf8');
    } catch {
      return null;
    }
  });
  app.on('web-contents-created', (_e, wc) => {
    const reset = () => {
      if (wc.id === readyId) readyId = null;
    };
    wc.on('did-start-loading', reset);
    wc.on('render-process-gone', reset);
    wc.on('destroyed', reset);
  });

  const liveWin = () => {
    const w = getWin();
    return w && !w.isDestroyed() && w.webContents.id === readyId && !w.webContents.isLoading() ? w : null;
  };

  function toRenderer(method, params) {
    const w = liveWin();
    if (!w) return Promise.resolve({ unavailable: true });
    const id = ++seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ timeout: true });
      }, RENDERER_TIMEOUT_MS);
      pending.set(id, { resolve, timer, senderId: w.webContents.id });
      w.webContents.send('agent:request', { id, method, params });
    });
  }

  // ---------- HTTP ----------

  const send = (res, status, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    res.end(body);
  };

  let port = 0;
  const server = http.createServer((req, res) => {
    // 防 DNS 重绑定：Host 只能是本机地址。网页发来的请求都带 Origin，一律拒绝，也不回任何 CORS 头
    const host = req.headers.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 403, { ok: false, error: 'Host 不对' });
    if (req.headers.origin !== undefined) return send(res, 403, { ok: false, error: '不接受浏览器发来的请求' });
    if (req.method !== 'POST' || req.url !== '/v1/rpc') return send(res, 404, { ok: false, error: '没有这个接口' });
    const auth = Buffer.from(String(req.headers.authorization || ''));
    if (auth.length !== expected.length || !crypto.timingSafeEqual(auth, expected)) return send(res, 401, { ok: false, error: '令牌不对' });
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return send(res, 415, { ok: false, error: '要用 application/json' });
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        send(res, 413, { ok: false, error: '请求太大' });
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', async () => {
      if (size > MAX_BODY) return;
      let msg;
      try {
        msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(res, 400, { ok: false, error: '请求不是 JSON' });
      }
      if (!msg || msg.api !== AGENT_API) return send(res, 409, { ok: false, error: `接口版本不一致：桌面是 ${AGENT_API}，请求是 ${msg && msg.api}` });
      if (msg.method !== 'read' && msg.method !== 'apply') return send(res, 400, { ok: false, error: '未知方法' });
      const r = await toRenderer(msg.method, msg.params ?? null);
      if (r.unavailable) return send(res, 503, { ok: false, reason: '桌面界面还没就绪（窗口没开或正在加载）' });
      if (r.timeout) return send(res, 504, { ok: false, reason: '桌面界面没有及时回应' });
      if (!r.ok) return send(res, 500, { ok: false, error: r.error || '桌面执行出错' });
      send(res, 200, { ok: true, value: r.value });
    });
  });
  server.on('error', (e) => console.error('[agent] 本地接口出错', e));
  server.listen(0, '127.0.0.1', () => {
    port = server.address().port;
    try {
      const tmp = `${endpointFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ api: AGENT_API, port, token, pid: process.pid, startedAt: Date.now() }), { mode: 0o600 });
      fs.renameSync(tmp, endpointFile);
    } catch (e) {
      console.error('[agent] 写 agent-endpoint.json 失败', e);
    }
  });

  // ---------- 监听 outbox ----------

  const sig = () => {
    try {
      const st = fs.statSync(outboxFile);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return 'none';
    }
  };
  let lastSig = sig();
  const check = () => {
    const s = sig();
    if (s === lastSig) return;
    lastSig = s;
    // 界面没就绪时不用管：页面加载完会自己读一次 outbox
    const w = liveWin();
    if (w && s !== 'none') w.webContents.send('agent:outbox');
  };
  let debounce = null;
  let watcher = null;
  try {
    fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
    watcher = fs.watch(agentDir, (_ev, name) => {
      if (name && String(name) !== 'outbox.json') return;
      clearTimeout(debounce);
      debounce = setTimeout(check, 80);
    });
  } catch {}
  // fs.watch 偶尔会漏，再加一个慢速兜底
  const poll = setInterval(check, 2000);

  return {
    stop() {
      clearInterval(poll);
      clearTimeout(debounce);
      if (watcher) watcher.close();
      server.close();
      try {
        const cur = JSON.parse(fs.readFileSync(endpointFile, 'utf8'));
        if (cur.pid === process.pid) fs.rmSync(endpointFile, { force: true });
      } catch {}
    },
  };
}

module.exports = { startAgentServer };
