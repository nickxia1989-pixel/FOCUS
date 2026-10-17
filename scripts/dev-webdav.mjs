// 本机 WebDAV 测试服务器：联调同步用，按坚果云的特点模拟（修改时间精确到秒、不给 ETag、父目录不存在回 409）。
// 只监听 127.0.0.1。管理接口 /__admin/* 用来模拟断网、限流、慢网和随机失败。
//
//   node scripts/dev-webdav.mjs [--port 8765] [--root .dev-webdav] [--user focus-dev] [--pass focus-dev-pass]
//                               [--etag] [--no-root-mkcol]
//
// 地址：http://127.0.0.1:<port>/dav/
// 管理：
//   GET  /__admin/state                 当前状态
//   POST /__admin/state  {offline, blockDevices, rateLimited, latencyMs, failRate}
//        offline=true 时所有请求直接断开连接；blockDevices 只断开带对应 X-Focus-Device 头的请求
//   GET  /__admin/log?since=<seq>       最近的请求记录（用来数请求次数）
//   POST /__admin/reset                 清空所有文件和状态
// 联调命令队列（只有用 VITE_FOCUS_E2E=1 构建的 iOS 测试包会来取）：
//   POST /__e2e/push {client, cmd, args} → {id}；GET /__e2e/next?client=ios；POST /__e2e/result；GET /__e2e/result?id=
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const PORT = Number(opt('port', '8765'));
const ROOT = path.resolve(opt('root', '.dev-webdav'));
const USER = opt('user', 'focus-dev');
const PASS = opt('pass', 'focus-dev-pass');
const WITH_ETAG = flag('etag');
const NO_ROOT_MKCOL = flag('no-root-mkcol');
const BASE = '/dav';

mkdirSync(ROOT, { recursive: true });

const state = { offline: false, blockDevices: [], rateLimited: false, latencyMs: 0, failRate: 0 };
const log = [];
let seq = 0;

const expectedAuth = `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`;

