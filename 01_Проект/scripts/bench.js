// Замеры производительности до и после оптимизации: node scripts/bench.js [--json путь]
// Сценарий: страница каталога /events?when=all&sort=popular&page=3 на БД из 3000 мероприятий и ~40 тыс. регистраций.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { startServer } from '../src/server.js';
import { openDb, migrate } from '../src/db.js';
import { seedDatabase } from '../src/seed.js';
import { ROOT } from '../src/config.js';
import { localIso } from '../src/rules.js';
import { median } from '../src/http.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-bench-'));
const migA = path.join(tmp, 'm-before'); fs.mkdirSync(migA);
fs.copyFileSync(path.join(ROOT, 'migrations', '001_init.sql'), path.join(migA, '001_init.sql'));

function buildDb(file, migDir) {
  const db = openDb(file);
  migrate(db, migDir);
  seedDatabase(db);
  // Увеличиваем объём данных до 3000 мероприятий и ~40 000 регистраций (детерминированно)
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const users = db.all("SELECT id FROM users WHERE role = 'user'").map((u) => u.id);
  const orgs = db.all("SELECT id FROM users WHERE role = 'organizer'").map((u) => u.id);
  db.tx(() => {
    for (let i = 0; i < 2900; i++) {
      const d = new Date(Date.now() + (rnd() * 300 - 40) * 864e5); d.setHours(10, 0, 0, 0);
      const s = localIso(d), f = localIso(new Date(d.getTime() + 2 * 36e5));
      const cap = 20 + Math.floor(rnd() * 400);
      const id = Number(db.run(`INSERT INTO events(title, category_id, organizer_id, summary, description, format, city, venue, starts_at, ends_at, capacity, price, status)
        VALUES (?,?,?,?,?, 'offline','Москва','Площадка',?,?,?,?, 'published')`, `Тестовое событие ${i}`, 1 + Math.floor(rnd() * 6), orgs[i % orgs.length],
        'Событие для замеров производительности', '', s, f, cap, Math.floor(rnd() * 5) * 500).lastInsertRowid);
      const n = Math.min(cap, Math.floor(rnd() * users.length));
      [...users].sort(() => rnd() - 0.5).slice(0, n).forEach((u) => db.run("INSERT INTO registrations(event_id, user_id) VALUES (?,?)", id, u));
    }
  });
  return db;
}

const URL_PATH = '/events?when=all&sort=popular&page=3';
async function measure(base, db, headers = {}) {
  const runs = [];
  await fetch(base + URL_PATH, { headers }); // прогрев
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now(); const q0 = db.queries; let bytes = 0;
    for (let i = 0; i < 10; i++) { const r = await fetch(base + URL_PATH, { headers }); await r.arrayBuffer(); bytes = Number(r.headers.get('content-length')); }
    runs.push({ ms: (performance.now() - t0) / 10, queries: (db.queries - q0) / 10, bytes });
  }
  return runs;
}
const row = (name, runs) => ({ name, runs: runs.map((r) => +r.ms.toFixed(2)), median: +median(runs.map((r) => r.ms)).toFixed(2), queries: runs[0].queries, bytes: runs[0].bytes });

const out = { env: { node: process.version, os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0].model, date: new Date().toISOString() }, rows: [] };

// Мера 1: индексы (002_indexes.sql). Одинаковые данные, одинаковый код.
const pA = path.join(tmp, 'a.db'), pB = path.join(tmp, 'b.db');
const dbA = buildDb(pA, migA); dbA.close();
const dbB = buildDb(pB, path.join(ROOT, 'migrations')); dbB.close();
out.data = { events: 2900 + 65 - 2, note: 'размер БД, КБ: A=' + Math.round(fs.statSync(pA).size / 1024) + ', B=' + Math.round(fs.statSync(pB).size / 1024) };
for (const [label, file] of [['До: без индексов', pA], ['После: с индексами', pB]]) {
  const { server, db } = await startServer({ port: 0, host: '127.0.0.1', dbPath: file });
  const base = `http://127.0.0.1:${server.address().port}`;
  const counts = db.get("SELECT (SELECT count(*) FROM events) AS e, (SELECT count(*) FROM registrations) AS r");
  out.data.events = counts.e; out.data.registrations = counts.r;
  out.rows.push({ measure: 'Индексы', ...row(label, await measure(base, db)) });
  if (file === pB) {
    // Мера 2: сжатие ответа gzip (тот же сервер и БД)
    out.rows.push({ measure: 'Сжатие', ...row('До: без Accept-Encoding', await measure(base, db, { 'Accept-Encoding': 'identity' })) });
    out.rows.push({ measure: 'Сжатие', ...row('После: gzip', await measure(base, db, { 'Accept-Encoding': 'gzip' })) });
    // Мера 3: подсчёт занятых мест одним запросом вместо запроса на каждую карточку (N+1)
    const ids = db.all("SELECT id FROM events WHERE status = 'published' ORDER BY starts_at LIMIT 9").map((r) => r.id);
    const t = (fn) => { const q0 = db.queries; const t0 = performance.now(); for (let i = 0; i < 200; i++) fn(); return { ms: (performance.now() - t0) / 200, queries: (db.queries - q0) / 200, bytes: 0 }; };
    const nPlus = () => { db.all("SELECT * FROM events WHERE status = 'published' ORDER BY starts_at LIMIT 9").forEach((e) => db.get("SELECT count(*) AS n FROM registrations WHERE event_id = ? AND status = 'active'", e.id)); };
    const single = () => db.all("SELECT e.*, (SELECT count(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'active') AS taken FROM events e WHERE e.status = 'published' ORDER BY e.starts_at LIMIT 9");
    out.rows.push({ measure: 'N+1', ...row('До: 1 + 9 запросов к БД', [t(nPlus), t(nPlus), t(nPlus)]) });
    out.rows.push({ measure: 'N+1', ...row('После: 1 запрос к БД', [t(single), t(single), t(single)]) });
    void ids;
  }
  server.close(); db.close();
}
console.table(out.rows.map((r) => ({ 'Мера': r.measure, 'Вариант': r.name, 'Замеры, мс': r.runs.join(' / '), 'Медиана, мс': r.median, 'Запросов к БД': r.queries, 'Размер ответа, Б': r.bytes || '—' })));
const i = process.argv.indexOf('--json');
if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(out, null, 2));
fs.rmSync(tmp, { recursive: true, force: true });
