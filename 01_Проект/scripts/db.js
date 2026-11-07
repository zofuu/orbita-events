// Управление БД: node scripts/db.js migrate | reset
import fs from 'node:fs';
import { config } from '../src/config.js';
import { openDb, migrate } from '../src/db.js';
import { seedDatabase } from '../src/seed.js';

const cmd = process.argv[2] ?? 'migrate';

if (cmd === 'reset') {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(config.dbPath + suffix, { force: true });
}
const db = openDb(config.dbPath);
const applied = migrate(db);
console.log(`Миграции применены: ${applied.length ? applied.join(', ') : 'новых нет'}`);
if (cmd === 'reset') {
  const c = seedDatabase(db);
  console.log(`Учебные данные загружены: пользователей — ${c.users}, мероприятий — ${c.events}, регистраций — ${c.regs}`);
}
db.close();
