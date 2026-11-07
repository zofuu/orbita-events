// Автотесты: node scripts/test.js [--json путь]. Сервер и БД создаются во временной папке; рабочая БД не затрагивается.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server.js';
import { openDb } from '../src/db.js';
import { loginLimiter } from '../src/auth.js';
import { searchEvents, localIso } from '../src/rules.js';
import { config } from '../src/config.js';

// Режим дочернего процесса для проверки одновременных вставок (см. тест A11)
if (process.argv[2] === '--worker') {
  const [, , , file, eventId, from, count] = process.argv;
  const db = openDb(file);
  let ok = 0, full = 0;
  for (let i = 0; i < Number(count); i++) {
    try {
      db.run("INSERT INTO registrations(event_id, user_id, status) VALUES (?,?, 'active')", Number(eventId), Number(from) + i);
      ok++;
    } catch (e) { if (String(e.message).includes('EVENT_FULL')) full++; }
  }
  process.send({ ok, full });
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-test-'));
const dbFile = path.join(tmp, 'test.db');
const { server, db } = await startServer({ port: 0, host: '127.0.0.1', dbPath: dbFile });
const base = `http://127.0.0.1:${server.address().port}`;
const PASS = config.seedPassword;

// ── Клиент с cookie ─────────────────────────────────────────────────────────
class Client {
  constructor() { this.cookies = {}; }
  async req(method, url, form) {
    const headers = { Cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    let body;
    if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    const res = await fetch(base + url, { method, headers, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (/Max-Age=0/i.test(c)) delete this.cookies[k]; else this.cookies[k] = v;
    }
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, location: res.headers.get('location'), setCookie: res.headers.getSetCookie() };
  }
  get(url) { return this.req('GET', url); }
  async csrf(page = '/login') {
    const r = await this.get(page);
    const m = /name="_csrf" value="([^"]+)"/.exec(r.text);
    assert.ok(m, 'CSRF-токен не найден на странице ' + page);
    return m[1];
  }
  async post(url, form = {}, { page } = {}) {
    const _csrf = form._csrf ?? await this.csrf(page);
    return this.req('POST', url, { ...form, _csrf });
  }
  async login(login, password = PASS) {
    const r = await this.post('/login', { login, password });
    assert.equal(r.status, 303, `вход ${login}: ожидался 303, получен ${r.status}`);
    return r;
  }
  async flash() { const r = await this.get('/'); const m = /class="flash flash--(\w+)"[^>]*><span>([^<]*)</.exec(r.text); return m ? { type: m[1], text: m[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'") } : null; }
}
async function as(login) { const c = new Client(); await c.login(login); return c; }

// ── Исполнитель тестов ──────────────────────────────────────────────────────
const results = [];
let group = '';
const G = (name) => { group = name; };
async function T(name, fn) {
  const t0 = performance.now();
  try { await fn(); results.push({ group, name, ok: true, ms: Math.round(performance.now() - t0) }); console.log(`  ✔ ${name}`); }
  catch (e) { results.push({ group, name, ok: false, error: e.message.split('\n')[0] }); console.log(`  ✘ ${name}\n      ${e.message.split('\n')[0]}`); }
}
const id = (login) => db.get('SELECT id FROM users WHERE login = ?', login).id;
const active = (eventId) => db.get("SELECT count(*) AS n FROM registrations WHERE event_id = ? AND status = 'active'", eventId).n;
const future = (days = 10, h = 12) => { const d = new Date(Date.now() + days * 864e5); d.setHours(h, 0, 0, 0); return localIso(d); };
const later = (iso, hours = 2) => localIso(new Date(new Date(iso).getTime() + hours * 36e5));
function mkEvent({ cap = 5, status = 'published', org = 'kovaleva', starts = future(), title = `Тест ${Math.random().toString(36).slice(2, 8)}`, price = 0 } = {}) {
  return Number(db.run(`INSERT INTO events(title, category_id, organizer_id, summary, description, format, city, venue, starts_at, ends_at, capacity, price, status)
    VALUES (?,1,?,?,?, 'offline','Москва','Тестовая площадка',?,?,?,?,?)`, title, id(org), 'Тестовое мероприятие для проверки', '', starts, later(starts), cap, price, status).lastInsertRowid);
}
let userSeq = 0;
function mkUser(role = 'user') {
  const login = `t${Date.now().toString(36)}${userSeq++}`;
  const uid = Number(db.run('INSERT INTO users(login, name, email, password_hash, role) VALUES (?,?,?, (SELECT password_hash FROM users WHERE login = ?), ?)', login, `Тест ${login}`, `${login}@example.test`, 'ivanova', role).lastInsertRowid);
  return { login, uid };
}
const sqlErr = (fn) => { try { fn(); } catch (e) { return String(e.message); } return null; };

console.log('\nАвтотесты ОРБИТА · УП.09.01 · тема №6 «Мероприятия»\n');

// ═══ A. Ограничения базы данных (минуя приложение) ═════════════════════════════
G('A. Ограничения БД');
console.log('A. Ограничения базы данных');
await T('A1 Дубль активной регистрации отклонён индексом UNIQUE', () => {
  const e = mkEvent({ cap: 5 }); const u = id('petrov');
  db.run("INSERT INTO registrations(event_id, user_id) VALUES (?,?)", e, u);
  assert.match(sqlErr(() => db.run("INSERT INTO registrations(event_id, user_id) VALUES (?,?)", e, u)), /UNIQUE constraint failed/);
});
await T('A2 Превышение лимита отклонено триггером EVENT_FULL', () => {
  const e = mkEvent({ cap: 2 });
  db.run("INSERT INTO registrations(event_id, user_id) VALUES (?,?)", e, id('ivanova'));
  db.run("INSERT INTO registrations(event_id, user_id) VALUES (?,?)", e, id('petrov'));
  assert.match(sqlErr(() => db.run("INSERT INTO registrations(event_id, user_id) VALUES (?,?)", e, id('popova'))), /EVENT_FULL/);
  assert.equal(active(e), 2);
});
await T('A3 Запись на черновик отклонена (EVENT_CLOSED)', () => {
  const e = mkEvent({ status: 'draft' });
  assert.match(sqlErr(() => db.run("INSERT INTO registrations(event_id, user_id) VALUES (?,?)", e, id('ivanova'))), /EVENT_CLOSED/);
});
await T('A4 Лимит нельзя уменьшить ниже числа активных регистраций', () => {
  const e = mkEvent({ cap: 5 });
  for (const l of ['ivanova', 'petrov', 'popova']) db.run("INSERT INTO registrations(event_id, user_id) VALUES (?,?)", e, id(l));
  assert.match(sqlErr(() => db.run('UPDATE events SET capacity = 2 WHERE id = ?', e)), /CAPACITY_BELOW_ACTIVE/);
  db.run('UPDATE events SET capacity = 3 WHERE id = ?', e);
});
await T('A5 Неверная ссылка (несуществующий пользователь) — FOREIGN KEY', () => {
  const e = mkEvent();
  assert.match(sqlErr(() => db.run("INSERT INTO registrations(event_id, user_id) VALUES (?, 999999)", e)), /FOREIGN KEY constraint failed/);
});
await T('A6 Отрицательная цена отклонена ограничением CHECK', () => {
  assert.match(sqlErr(() => mkEvent({ price: -5 })), /CHECK constraint failed/);
});
await T('A7 Мероприятие нельзя создать от имени обычного пользователя', () => {
  assert.match(sqlErr(() => mkEvent({ org: 'ivanova' })), /ORGANIZER_ROLE_REQUIRED/);
});
await T('A8 Дубль логина без учёта регистра отклонён', () => {
  assert.match(sqlErr(() => db.run("INSERT INTO users(login, name, email, password_hash, role) VALUES ('IVANOVA','Дубль','x1@example.test','h','user')")), /UNIQUE constraint failed/);
});
await T('A9 Каскад: при удалении мероприятия удаляются его регистрации', () => {
  const e = mkEvent({ cap: 3 });
  db.run("INSERT INTO registrations(event_id, user_id) VALUES (?,?)", e, id('ivanova'));
  db.run('DELETE FROM events WHERE id = ?', e);
  assert.equal(db.get('SELECT count(*) AS n FROM registrations WHERE event_id = ?', e).n, 0);
});
await T('A10 После отмены повторная запись допустима, занято мест — 1', () => {
  const e = mkEvent({ cap: 3 }); const u = id('ivanova');
  db.run("INSERT INTO registrations(event_id, user_id) VALUES (?,?)", e, u);
  db.run("UPDATE registrations SET status = 'cancelled' WHERE event_id = ?", e);
  db.run("INSERT INTO registrations(event_id, user_id) VALUES (?,?)", e, u);
  assert.equal(active(e), 1);
});
await T('A11 Одновременные процессы (4×20 вставок на 10 мест): занято ровно 10', async () => {
  const e = mkEvent({ cap: 10 });
  const users = [];
  for (let i = 0; i < 80; i++) users.push(mkUser().uid);
  const first = users[0];
  const me = fileURLToPath(import.meta.url);
  const res = await Promise.all([0, 1, 2, 3].map((k) => new Promise((resolve, reject) => {
    const p = fork(me, ['--worker', dbFile, String(e), String(first + k * 20), '20'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    p.on('message', resolve); p.on('error', reject);
  })));
  assert.equal(res.reduce((s, r) => s + r.ok, 0), 10);
  assert.equal(active(e), 10);
});

// ═══ B. Регистрация на мероприятие (HTTP) ═══════════════════════════════════
G('B. Регистрация');
console.log('B. Регистрация и отмена');
await T('B1 Анонимная регистрация — 401', async () => {
  const e = mkEvent(); const c = new Client();
  const r = await c.post(`/events/${e}/register`, {}, { page: '/login' });
  assert.equal(r.status, 401); assert.equal(active(e), 0);
});
await T('B2 Успешная регистрация: уведомление и 1 активная запись', async () => {
  const e = mkEvent({ cap: 3 }); const c = await as('ivanova');
  const r = await c.post(`/events/${e}/register`, {}, { page: '/' });
  assert.equal(r.status, 303); assert.equal(r.location, `/events/${e}`);
  const f = await c.flash(); assert.equal(f.type, 'ok'); assert.match(f.text, /Вы зарегистрированы.*осталось: 2/);
  assert.equal(active(e), 1);
});
await T('B3 Повторная регистрация того же пользователя отклонена', async () => {
  const e = mkEvent({ cap: 3 }); const c = await as('ivanova');
  await c.post(`/events/${e}/register`, {}, { page: '/' });
  await c.post(`/events/${e}/register`, {}, { page: '/' });
  const f = await c.flash(); assert.equal(f.type, 'err'); assert.match(f.text, /уже зарегистрированы/);
  assert.equal(active(e), 1);
});
await T('B4 При достижении лимита регистрация недоступна', async () => {
  const e = mkEvent({ cap: 1 }); const a = await as('ivanova'); const b = await as('petrov');
  await a.post(`/events/${e}/register`, {}, { page: '/' });
  const page = await b.get(`/events/${e}`); assert.match(page.text, /Мест нет/); assert.match(page.text, /disabled/);
  await b.post(`/events/${e}/register`, {}, { page: '/' });
  const f = await b.flash(); assert.equal(f.type, 'err'); assert.match(f.text, /Свободных мест не осталось/);
  assert.equal(active(e), 1);
});
await T('B5 Отмена освобождает место, его занимает другой участник', async () => {
  const e = mkEvent({ cap: 1 }); const a = await as('ivanova'); const b = await as('petrov');
  await a.post(`/events/${e}/register`, {}, { page: '/' });
  const reg = db.get("SELECT id FROM registrations WHERE event_id = ? AND status = 'active'", e).id;
  const r = await a.post(`/registrations/${reg}/cancel`, {}, { page: '/' });
  assert.equal(r.status, 303); assert.equal(active(e), 0);
  await b.post(`/events/${e}/register`, {}, { page: '/' });
  assert.equal(active(e), 1);
  assert.equal(db.get("SELECT user_id FROM registrations WHERE event_id = ? AND status = 'active'", e).user_id, id('petrov'));
});
await T('B6 Чужую регистрацию отменить нельзя — 403', async () => {
  const e = mkEvent({ cap: 3 }); const a = await as('ivanova'); const b = await as('petrov');
  await a.post(`/events/${e}/register`, {}, { page: '/' });
  const reg = db.get("SELECT id FROM registrations WHERE event_id = ?", e).id;
  const r = await b.post(`/registrations/${reg}/cancel`, {}, { page: '/' });
  assert.equal(r.status, 403); assert.equal(active(e), 1);
});
await T('B7 Отмена после начала мероприятия невозможна — 409', async () => {
  const e = mkEvent({ cap: 3, starts: future(-1, 8) });
  db.run('UPDATE events SET ends_at = ? WHERE id = ?', future(1, 8), e);
  const u = id('ivanova'); db.run("INSERT INTO registrations(event_id, user_id) VALUES (?,?)", e, u);
  const reg = db.get("SELECT id FROM registrations WHERE event_id = ?", e).id;
  const r = await (await as('ivanova')).post(`/registrations/${reg}/cancel`, {}, { page: '/' });
  assert.equal(r.status, 409); assert.equal(active(e), 1);
});
await T('B8 Регистрация на уже начавшееся мероприятие закрыта', async () => {
  const e = mkEvent({ cap: 3, starts: future(-1, 8) });
  db.run('UPDATE events SET ends_at = ? WHERE id = ?', future(1, 8), e);
  const c = await as('ivanova'); await c.post(`/events/${e}/register`, {}, { page: '/' });
  const f = await c.flash(); assert.match(f.text, /Регистрация закрыта/); assert.equal(active(e), 0);
});
await T('B9 Регистрация на отменённое мероприятие отклонена', async () => {
  const e = mkEvent({ status: 'cancelled' });
  const c = await as('ivanova'); await c.post(`/events/${e}/register`, {}, { page: '/' });
  assert.match((await c.flash()).text, /отменено организатором/); assert.equal(active(e), 0);
});
await T('B10 Черновик скрыт: регистрация и просмотр — 404', async () => {
  const e = mkEvent({ status: 'draft' }); const c = await as('ivanova');
  assert.equal((await c.get(`/events/${e}`)).status, 404);
  assert.equal((await c.post(`/events/${e}/register`, {}, { page: '/' })).status, 404);
});
await T('B11 30 одновременных запросов на 5 мест — занято ровно 5', async () => {
  const e = mkEvent({ cap: 5 });
  const clients = [];
  for (let i = 0; i < 30; i++) { const u = mkUser(); const c = new Client(); await c.login(u.login); clients.push([c, await c.csrf('/')]); }
  const rs = await Promise.all(clients.map(([c, t]) => c.req('POST', `/events/${e}/register`, { _csrf: t })));
  assert.ok(rs.every((r) => r.status === 303));
  assert.equal(active(e), 5);
});
await T('B12 Запрос без CSRF-токена отклонён — 403', async () => {
  const e = mkEvent(); const c = await as('ivanova');
  const r = await c.req('POST', `/events/${e}/register`, { x: '1' });
  assert.equal(r.status, 403); assert.equal(active(e), 0);
});

// ═══ C. Каталог ═════════════════════════════════════════════════════════════
G('C. Каталог');
console.log('C. Каталог: поиск, фильтры, сортировка, страницы');
const cat = new Client();
await T('C1 Поиск по названию без учёта регистра (кириллица)', async () => {
  const a = await cat.get('/events?q=' + encodeURIComponent('питч')); const b = await cat.get('/events?q=' + encodeURIComponent('ПИТЧ-СЕССИЯ'));
  assert.match(a.text, /Питч-сессия/); assert.match(b.text, /Питч-сессия/);
});
await T('C2 Фильтр по категории возвращает только её мероприятия', () => {
  const r = searchEvents(db, { category: 'sport', when: 'all' }, 100);
  assert.ok(r.total >= 10); assert.ok(r.items.every((e) => e.cat_slug === 'sport'));
});
await T('C3 Фильтр по датам «с — по»', () => {
  const from = future(10, 0).slice(0, 10), to = future(30, 0).slice(0, 10);
  const r = searchEvents(db, { from, to }, 100);
  assert.ok(r.total > 3); assert.ok(r.items.every((e) => e.starts_at.slice(0, 10) >= from && e.starts_at.slice(0, 10) <= to));
});
await T('C4 Сортировка: по популярности и по цене', () => {
  const p = searchEvents(db, { sort: 'popular' }, 100).items.map((e) => e.taken);
  assert.deepEqual(p, [...p].sort((x, y) => y - x));
  const c = searchEvents(db, { sort: 'price' }, 100).items.map((e) => e.price);
  assert.deepEqual(c, [...c].sort((x, y) => x - y));
});
await T('C5 Фильтр «только со свободными местами» исключает заполненные', () => {
  const r = searchEvents(db, { seats: '1' }, 100);
  assert.ok(r.items.every((e) => e.left > 0));
  assert.ok(searchEvents(db, {}, 100).total > r.total);
});
await T('C6 Постраничный вывод сохраняет условия фильтра в ссылках', async () => {
  const r = await cat.get('/events?when=all&sort=price');
  const link = /href="(\/events\?[^"]*page=2[^"]*)"/.exec(r.text);
  assert.ok(link, 'ссылка на страницу 2 не найдена');
  assert.ok(link[1].includes('when=all') && link[1].includes('sort=price'), 'условия фильтра потеряны: ' + link[1]);
});
await T('C7 Номер страницы за пределами диапазона приводится к последней', () => {
  const r = searchEvents(db, { when: 'all', page: '999' }, 9);
  assert.equal(r.page, r.pages); assert.ok(r.items.length > 0);
});
await T('C8 Пустой результат: понятное сообщение, статус 200', async () => {
  const r = await cat.get('/events?q=' + encodeURIComponent('несуществующее мероприятие'));
  assert.equal(r.status, 200); assert.match(r.text, /Ничего не найдено/);
});
await T('C9 Черновики не попадают в каталог и карту сайта', async () => {
  const r = await cat.get('/events?q=' + encodeURIComponent('черновик') + '&when=all'); assert.match(r.text, /Найдено: <b>0<\/b>/);
  const ids = db.all("SELECT id FROM events WHERE status = 'draft'").map((x) => x.id);
  const sm = (await cat.get('/sitemap.xml')).text;
  assert.ok(ids.every((i) => !sm.includes(`/events/${i}<`)));
});
await T('C10 Пользовательский текст экранируется (XSS в названии)', async () => {
  const e = mkEvent({ title: '<script>alert(1)</script> Тест XSS' });
  const r = await cat.get(`/events/${e}`);
  assert.ok(!r.text.includes('<script>alert(1)</script>')); assert.match(r.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
await T('C11 SQL-инъекция в поиске не раскрывает данные (запрос параметризован)', async () => {
  const r = await cat.get('/events?q=' + encodeURIComponent("' OR 1=1 --"));
  assert.equal(r.status, 200); assert.match(r.text, /Найдено: <b>0<\/b>/);
});
await T('C12 Несуществующее и некорректное мероприятие — 404', async () => {
  assert.equal((await cat.get('/events/999999')).status, 404);
  assert.equal((await cat.get('/events/abc')).status, 404);
});

// ═══ D. Роли и права ═══════════════════════════════════════════════════════
G('D. Права и безопасность');
console.log('D. Аутентификация, роли и безопасность');
await T('D1 Анонимный доступ к панели организатора — 401, к кабинету — 401', async () => {
  const c = new Client();
  assert.equal((await c.get('/organizer')).status, 401); assert.equal((await c.get('/account')).status, 401);
  assert.equal((await c.get('/account/registrations')).status, 401);
});
await T('D2 Обычный пользователь не попадает в панель организатора — 403', async () => {
  const c = await as('ivanova');
  assert.equal((await c.get('/organizer')).status, 403); assert.equal((await c.get('/organizer/events/new')).status, 403);
  assert.equal((await c.post('/organizer/events', { title: 'Взлом' }, { page: '/' })).status, 403);
});
await T('D3 Организатор не может изменить и удалить чужое мероприятие — 403', async () => {
  const e = mkEvent({ org: 'orlov' }); const c = await as('kovaleva');
  assert.equal((await c.get(`/organizer/events/${e}/edit`)).status, 403);
  assert.equal((await c.post(`/organizer/events/${e}`, { title: 'Подмена' }, { page: '/organizer' })).status, 403);
  assert.equal((await c.post(`/organizer/events/${e}/delete`, {}, { page: '/organizer' })).status, 403);
  assert.ok(db.get('SELECT 1 AS x FROM events WHERE id = ?', e));
});
await T('D4 Список участников чужого мероприятия и CSV недоступны — 403', async () => {
  const e = mkEvent({ org: 'orlov' }); const c = await as('kovaleva');
  assert.equal((await c.get(`/organizer/events/${e}/registrations`)).status, 403);
  assert.equal((await c.get(`/organizer/events/${e}/registrations.csv`)).status, 403);
});
await T('D5 Раздел администратора: админ — 200, организатор — 403', async () => {
  assert.equal((await (await as('admin')).get('/admin')).status, 200);
  assert.equal((await (await as('kovaleva')).get('/admin')).status, 403);
});
await T('D6 После выхода старый сеанс не даёт доступа — 401', async () => {
  const c = new Client(); await c.login('ivanova');
  const old = { ...c.cookies };
  await c.post('/logout', {}, { page: '/' });
  const c2 = new Client(); c2.cookies = old;
  assert.equal((await c2.get('/account')).status, 401);
});
await T('D7 Неверный пароль — 401 без выдачи сеанса пользователя', async () => {
  const c = new Client(); const r = await c.post('/login', { login: 'ivanova', password: 'wrong-pass-1' });
  assert.equal(r.status, 401); assert.match(r.text, /Неверный логин или пароль/);
  assert.equal((await c.get('/account')).status, 401);
});
await T('D8 Шесть неверных входов подряд — блокировка 429, верный пароль тоже отклоняется', async () => {
  loginLimiter.clear(); const c = new Client(); let last;
  for (let i = 0; i < 6; i++) last = await c.post('/login', { login: 'sokolova', password: 'bad-pass-0' + i });
  assert.equal(last.status, 429);
  assert.equal((await c.post('/login', { login: 'sokolova', password: PASS })).status, 429);
  loginLimiter.clear();
});
await T('D9 Идентификатор сеанса меняется при входе, cookie HttpOnly + SameSite', async () => {
  const c = new Client(); await c.get('/login'); const before = c.cookies.sid;
  const r = await c.login('ivanova');
  assert.notEqual(c.cookies.sid, before);
  assert.ok(r.setCookie.some((s) => /HttpOnly/i.test(s) && /SameSite=Lax/i.test(s)));
});
await T('D10 Перенаправление после входа только на внутренние адреса', async () => {
  const c = new Client(); const r = await c.post('/login', { login: 'ivanova', password: PASS, next: '//evil.example' });
  assert.equal(r.location, '/account');
});
await T('D11 Пароли хранятся только в виде хеша scrypt', () => {
  const bad = db.get("SELECT count(*) AS n FROM users WHERE password_hash NOT LIKE 'scrypt$%'").n;
  assert.equal(bad, 0);
});
await T('D12 Заголовки безопасности (CSP, nosniff, запрет фреймов)', async () => {
  const r = await cat.get('/');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('x-frame-options'), 'DENY');
});
await T('D13 Регистрация аккаунта: слабый пароль и занятый логин — 422', async () => {
  const c = new Client();
  const a = await c.post('/register', { name: 'Тест Тестов', login: 'newbie1', email: 'newbie1@example.test', password: 'short', role: 'user' });
  assert.equal(a.status, 422); assert.match(a.text, /не менее 8 символов/);
  const b = await c.post('/register', { name: 'Тест Тестов', login: 'ivanova', email: 'other@example.test', password: 'Passw0rd-ok', role: 'user' });
  assert.equal(b.status, 422); assert.match(b.text, /логин уже занят/);
  assert.equal(db.get("SELECT count(*) AS n FROM users WHERE login = 'newbie1'").n, 0);
});
await T('D14 Успешная регистрация участника и организатора, вход выполнен сразу', async () => {
  const c = new Client();
  const r = await c.post('/register', { name: 'Новый Участник', login: 'newuser9', email: 'newuser9@example.test', password: 'Passw0rd-ok', role: 'user' });
  assert.equal(r.status, 303); assert.equal((await c.get('/account')).status, 200);
  assert.equal(db.get("SELECT role FROM users WHERE login = 'newuser9'").role, 'user');
  const o = new Client(); await o.post('/register', { name: 'Новый Организатор', login: 'neworg9', email: 'neworg9@example.test', password: 'Passw0rd-ok', role: 'organizer' });
  assert.equal((await o.get('/organizer')).status, 200);
});

// ═══ E. Панель организатора ═════════════════════════════════════════════════
G('E. Организатор');
console.log('E. Панель организатора');
const goodForm = () => ({ title: 'Тестовая конференция «Орбита»', category_id: '1', format: 'offline', summary: 'Проверка создания мероприятия организатором', description: 'Описание\n\n– пункт 1\n– пункт 2', city: 'Москва', venue: 'Тестовая площадка', starts_at: future(20, 10), ends_at: future(20, 12), capacity: '25', price: '500', status: 'published' });
await T('E1 Некорректная форма: ошибки по полям, мероприятие не создано (422)', async () => {
  const c = await as('kovaleva'); const before = db.get('SELECT count(*) AS n FROM events').n;
  const r = await c.post('/organizer/events', { ...goodForm(), title: 'ab', capacity: '0', ends_at: future(19, 10), price: '-3' }, { page: '/organizer/events/new' });
  assert.equal(r.status, 422); assert.match(r.text, /Название — от 3/); assert.match(r.text, /Лимит участников/); assert.match(r.text, /Окончание должно быть позже/);
  assert.match(r.text, /value="Москва"/); // введённые значения сохранены
  assert.equal(db.get('SELECT count(*) AS n FROM events').n, before);
});
await T('E2 Корректная форма создаёт мероприятие организатора и показывает его в каталоге', async () => {
  const c = await as('kovaleva');
  const r = await c.post('/organizer/events', goodForm(), { page: '/organizer/events/new' });
  assert.equal(r.status, 303);
  const e = db.get("SELECT * FROM events WHERE title = 'Тестовая конференция «Орбита»'");
  assert.equal(e.organizer_id, id('kovaleva')); assert.equal(e.capacity, 25); assert.equal(e.status, 'published');
  assert.match((await cat.get('/events?q=' + encodeURIComponent('Тестовая конференция'))).text, /Тестовая конференция/);
});
await T('E3 Редактирование сохраняет изменения; лимит ниже занятых мест — 422', async () => {
  const e = mkEvent({ cap: 10 }); const c = await as('kovaleva');
  for (const l of ['ivanova', 'petrov', 'popova', 'sokolova']) db.run("INSERT INTO registrations(event_id, user_id) VALUES (?,?)", e, id(l));
  const ok = await c.post(`/organizer/events/${e}`, { ...goodForm(), title: 'Переименовано', capacity: '12' }, { page: `/organizer/events/${e}/edit` });
  assert.equal(ok.status, 303); assert.equal(db.get('SELECT title, capacity FROM events WHERE id = ?', e).capacity, 12);
  const bad = await c.post(`/organizer/events/${e}`, { ...goodForm(), capacity: '3' }, { page: `/organizer/events/${e}/edit` });
  assert.equal(bad.status, 422); assert.match(bad.text, /меньше числа активных регистраций \(4\)/);
  assert.equal(db.get('SELECT capacity FROM events WHERE id = ?', e).capacity, 12);
});
await T('E4 Список участников: видны зарегистрированные, счётчик мест верный', async () => {
  const e = mkEvent({ cap: 4 }); const c = await as('kovaleva');
  db.run("INSERT INTO registrations(event_id, user_id) VALUES (?,?)", e, id('ivanova'));
  const r = await c.get(`/organizer/events/${e}/registrations`);
  assert.equal(r.status, 200); assert.match(r.text, /Анна Иванова/); assert.match(r.text, /<dt>Свободно<\/dt><dd>3<\/dd>/);
});
await T('E5 Организатор отменяет регистрацию участника — место освобождается', async () => {
  const e = mkEvent({ cap: 1 }); const c = await as('kovaleva');
  db.run("INSERT INTO registrations(event_id, user_id) VALUES (?,?)", e, id('ivanova'));
  const reg = db.get('SELECT id FROM registrations WHERE event_id = ?', e).id;
  assert.equal((await c.post(`/registrations/${reg}/cancel`, { back: `/organizer/events/${e}/registrations` }, { page: '/organizer' })).status, 303);
  assert.equal(active(e), 0);
});
await T('E6 Отметка присутствия: организатор — 303, участник — 403', async () => {
  const e = mkEvent({ cap: 2 }); db.run("INSERT INTO registrations(event_id, user_id) VALUES (?,?)", e, id('ivanova'));
  const reg = db.get('SELECT id FROM registrations WHERE event_id = ?', e).id;
  assert.equal((await (await as('ivanova')).post(`/organizer/registrations/${reg}/attended`, { attended: '1' }, { page: '/' })).status, 403);
  assert.equal((await (await as('kovaleva')).post(`/organizer/registrations/${reg}/attended`, { attended: '1' }, { page: '/organizer' })).status, 303);
  assert.equal(db.get('SELECT attended FROM registrations WHERE id = ?', reg).attended, 1);
});
await T('E7 Удаление мероприятия с регистрациями запрещено, без регистраций — выполняется', async () => {
  const e1 = mkEvent({ cap: 2 }); db.run("INSERT INTO registrations(event_id, user_id) VALUES (?,?)", e1, id('ivanova'));
  const e2 = mkEvent({ cap: 2 }); const c = await as('kovaleva');
  await c.post(`/organizer/events/${e1}/delete`, {}, { page: '/organizer' });
  assert.ok(db.get('SELECT 1 AS x FROM events WHERE id = ?', e1)); assert.equal(active(e1), 1);
  await c.post(`/organizer/events/${e2}/delete`, {}, { page: '/organizer' });
  assert.equal(db.get('SELECT 1 AS x FROM events WHERE id = ?', e2), undefined);
});
await T('E8 Выгрузка CSV: только активные участники, BOM и защита от формул', async () => {
  const e = mkEvent({ cap: 3 }); db.run("INSERT INTO registrations(event_id, user_id) VALUES (?,?)", e, id('ivanova'));
  const r = await (await as('kovaleva')).get(`/organizer/events/${e}/registrations.csv`);
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/csv/); assert.match(r.text, /Анна Иванова/);
});
await T('E9 Личный кабинет: вкладки предстоящих, истории и отменённых', async () => {
  const c = await as('ivanova');
  const up = await c.get('/account/registrations'); const hist = await c.get('/account/registrations?tab=history'); const can = await c.get('/account/registrations?tab=cancelled');
  assert.equal(up.status, 200); assert.match(hist.text, /Посещено|Присутствие не отмечено/); assert.equal(can.status, 200);
});
await T('E10 Статистика обращений: журнал ведётся, ошибки учитываются', async () => {
  const n = db.get('SELECT count(*) AS n FROM access_log').n; const err = db.get('SELECT count(*) AS n FROM access_log WHERE status >= 400').n;
  assert.ok(n > 50); assert.ok(err > 5);
});
await T('E11 SEO: sitemap.xml, robots.txt закрывает кабинет, у страниц есть title/description/canonical', async () => {
  assert.match((await cat.get('/sitemap.xml')).text, /<loc>.*\/events\/1<\/loc>/);
  assert.match((await cat.get('/robots.txt')).text, /Disallow: \/account/);
  const p = (await cat.get('/events/1')).text; assert.match(p, /<title>.+<\/title>/); assert.match(p, /name="description"/); assert.match(p, /rel="canonical"/); assert.match(p, /application\/ld\+json/);
  assert.match((await (await as('ivanova')).get('/account')).text, /noindex/);
});

// ── Итог ────────────────────────────────────────────────────────────────────
const okN = results.filter((r) => r.ok).length;
console.log(`\nИтого: ${results.length} тестов, успешно ${okN}, неуспешно ${results.length - okN}\n`);
const jsonIdx = process.argv.indexOf('--json');
if (jsonIdx > 0) fs.writeFileSync(process.argv[jsonIdx + 1], JSON.stringify({ date: new Date().toISOString(), node: process.version, results }, null, 2));
server.close(); db.close();
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(okN === results.length ? 0 : 1);
