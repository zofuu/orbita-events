// Сборка приложения: контекст запроса, сеансы, CSRF, права доступа, обработка ошибок, журнал обращений.
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { config } from './config.js';
import { openDb, migrate } from './db.js';
import { Raw } from './html.js';
import { html } from './html.js';
import {
  HttpError, Router, parseCookies, readForm, send, redirect, serveStatic, PUBLIC_DIR,
} from './http.js';
import { createSession, loadSession, loadUser, destroySession, sessionKey, checkCsrf } from './auth.js';
import { layout } from './ui.js';
import { publicRoutes } from './routes/public.js';
import { authRoutes } from './routes/auth.js';
import { accountRoutes } from './routes/account.js';
import { organizerRoutes } from './routes/organizer.js';
import { seedDatabase } from './seed.js';

const ERROR_TEXT = {
  400: ['Некорректный запрос', 'Проверьте данные и попробуйте ещё раз.'],
  401: ['Нужно войти', 'Это действие доступно только авторизованным пользователям.'],
  403: ['Доступ запрещён', 'У вашей учётной записи нет прав для этого действия.'],
  404: ['Страница не найдена', 'Такой страницы нет или мероприятие было удалено.'],
  405: ['Метод не поддерживается', 'Этот адрес не принимает такой запрос.'],
  409: ['Действие невозможно', 'Данные изменились или нарушают правила платформы.'],
  413: ['Запрос слишком большой', 'Сократите объём отправляемых данных.'],
  429: ['Слишком много попыток', 'Подождите несколько минут и повторите попытку.'],
  500: ['Что-то пошло не так', 'Мы уже знаем об ошибке. Попробуйте обновить страницу чуть позже.'],
};

