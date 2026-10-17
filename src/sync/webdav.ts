// 极简 WebDAV 客户端：只用到 PROPFIND / GET / PUT / MKCOL。
// 真正发请求的是各平台的 Transport（桌面走 Electron 主进程，iOS 走原生 HTTP），这里只拼请求、解析结果。

export type HttpResult =
  | { ok: true; status: number; body: string; headers: Record<string, string> }
  | { ok: false; error: 'network' | 'timeout' | 'config'; message: string };

export interface HttpRequest {
  method: 'PROPFIND' | 'GET' | 'PUT' | 'MKCOL' | 'DELETE';
  /** 相对 WebDAV 根地址的路径，例如 "FOCUS/devices/abc.json"；目录以 / 结尾 */
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface Transport {
  request(req: HttpRequest): Promise<HttpResult>;
}

export interface DavEntry {
  name: string;
  isDir: boolean;
  /** 毫秒；坚果云只精确到秒 */
  lastModified: number;
  size: number;
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

const tag = (name: string) => new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i');

/** 解析 207 Multi-Status。不依赖 DOMParser（单元测试在 Node 里跑），对命名空间前缀不敏感 */
export function parseMultistatus(xml: string): (DavEntry & { href: string })[] {
  const out: (DavEntry & { href: string })[] = [];
  const re = /<(?:[\w-]+:)?response(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const hrefRaw = tag('href').exec(block)?.[1]?.trim();
    if (!hrefRaw) continue;
    const href = decodeXml(hrefRaw);
    const isDir = /<(?:[\w-]+:)?collection\s*\/?>/i.test(block);
    const lm = tag('getlastmodified').exec(block)?.[1];
    const len = tag('getcontentlength').exec(block)?.[1];
    let name = href.replace(/\/+$/, '').split('/').pop() ?? '';
    try {
      name = decodeURIComponent(name);
    } catch {}
    out.push({
      href,
      name,
      isDir,
      lastModified: lm ? Date.parse(decodeXml(lm.trim())) || 0 : 0,
      size: len ? Number(len.trim()) || 0 : 0,
    });
  }
  return out;
}

const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getlastmodified/><d:getcontentlength/></d:prop></d:propfind>';

export type DavError = { kind: 'network' | 'timeout' | 'config' | 'auth' | 'ratelimit' | 'missing' | 'forbidden' | 'http'; status?: number; message: string };

export function toError(r: HttpResult): DavError {
  if (!r.ok) return { kind: r.error, message: r.message };
  if (r.status === 401) return { kind: 'auth', status: 401, message: '账号或应用密码不对' };
  if (r.status === 503) return { kind: 'ratelimit', status: 503, message: '坚果云限流，稍后自动重试' };
  if (r.status === 404 || r.status === 409) return { kind: 'missing', status: r.status, message: '文件夹不存在' };
  if (r.status === 403) return { kind: 'forbidden', status: 403, message: '没有权限' };
  if (r.status >= 500) return { kind: 'http', status: r.status, message: `服务器暂时出错（${r.status}），稍后自动重试` };
  return { kind: 'http', status: r.status, message: `服务器返回 ${r.status}` };
}

export class Dav {
  constructor(private t: Transport) {}

  /** 列目录（Depth 1），不含目录自身 */
  async list(dir: string): Promise<{ entries: DavEntry[] } | { error: DavError }> {
    const path = dir === '' || dir.endsWith('/') ? dir : `${dir}/`;
    const r = await this.t.request({
      method: 'PROPFIND',
      path,
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-cache' },
      body: PROPFIND_BODY,
    });
    if (!r.ok || r.status !== 207) return { error: toError(r) };
    const self = path.replace(/\/+$/, '').split('/').pop();
    const all = parseMultistatus(r.body);
    // 第一条是目录自己
    const entries = all.filter((e, i) => !(i === 0 && e.isDir && (e.name === self || all.length === 1)));
    return { entries };
  }

  async get(path: string): Promise<{ body: string } | { error: DavError }> {
    // 不走任何缓存：原生 HTTP 默认会按缓存策略返回旧内容
    const r = await this.t.request({ method: 'GET', path, headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } });
    if (r.ok && r.status === 200) return { body: r.body };
    return { error: toError(r) };
  }

  async put(path: string, body: string): Promise<{ ok: true } | { error: DavError }> {
    const r = await this.t.request({ method: 'PUT', path, headers: { 'Content-Type': 'application/json' }, body });
    if (r.ok && r.status >= 200 && r.status < 300) return { ok: true };
    return { error: toError(r) };
  }

  /** 建目录；已存在也算成功 */
  async mkcol(path: string): Promise<{ ok: true } | { error: DavError }> {
    const r = await this.t.request({ method: 'MKCOL', path: path.endsWith('/') ? path : `${path}/` });
    if (r.ok && (r.status === 201 || r.status === 405 || r.status === 200)) return { ok: true };
    return { error: toError(r) };
  }
}