/** URL 路径 → 磁盘路径；拒绝越界 */
function diskPath(urlPath) {
  const rel = decodeURIComponent(urlPath.slice(BASE.length)).replace(/^\/+/, '');
  const full = path.resolve(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

const httpDate = (ms) => new Date(Math.floor(ms / 1000) * 1000).toUTCString();
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function propXml(href, st, isDir) {
  const name = decodeURIComponent(href.replace(/\/$/, '').split('/').pop() || '');
  const etag = WITH_ETAG && !isDir ? `<d:getetag>"${st.size}-${Math.floor(st.mtimeMs)}"</d:getetag>` : '';
  return `<d:response><d:href>${esc(href)}</d:href><d:propstat><d:prop>` +
    `<d:displayname>${esc(name)}</d:displayname>` +
    `<d:getlastmodified>${httpDate(st.mtimeMs)}</d:getlastmodified>` +
    (isDir ? '<d:resourcetype><d:collection/></d:resourcetype>' : `<d:resourcetype/><d:getcontentlength>${st.size}</d:getcontentlength>${etag}`) +
    '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>';
}

const encodeHref = (p) => p.split('/').map((s) => encodeURIComponent(s)).join('/');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, body = '', headers = {}) {
  res.writeHead(status, { 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

const e2eQueue = new Map(); // client → [{id, cmd, args}]
const e2eResults = new Map(); // id → result
let e2eSeq = 0;

async function handleE2e(req, res, url) {
  const json = (status, v) => send(res, status, JSON.stringify(v), { 'Content-Type': 'application/json' });
  if (url.pathname === '/__e2e/push' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const id = ++e2eSeq;
    const q = e2eQueue.get(body.client) ?? [];
    q.push({ id, cmd: body.cmd, args: body.args ?? {} });
    e2eQueue.set(body.client, q);
    return json(200, { id });
  }
  if (url.pathname === '/__e2e/next') {
    const q = e2eQueue.get(url.searchParams.get('client')) ?? [];
    const next = q.shift();
    return next ? json(200, next) : json(200, null);
  }
  if (url.pathname === '/__e2e/result' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    e2eResults.set(Number(body.id), body);
    return json(200, { ok: true });
  }
  if (url.pathname === '/__e2e/result') {
    const r = e2eResults.get(Number(url.searchParams.get('id')));
    return r ? json(200, r) : json(404, null);
  }
  return send(res, 404, 'not found');
}

async function handleAdmin(req, res, url) {
  if (url.pathname === '/__admin/state') {
    if (req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      for (const k of Object.keys(state)) if (k in body) state[k] = body[k];
    }
    return send(res, 200, JSON.stringify(state), { 'Content-Type': 'application/json' });
  }
  if (url.pathname === '/__admin/log') {
    const since = Number(url.searchParams.get('since') ?? 0);
    return send(res, 200, JSON.stringify(log.filter((e) => e.seq > since)), { 'Content-Type': 'application/json' });
  }
  if (url.pathname === '/__admin/reset' && req.method === 'POST') {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    Object.assign(state, { offline: false, blockDevices: [], rateLimited: false, latencyMs: 0, failRate: 0 });
    log.length = 0;
    return send(res, 200, '{"ok":true}', { 'Content-Type': 'application/json' });
  }
  return send(res, 404, 'not found');
}

async function handleDav(req, res, url) {
  const full = diskPath(url.pathname);
  if (!full) return send(res, 403, 'forbidden');
  const exists = existsSync(full);
  const st = exists ? statSync(full) : null;

  switch (req.method) {
    case 'OPTIONS':
      return send(res, 200, '', { DAV: '1, 2', Allow: 'OPTIONS, GET, PUT, DELETE, MKCOL, PROPFIND' });

    case 'PROPFIND': {
      await readBody(req);
      if (!st) return send(res, 404, 'Not Found');
      const depth = req.headers.depth ?? '1';
      if (depth === 'infinity') return send(res, 403, 'Depth infinity not supported');
      const selfHref = url.pathname.endsWith('/') || !st.isDirectory() ? url.pathname : `${url.pathname}/`;
      let xml = propXml(selfHref, st, st.isDirectory());
      if (st.isDirectory() && depth === '1') {
        for (const name of readdirSync(full)) {
          if (name.endsWith('.tmp')) continue;
          const cst = statSync(path.join(full, name));
          const href = `${selfHref}${encodeURIComponent(name)}${cst.isDirectory() ? '/' : ''}`;
          xml += propXml(href, cst, cst.isDirectory());
        }
      }
      const body = `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${xml}</d:multistatus>`;
      return send(res, 207, body, { 'Content-Type': 'application/xml; charset=utf-8' });
    }

    case 'GET': {
      if (!st) return send(res, existsSync(path.dirname(full)) ? 404 : 409, 'Not Found');
      if (st.isDirectory()) return send(res, 405, 'Method Not Allowed');
      const data = readFileSync(full);
      const headers = { 'Content-Type': 'application/octet-stream', 'Last-Modified': httpDate(st.mtimeMs) };
      if (WITH_ETAG) headers.ETag = `"${st.size}-${Math.floor(st.mtimeMs)}"`;
      res.writeHead(200, { 'Content-Length': data.length, ...headers });
      return res.end(data);
    }

    case 'PUT': {
      const body = await readBody(req);
      if (!existsSync(path.dirname(full))) return send(res, 409, 'Conflict');
      if (st?.isDirectory()) return send(res, 405, 'Method Not Allowed');
      const tmp = `${full}.tmp`;
      writeFileSync(tmp, body);
      renameSync(tmp, full);
      return send(res, st ? 204 : 201, '');
    }

    case 'MKCOL': {
      await readBody(req);
      if (st) return send(res, 405, 'Method Not Allowed');
      if (!existsSync(path.dirname(full))) return send(res, 409, 'Conflict');
      if (NO_ROOT_MKCOL && path.dirname(full) === ROOT) return send(res, 403, 'Forbidden');
      mkdirSync(full);
      return send(res, 201, '');
    }

    case 'DELETE':
      if (!st) return send(res, 404, 'Not Found');
      rmSync(full, { recursive: true, force: true });
      return send(res, 204, '');

    default:
      return send(res, 405, 'Method Not Allowed');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // 允许浏览器里调试的页面跨域访问（真机走原生 HTTP 不需要；坚果云本身不支持跨域）
  if (req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, MKCOL, PROPFIND, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Depth, Cache-Control, Pragma, X-Focus-Device');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') return send(res, 204, '');
  }
  if (url.pathname.startsWith('/__admin/')) return handleAdmin(req, res, url);
  if (url.pathname.startsWith('/__e2e/')) return handleE2e(req, res, url);

  const device = req.headers['x-focus-device'] ?? '';
  const entry = { seq: ++seq, at: Date.now(), method: req.method, path: decodeURIComponent(url.pathname), device, status: 0 };
  log.push(entry);
  if (log.length > 5000) log.shift();

  // 模拟断网：直接断开连接，客户端拿到的是网络错误而不是 HTTP 状态码
  if (state.offline || (device && state.blockDevices.includes(device))) {
    entry.status = 'dropped';
    return req.socket.destroy();
  }
  if (state.latencyMs) await new Promise((r) => setTimeout(r, state.latencyMs));
  if (state.rateLimited) {
    entry.status = 503;
    return send(res, 503, 'Too many requests have been received recently (BlockedTemporarily)');
  }
  if (state.failRate && Math.random() < state.failRate) {
    entry.status = 500;
    return send(res, 500, 'Internal Server Error');
  }
  if (req.headers.authorization !== expectedAuth) {
    entry.status = 401;
    return send(res, 401, 'Unauthorized', { 'WWW-Authenticate': 'Basic realm="nutstore"' });
  }
  if (!url.pathname.startsWith(BASE)) {
    entry.status = 404;
    return send(res, 404, 'Not Found');
  }
  try {
    res.on('finish', () => (entry.status = res.statusCode));
    await handleDav(req, res, url);
  } catch (e) {
    entry.status = 500;
    send(res, 500, String(e));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev-webdav] http://127.0.0.1:${PORT}${BASE}/  root=${ROOT}  user=${USER}${WITH_ETAG ? '  etag' : ''}`);
});
