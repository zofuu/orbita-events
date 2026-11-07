// Учебный сценарий обращений к приложению для статистики: node scripts/traffic.js <папка вывода>
// Запросы идут по HTTP к реальному серверу на временной БД; журнал берётся из таблицы access_log без персональных данных.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.js';
import { median } from '../src/http.js';

const outDir = path.resolve(process.argv[2] ?? '.');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-traffic-'));
const { server, db } = await startServer({ port: 0, host: '127.0.0.1', dbPath: path.join(tmp, 't.db') });
const base = `http://127.0.0.1:${server.address().port}`;
const jar = {};
const call = async (method, url, form) => {
  const res = await fetch(base + url, {
    method, redirect: 'manual',
    headers: { Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (/Max-Age=0/i.test(c)) delete jar[kv.slice(0, i)]; else jar[kv.slice(0, i)] = kv.slice(i + 1); }
  return { status: res.status, text: await res.text() };
};
const csrf = async (p = '/') => /name="_csrf" value="([^"]+)"/.exec((await call('GET', p)).text)[1];

// Гость
for (const p of ['/', '/events', '/events?q=%D0%BF%D0%B8%D1%82%D1%87', '/events?category=sport&sort=popular', '/events?from=2026-11-10&to=2026-12-10', '/events?when=all&page=2', '/events/3', '/events/7', '/categories', '/categories/it', '/about', '/contacts', '/sitemap.xml', '/robots.txt', '/login', '/register']) await call('GET', p);
// Ошибочные обращения
for (const p of ['/events/99999', '/no-such-page', '/account', '/organizer', '/admin']) await call('GET', p);
// Неверный вход, вход участника
await call('POST', '/login', { login: 'ivanova', password: 'wrong-pass-1', _csrf: await csrf('/login') });
await call('POST', '/login', { login: 'volkov', password: 'Orbita-demo1', _csrf: await csrf('/login') });
// Участник: запись, повтор, кабинет, отмена
const free = db.get("SELECT e.id FROM events e WHERE e.status='published' AND e.starts_at > datetime('now') AND e.capacity > (SELECT count(*) FROM registrations r WHERE r.event_id=e.id AND r.status='active') AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.event_id=e.id AND r.user_id=(SELECT id FROM users WHERE login='volkov')) LIMIT 1").id;
let t = await csrf('/');
await call('POST', `/events/${free}/register`, { _csrf: t });
await call('POST', `/events/${free}/register`, { _csrf: t });
await call('GET', `/events/${free}`);
await call('GET', '/account');
await call('GET', '/account/registrations');
await call('GET', '/account/registrations?tab=history');
const reg = db.get("SELECT id FROM registrations WHERE event_id = ? AND status='active' AND user_id=(SELECT id FROM users WHERE login='volkov')", free).id;
await call('POST', `/registrations/${reg}/cancel`, { _csrf: t });
await call('GET', '/organizer');
await call('POST', '/logout', { _csrf: t });
// Организатор
await call('POST', '/login', { login: 'kovaleva', password: 'Orbita-demo1', _csrf: await csrf('/login') });
await call('GET', '/organizer');
await call('GET', '/organizer/events/new');
await call('GET', '/organizer/events/1/registrations');
await call('GET', '/organizer/events/1/registrations.csv');
await call('GET', '/organizer/events/9/registrations');
await call('GET', '/admin');

const rows = db.all('SELECT ts, method, route, status, ms FROM access_log ORDER BY id');
const csv = ['время;метод;маршрут;статус;длительность_мс', ...rows.map((r) => [new Date(r.ts).toISOString().slice(11, 23), r.method, r.route, r.status, r.ms.toFixed(2).replace('.', ',')].join(';'))].join('\r\n');
fs.writeFileSync(path.join(outDir, 'журнал_обращений.csv'), '﻿' + csv);
const errs = rows.filter((r) => r.status >= 400);
const stats = { total: rows.length, errors: errs.length, share: +(errs.length / rows.length * 100).toFixed(1), median: +median(rows.map((r) => r.ms)).toFixed(2), max: Math.max(...rows.map((r) => r.ms)), byStatus: Object.fromEntries([...new Set(rows.map((r) => r.status))].sort().map((s) => [s, rows.filter((r) => r.status === s).length])) };
fs.writeFileSync(path.join(outDir, 'статистика_обращений.json'), JSON.stringify(stats, null, 2));
console.log(stats);
server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true });
