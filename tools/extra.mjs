// ER-диаграмма и снимки консоли (реальный вывод команд, сохранённый в файлы)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('..', '04_Проверки', 'снимки_экрана');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });

// ── ER ──
const T = {
  users: { x: 40, y: 40, cols: ['PK id', 'login (UNIQUE)', 'name', 'email (UNIQUE)', 'password_hash', 'role: user|organizer|admin', 'created_at'] },
  events: { x: 520, y: 40, cols: ['PK id', 'title', 'FK category_id', 'FK organizer_id', 'summary, description', 'format, city, venue', 'starts_at, ends_at', 'capacity (1..100000)', 'price (>= 0)', 'status: draft|published|cancelled'] },
  categories: { x: 960, y: 40, cols: ['PK id', 'slug (UNIQUE)', 'title', 'description', 'sort'] },
  registrations: { x: 520, y: 400, cols: ['PK id', 'FK event_id', 'FK user_id', 'status: active|cancelled', 'attended 0|1', 'created_at, cancelled_at', 'UNIQUE(event_id,user_id) WHERE active'] },
  sessions: { x: 40, y: 400, cols: ['PK token_hash', 'FK user_id (NULL)', 'csrf', 'flash', 'expires_at'] },
  messages: { x: 960, y: 330, cols: ['PK id', 'name, email', 'text', 'created_at'] },
  access_log: { x: 960, y: 520, cols: ['PK id', 'ts, method', 'route, status', 'ms'] },
};
const W = 270;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" font-family="Segoe UI, sans-serif"><rect width="1280" height="720" fill="#0a0a0b"/>`;
const hh = (t) => 34 + t.cols.length * 24 + 8;
const line = (a, b, label) => { const A = T[a], B = T[b]; const ax = A.x + (A.x < B.x ? W : 0), bx = B.x + (A.x < B.x ? 0 : W); const ay = A.y + 18, by = B.y + 18 + (a === 'users' && b === 'registrations' ? 0 : 0); svg += `<path d="M${ax} ${ay} C ${(ax + bx) / 2} ${ay}, ${(ax + bx) / 2} ${by}, ${bx} ${by}" stroke="#ff4d1f" stroke-width="1.6" fill="none"/><text x="${(ax + bx) / 2}" y="${(ay + by) / 2 - 6}" fill="#9a99a0" font-size="12" text-anchor="middle">${label}</text>`; };
svg += `<path d="M175 ${40 + hh(T.users)} L175 300 L520 470" stroke="#ff4d1f" stroke-width="1.6" fill="none"/><text x="300" y="330" fill="#9a99a0" font-size="12">1 — N регистрации</text>`;
line('users', 'events', '1 — N организатор');
line('events', 'categories', 'N — 1');
svg += `<path d="M655 ${40 + hh(T.events)} L655 400" stroke="#ff4d1f" stroke-width="1.6" fill="none"/><text x="665" y="${(40 + hh(T.events) + 400) / 2 + 20}" fill="#9a99a0" font-size="12">1 — N</text>`;
svg += `<path d="M110 400 L110 ${40 + hh(T.users)}" stroke="#ff4d1f" stroke-width="1.6" fill="none"/>`;
for (const [n, t] of Object.entries(T)) {
  svg += `<rect x="${t.x}" y="${t.y}" width="${W}" height="${hh(t)}" rx="12" fill="#131316" stroke="#3a3a41"/><rect x="${t.x}" y="${t.y}" width="${W}" height="34" rx="12" fill="#1a1a1e"/><text x="${t.x + 16}" y="${t.y + 23}" fill="#f1eee8" font-size="15" font-weight="700">${n}</text>`;
  t.cols.forEach((c, i) => { svg += `<text x="${t.x + 16}" y="${t.y + 54 + i * 24}" fill="${/^(PK|FK)/.test(c) ? '#ff6a3d' : '#d8d5ce'}" font-size="13" font-family="Consolas, monospace">${esc(c)}</text>`; });
}
svg += `<text x="40" y="700" fill="#9a99a0" font-size="13">ОРБИТА · схема БД (SQLite). Сущности темы: categories, events, registrations. Служебные: sessions, messages, access_log.</text></svg>`;
fs.writeFileSync(path.resolve('..', '02_Данные', 'er_диаграмма.svg'), svg);
let p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await p.setContent(`<body style="margin:0">${svg}</body>`);
await p.screenshot({ path: path.join(OUT, 'er_диаграмма.png') });

// ── Консоль ──
async function term(file, name, title) {
  const txt = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
  const lines = txt.split(/\r?\n/);
  const html = `<body style="margin:0;background:#0c0c0c"><div style="background:#1f1f1f;color:#ccc;font:12px Segoe UI;padding:8px 14px">${esc(title)}</div><pre style="margin:0;padding:14px;color:#cccccc;font:14px/1.35 Consolas,monospace;white-space:pre-wrap">${lines.map((l) => esc(l).replace(/(✔)/g, '<span style="color:#16c60c">$1</span>').replace(/(✘)/g, '<span style="color:#e74856">$1</span>')).join('\n')}</pre>`;
  const pg = await browser.newPage({ viewport: { width: 1100, height: 400 } });
  await pg.setContent(html);
  await pg.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  await pg.close();
}
await term(path.resolve('..', '04_Проверки', 'вывод_автотестов.txt'), 'автотесты_консоль', 'PowerShell — npm test (node scripts/test.js)');
await term(path.resolve('..', '02_Данные', 'вывод_restore.txt'), 'восстановление_консоль', 'PowerShell — npm run restore (node scripts/backup.js restore)');
await term(path.resolve('..', '02_Данные', 'вывод_db_reset.txt'), 'создание_бд_консоль', 'PowerShell — npm run db:reset');
await browser.close();
console.log('готово');
