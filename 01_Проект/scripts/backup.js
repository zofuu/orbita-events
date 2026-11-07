// Резервное копирование и проверка восстановления.
//   node scripts/backup.js backup            — копия рабочей БД (VACUUM INTO) + манифест с числом записей
//   node scripts/backup.js restore [файл]    — восстановление в ОТДЕЛЬНУЮ БД и проверки; рабочая БД не меняется
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../src/config.js';
import { openDb } from '../src/db.js';
import { registerForEvent, cancelRegistration, searchEvents } from '../src/rules.js';

const dir = path.resolve(ROOT, process.env.BACKUP_DIR ?? 'backups');
const cmd = process.argv[2] ?? 'backup';
const TABLES = ['users', 'categories', 'events', 'registrations', 'messages'];
const counts = (db) => Object.fromEntries(TABLES.map((t) => [t, db.get(`SELECT count(*) AS n FROM ${t}`).n]));
const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

if (cmd === 'backup') {
  fs.mkdirSync(dir, { recursive: true });
  const src = openDb(config.dbPath);
  const file = path.join(dir, `orbita-${stamp()}.db`);
  src.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const manifest = { file: path.basename(file), created: new Date().toISOString(), tables: counts(src), sizeBytes: fs.statSync(file).size };
  fs.writeFileSync(file + '.json', JSON.stringify(manifest, null, 2));
  src.close();
  console.log('Резервная копия создана:', file);
  console.log(manifest);
} else if (cmd === 'restore') {
  const file = process.argv[3] ?? fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort().pop();
  if (!file) throw new Error('Резервные копии не найдены');
  const from = path.resolve(dir, file);
  const manifest = JSON.parse(fs.readFileSync(from + '.json', 'utf8'));
  const target = path.join(dir, 'restore-check', 'restored.db');
  fs.rmSync(path.dirname(target), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(from, target);
  const db = openDb(target);
  const out = [];
  const check = (name, ok, detail) => { out.push({ name, ok, detail }); console.log(`${ok ? '✔' : '✘'} ${name}: ${detail}`); };

  check('Целостность файла БД (PRAGMA integrity_check)', db.get('PRAGMA integrity_check').integrity_check === 'ok', 'ok');
  check('Внешние ключи (PRAGMA foreign_key_check)', db.all('PRAGMA foreign_key_check').length === 0, 'нарушений нет');
  const c = counts(db);
  for (const t of TABLES) check(`Записей в ${t}`, c[t] === manifest.tables[t], `${c[t]} (в манифесте ${manifest.tables[t]})`);
  const over = db.get(`SELECT count(*) AS n FROM events e WHERE (SELECT count(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'active') > e.capacity`).n;
  check('Правило темы: нигде нет превышения лимита', over === 0, `событий с превышением: ${over}`);
  const cat = searchEvents(db, { when: 'all' }, 9);
  check('Чтение данных: каталог', cat.total > 0, `найдено ${cat.total}, на странице ${cat.items.length}`);

  // Изменение данных в восстановленной БД: запись и отмена
  const ev = db.get(`SELECT e.id FROM events e WHERE e.status = 'published' AND e.starts_at > ? AND e.capacity > (SELECT count(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'active')
                      AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.event_id = e.id AND r.user_id = (SELECT id FROM users WHERE login = 'andreev') AND r.status = 'active') LIMIT 1`, new Date().toISOString().slice(0, 16));
  const u = db.get("SELECT id, role FROM users WHERE login = 'andreev'");
  const before = db.get("SELECT count(*) AS n FROM registrations WHERE event_id = ? AND status = 'active'", ev.id).n;
  const reg = registerForEvent(db, u, ev.id);
  const mid = db.get("SELECT count(*) AS n FROM registrations WHERE event_id = ? AND status = 'active'", ev.id).n;
  cancelRegistration(db, u, reg.id);
  const after = db.get("SELECT count(*) AS n FROM registrations WHERE event_id = ? AND status = 'active'", ev.id).n;
  check('Основной сценарий: запись и отмена', mid === before + 1 && after === before, `было ${before}, после записи ${mid}, после отмены ${after}`);
  let dupBlocked = false;
  try { registerForEvent(db, u, ev.id); registerForEvent(db, u, ev.id); } catch (e) { dupBlocked = /уже зарегистрированы/.test(e.message); }
  check('Права и правила работают: повторная запись отклонена', dupBlocked, dupBlocked ? 'отклонено' : 'не отклонено');
  db.close();
  const failed = out.filter((x) => !x.ok).length;
  fs.writeFileSync(path.join(dir, 'restore-check', 'результат.json'), JSON.stringify({ file, date: new Date().toISOString(), checks: out }, null, 2));
  console.log(failed ? `\nПроверка восстановления: ОШИБОК ${failed}` : '\nПроверка восстановления пройдена: все проверки успешны');
  process.exit(failed ? 1 : 0);
}
