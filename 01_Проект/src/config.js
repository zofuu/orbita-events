// Конфигурация из переменных окружения (см. .env.example). Секреты в репозиторий не попадают.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Минимальный разбор .env без сторонних библиотек
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);

export const config = {
  port: Number(env('PORT', 3000)),
  host: env('HOST', '0.0.0.0'),
  dbPath: path.resolve(ROOT, env('DB_PATH', 'data/orbita.db')),
  siteUrl: env('SITE_URL', 'http://localhost:3000').replace(/\/$/, ''),
  debugErrors: env('DEBUG_ERRORS', '0') === '1',
  autoSeed: env('AUTO_SEED', '1') === '1',
  seedPassword: env('SEED_PASSWORD', 'Orbita-demo1'),
  sessionTtl: Number(env('SESSION_TTL_HOURS', 24 * 7)) * 3600 * 1000,
  pageSize: 9,
  logRequests: env('LOG_REQUESTS', '1') === '1',
};
config.cookieSecure = config.siteUrl.startsWith('https://');