export function createApp(db) {
  const router = new Router();
  publicRoutes(router);
  authRoutes(router);
  accountRoutes(router);
  organizerRoutes(router);

  function makeCtx(req, res) {
    const url = new URL(req.url, 'http://local');
    const ctx = {
      req, res, db, url, query: Object.fromEntries(url.searchParams), body: {}, params: {},
      setCookies: [], user: null, session: null, token: null, flash: null, route: url.pathname,
    };
    const cookies = parseCookies(req.headers.cookie);
    ctx.token = cookies.sid ?? null;
    ctx.session = loadSession(db, ctx.token);
    ctx.user = ctx.session ? loadUser(db, ctx.session.user_id) : null;

    const cookie = (value, maxAge) => `sid=${value}; Path=/; HttpOnly; SameSite=Lax${config.cookieSecure ? '; Secure' : ''}; Max-Age=${maxAge}`;
    ctx.ensureSession = () => {
      if (!ctx.session) {
        const s = createSession(db, null);
        ctx.token = s.token;
        ctx.session = { token_hash: sessionKey(s.token), user_id: null, csrf: s.csrf, flash: null };
        ctx.setCookies.push(cookie(s.token, Math.floor(config.sessionTtl / 1000)));
      }
      return ctx.session;
    };
    ctx.csrf = () => ctx.ensureSession().csrf;
    ctx.setFlash = (type, text) => {
      const s = ctx.ensureSession();
      s.flash = JSON.stringify({ type, text });
      db.run('UPDATE sessions SET flash = ? WHERE token_hash = ?', s.flash, s.token_hash);
    };
    // Вход: старый сеанс уничтожается, выдаётся новый идентификатор (защита от фиксации сеанса)
    ctx.login = (user) => {
      destroySession(db, ctx.token);
      const s = createSession(db, user.id);
      ctx.token = s.token;
      ctx.session = { token_hash: sessionKey(s.token), user_id: user.id, csrf: s.csrf, flash: null };
      ctx.user = user;
      ctx.setCookies.push(cookie(s.token, Math.floor(config.sessionTtl / 1000)));
    };
    ctx.logout = () => {
      destroySession(db, ctx.token);
      ctx.session = null;
      ctx.user = null;
      ctx.setCookies.push(cookie('', 0));
    };
    return ctx;
  }

  const requireUser = (ctx) => { if (!ctx.user) throw new HttpError(401, 'Войдите в аккаунт'); return ctx.user; };
  const requireRole = (ctx, roles) => {
    const u = requireUser(ctx);
    if (!roles.includes(u.role)) throw new HttpError(403, 'Недостаточно прав для этого действия');
    return u;
  };

  function renderError(ctx, status, message) {
    const [title, text] = ERROR_TEXT[status] ?? ERROR_TEXT[500];
    ctx.flash = null;
    const body = html`<section class="errpage"><div class="wrap">
      <p class="eyebrow">Ошибка ${status}</p>
      <h1 class="display display--md">${title}</h1>
      <p class="lead">${message && status < 500 ? message : text}</p>
      <div class="actions">
        ${status === 401 ? html`<a class="btn btn--accent" href="/login?next=${encodeURIComponent(ctx.url.pathname)}">Войти</a><a class="btn btn--ghost" href="/register">Создать аккаунт</a>`
          : html`<a class="btn btn--accent" href="/">На главную</a><a class="btn btn--ghost" href="/events">Каталог мероприятий</a>`}
      </div></div></section>`;
    send(ctx, status, layout(ctx, { title: `${title}`, noindex: true }, body).toString());
  }

  return async function handle(req, res) {
    const t0 = performance.now();
    let ctx;
    try {
      ctx = makeCtx(req, res);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    res.on('finish', () => {
      const p = ctx.url.pathname;
      if (!config.logRequests || p.startsWith('/static/') || p.startsWith('/cover/') || p === '/health') return;
      try {
        db.run('INSERT INTO access_log(ts, method, route, status, ms) VALUES (?,?,?,?,?)',
          Date.now(), req.method, ctx.route, res.statusCode, Math.round((performance.now() - t0) * 100) / 100);
      } catch { /* журнал не должен ломать ответ */ }
    });

    try {
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) throw new HttpError(405, 'Метод не поддерживается');
      if (ctx.url.pathname.startsWith('/static/')) { ctx.route = '/static'; return serveStatic(ctx, '/static/', PUBLIC_DIR); }

      const { route, params, pathMatched } = router.match(req.method, ctx.url.pathname);
      if (!route) throw new HttpError(pathMatched ? 405 : 404, 'Страница не найдена');
      ctx.params = params;
      ctx.route = route.pattern;

      // Права доступа проверяются до выполнения обработчика
      if (route.opts.roles) requireRole(ctx, route.opts.roles);
      else if (route.opts.auth) requireUser(ctx);

      if (req.method === 'POST') {
        ctx.body = await readForm(req);
        if (!checkCsrf(ctx.session, ctx.body._csrf)) throw new HttpError(403, 'Недействительный токен формы. Обновите страницу и повторите действие.');
      } else if (ctx.session?.flash && !route.opts.raw) {
        try { ctx.flash = JSON.parse(ctx.session.flash); } catch { ctx.flash = null; }
        db.run('UPDATE sessions SET flash = NULL WHERE token_hash = ?', ctx.session.token_hash);
      }

      const result = await route.handler(ctx);
      if (res.writableEnded) return;
      if (result instanceof Raw) return send(ctx, 200, result.toString());
      if (result && result.body !== undefined) return send(ctx, result.status ?? 200, result.body, result.headers);
      if (result !== undefined) return send(ctx, 200, String(result));
    } catch (e) {
      if (res.writableEnded || res.headersSent) return;
      if (e instanceof HttpError) return renderError(ctx, e.status, e.message);
      console.error('[error]', req.method, ctx.url.pathname, config.debugErrors ? e : String(e.message));
      if (config.debugErrors) return send(ctx, 500, `<pre>${String(e.stack).replace(/</g, '&lt;')}</pre>`);
      return renderError(ctx, 500);
    }
  };
}

export function startServer({ port = config.port, host = config.host, dbPath = config.dbPath } = {}) {
  const db = openDb(dbPath);
  migrate(db);
  if (config.autoSeed && db.get('SELECT count(*) AS n FROM users').n === 0) seedDatabase(db);
  db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  const server = http.createServer(createApp(db));
  return new Promise((resolve) => server.listen(port, host, () => resolve({ server, db })));
}
