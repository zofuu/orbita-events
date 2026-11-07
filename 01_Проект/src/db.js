// Обёртка над встроенной SQLite (node:sqlite): подготовленные запросы, транзакции, миграции.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  // Регистронезависимый поиск для кириллицы (LIKE в SQLite понимает регистр только у ASCII)
  raw.function('lower_ru', { deterministic: true }, (s) => String(s ?? '').toLowerCase());

  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };

  const db = {
    raw,
    queries: 0, // счётчик обращений к БД (для замеров)
    get(sql, ...p) { db.queries++; return stmt(sql).get(...p); },
    all(sql, ...p) { db.queries++; return stmt(sql).all(...p); },
    run(sql, ...p) { db.queries++; return stmt(sql).run(...p); },
    exec(sql) { raw.exec(sql); },
    // BEGIN IMMEDIATE сразу берёт блокировку записи: проверка лимита и вставка выполняются атомарно
    tx(fn) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const r = fn();
        raw.exec('COMMIT');
        return r;
      } catch (e) {
        try { raw.exec('ROLLBACK'); } catch { /* транзакция уже закрыта */ }
        throw e;
      }
    },
    close() { raw.close(); },
  };
  return db;
}

export function migrate(db, dir = path.join(ROOT, 'migrations')) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  const done = new Set(db.all('SELECT name FROM schema_migrations').map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = [];
  for (const f of files) {
    if (done.has(f)) continue;
    db.exec('BEGIN');
    try {
      db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
      db.run('INSERT INTO schema_migrations(name) VALUES (?)', f);
      db.exec('COMMIT');
      applied.push(f);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Миграция ${f} не применена: ${e.message}`);
    }
  }
  return applied;
}
