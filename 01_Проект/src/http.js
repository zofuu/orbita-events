// Минимальный HTTP-каркас: маршрутизатор, разбор форм и cookie, ответы, статические файлы.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from './config.js';

export class HttpError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export async function readForm(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Слишком большой запрос');
    chunks.push(c);
  }
  const type = String(req.headers['content-type'] ?? '');
  if (!type.startsWith('application/x-www-form-urlencoded')) return {};
  const out = {};
  for (const [k, v] of new URLSearchParams(Buffer.concat(chunks).toString('utf8'))) out[k] = v;
  return out;
}

const MIME = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
};
const COMPRESSIBLE = /^(text\/|application\/(xml|json)|image\/svg)/;

export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

// Отправка ответа; сжатие gzip, если клиент его поддерживает
export function send(ctx, status, body, headers = {}) {
  const { req, res } = ctx;
  const type = headers['Content-Type'] ?? 'text/html; charset=utf-8';
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  const h = { ...SECURITY_HEADERS, ...headers, 'Content-Type': type };
  if (ctx.setCookies?.length) h['Set-Cookie'] = ctx.setCookies;
  if (COMPRESSIBLE.test(type) && buf.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    buf = zlib.gzipSync(buf, { level: 6 });
    h['Content-Encoding'] = 'gzip';
    h.Vary = 'Accept-Encoding';
  }
  h['Content-Length'] = buf.length;
  res.writeHead(status, h);
  res.end(req.method === 'HEAD' ? undefined : buf);
}

export function redirect(ctx, location, status = 303) {
  send(ctx, status, '', { Location: location });
}

export function serveStatic(ctx, prefix, dir) {
  const rel = decodeURIComponent(ctx.url.pathname.slice(prefix.length));
  const file = path.join(dir, rel);
  if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new HttpError(404, 'Файл не найден');
  }
  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const cache = { ETag: etag, 'Cache-Control': 'public, max-age=86400' };
  if (ctx.req.headers['if-none-match'] === etag) return send(ctx, 304, '', cache);
  send(ctx, 200, fs.readFileSync(file), { 'Content-Type': MIME[ext] ?? 'application/octet-stream', ...cache });
}

// Маршрутизатор: '/events/:id' → регулярное выражение
export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler, opts = {}) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, pattern, re, keys, handler, opts });
  }
  get(p, h, o) { this.add('GET', p, h, o); }
  post(p, h, o) { this.add('POST', p, h, o); }
  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return { route: null, pathMatched };
  }
}

// Допускаются только внутренние адреса вида /путь (защита от открытого перенаправления)
export const safeLocal = (n) => (typeof n === 'string' && /^\/(?![/\\])[^\s]*$/.test(n) ? n : '');

export const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const PUBLIC_DIR = path.join(ROOT, 'public');
