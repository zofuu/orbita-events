// Снимки экрана реально работающего сайта (Edge + playwright-core). Запуск: node shots.mjs [фильтр]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const OUT = path.resolve('..', '04_Проверки', 'снимки_экрана');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PASS = 'Orbita-demo1';
const only = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const log = [];

async function ctxFor(width, height = 900) {
  const c = await browser.newContext({ viewport: { width, height }, locale: 'ru-RU', deviceScaleFactor: 1, reducedMotion: 'reduce' });
  return c;
}
async function login(page, user) {
  await page.goto(BASE + '/login');
  await page.fill('#f-login', user);
  await page.fill('#f-password', PASS);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login')), page.click('button[type=submit].btn--accent')]);
}
async function shot(page, name, { full = true, clip } = {}) {
  if (only && !name.includes(only)) return;
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('is-in')));
  if (full) {
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
      window.scrollTo(0, 0);
    });
  }
  await page.waitForTimeout(300);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: full, clip });
  if (full) await page.screenshot({ path: path.join(OUT, `${name}__экран.png`), fullPage: false });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  log.push({ name, width: page.viewportSize().width, overflow });
  console.log(`${overflow ? '⚠ overflow' : '✔'} ${name}`);
}

// ── Три размера экрана для основных страниц (задание 4) ───────────────────────
for (const w of [1280, 768, 360]) {
  const c = await ctxFor(w); const p = await c.newPage();
  await p.goto(BASE + '/'); await shot(p, `главная_${w}`, { full: false }); if (w === 1280) await shot(p, 'главная_полная');
  await p.goto(BASE + '/events'); await shot(p, `каталог_${w}`, { full: w !== 1280 || true });
  const id = await p.evaluate(() => document.querySelector('.card__title a').getAttribute('href'));
  await p.goto(BASE + id); await shot(p, `мероприятие_${w}`);
  await c.close();
}

// ── Публичные страницы ───────────────────────────────────────────────────────
{
  const c = await ctxFor(1280); const p = await c.newPage();
  await p.goto(BASE + '/events?q=' + encodeURIComponent('питч')); await shot(p, 'каталог_поиск');
  await p.goto(BASE + '/events?category=sport&sort=popular&when=all'); await shot(p, 'каталог_фильтр_категория');
  await p.goto(BASE + '/events?q=' + encodeURIComponent('такого нет')); await shot(p, 'каталог_пусто');
  await p.goto(BASE + '/events?when=all&page=2'); await shot(p, 'каталог_страница_2');
  await p.goto(BASE + '/categories'); await shot(p, 'категории');
  await p.goto(BASE + '/categories/it'); await shot(p, 'категория_it');
  await p.goto(BASE + '/about'); await shot(p, 'о_платформе');
  await p.goto(BASE + '/contacts'); await shot(p, 'контакты');
  await p.goto(BASE + '/login'); await shot(p, 'вход');
  await p.fill('#f-login', 'ivanova'); await p.fill('#f-password', 'неверный-пароль1');
  await p.click('button[type=submit].btn--accent'); await p.waitForLoadState(); await shot(p, 'вход_ошибка');
  await p.goto(BASE + '/register'); await shot(p, 'регистрация_форма');
  await p.fill('#f-name', 'А'); await p.fill('#f-login', 'ivanova'); await p.fill('#f-email', 'плохой'); await p.fill('#f-password', '123');
  await p.click('button[type=submit].btn--accent'); await p.waitForLoadState(); await shot(p, 'регистрация_ошибки');
  await p.goto(BASE + '/account'); await shot(p, 'ошибка_401', { full: false });
  await p.goto(BASE + '/events/99999'); await shot(p, 'страница_404', { full: false });
  await c.close();
}

// ── Участник: регистрация, лимит, кабинет ────────────────────────────────────
{
  const c = await ctxFor(1280); const p = await c.newPage();
  await login(p, 'volkov');
  // свободное мероприятие, на которое volkov ещё не записан
  const free = await p.evaluate(async () => {
    const r = await fetch('/events?seats=1&sort=seats'); const t = await r.text();
    return [...t.matchAll(/class="card__title"><a href="(\/events\/\d+)"/g)].map((m) => m[1]);
  });
  let target;
  for (const href of free) { await p.goto(BASE + href); if (await p.locator('form[action$="/register"] button').count()) { target = href; break; } }
  await shot(p, 'мероприятие_до_регистрации');
  await p.click('form[action$="/register"] button'); await p.waitForLoadState();
  await shot(p, 'регистрация_успех');
  await p.goto(BASE + target);
  await p.evaluate(() => document.querySelector('form[action$="/register"]'));
  // повторная регистрация обходом интерфейса: отправляем форму напрямую
  await p.evaluate(async (t) => {
    const csrf = document.querySelector('input[name=_csrf]').value;
    await fetch(t + '/register', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '_csrf=' + encodeURIComponent(csrf) });
  }, target);
  await p.goto(BASE + target); await shot(p, 'регистрация_повтор_уведомление', { full: false });
  // заполненное мероприятие
  await p.goto(BASE + '/events?when=upcoming&sort=popular');
  const fullHref = await p.evaluate(async () => {
    const r = await fetch('/events?when=upcoming&sort=popular'); const t = await r.text();
    const m = [...t.matchAll(/<article class="card[^>]*>[\s\S]*?<\/article>/g)].find((x) => x[0].includes('Мест нет'));
    return m ? /href="(\/events\/\d+)"/.exec(m[0])[1] : null;
  });
  await p.goto(BASE + fullHref); await shot(p, 'регистрация_лимит_достигнут');
  await p.evaluate(async (t) => {
    const csrf = document.querySelector('input[name=_csrf]').value;
    await fetch(t + '/register', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '_csrf=' + encodeURIComponent(csrf) });
  }, fullHref);
  await p.goto(BASE + fullHref); await shot(p, 'регистрация_лимит_уведомление', { full: false });
  await p.goto(BASE + '/account'); await shot(p, 'кабинет');
  await p.goto(BASE + '/account/registrations'); await shot(p, 'мои_регистрации');
  p.once('dialog', (d) => d.accept());
  await p.click('.reg-row form button'); await p.waitForLoadState(); await shot(p, 'отмена_регистрации');
  await p.goto(BASE + '/account/registrations?tab=history'); await shot(p, 'история_посещений');
  await p.goto(BASE + '/account/registrations?tab=cancelled'); await shot(p, 'отменённые_регистрации');
  await p.goto(BASE + '/organizer'); await shot(p, 'доступ_запрещён_403', { full: false });
  await c.close();
}

// ── Мобильные экраны участника ───────────────────────────────────────────────
{
  const c = await ctxFor(360, 800); const p = await c.newPage();
  await login(p, 'ivanova');
  await p.goto(BASE + '/account/registrations'); await shot(p, 'мои_регистрации_360');
  await p.goto(BASE + '/events'); await shot(p, 'каталог_фильтры_360', { full: false });
  await c.close();
}

// ── Организатор ──────────────────────────────────────────────────────────────
{
  const c = await ctxFor(1280); const p = await c.newPage();
  await login(p, 'kovaleva');
  await p.goto(BASE + '/organizer'); await shot(p, 'панель_организатора');
  await p.goto(BASE + '/organizer/events/new'); await shot(p, 'создание_мероприятия');
  await p.fill('#f-title', 'ab'); await p.fill('#f-capacity', '0'); await p.selectOption('#f-category_id', '1');
  await p.fill('#f-summary', 'коротко'); await p.fill('#f-city', 'М'); await p.fill('#f-venue', 'Площадка');
  await p.click('button[type=submit].btn--accent'); await p.waitForLoadState(); await shot(p, 'создание_ошибки_валидации');
  await p.goto(BASE + '/organizer/events/new');
  await p.fill('#f-title', 'Митап «Орбита»: практика бэкенда'); await p.selectOption('#f-category_id', '1');
  await p.fill('#f-summary', 'Вечерний митап: три коротких доклада о серверной разработке.');
  await p.fill('#f-description', 'Три доклада по 20 минут и свободное общение.\n\nПрограмма:\n\n– Архитектура сервиса\n– Транзакции и блокировки\n– Наблюдаемость');
  await p.fill('#f-city', 'Москва'); await p.fill('#f-venue', 'Технопарк «Вектор»'); await p.fill('#f-capacity', '3'); await p.fill('#f-price', '0');
  await p.selectOption('#f-status', 'published');
  await p.click('button[type=submit].btn--accent'); await p.waitForLoadState(); await shot(p, 'мероприятие_создано_участники');
  const url = p.url().replace('/registrations', '');
  await p.goto(url + '/edit'); await shot(p, 'редактирование_мероприятия');
  await p.goto(BASE + '/organizer/events/1/registrations'); await shot(p, 'участники_мероприятия');
  await p.goto(BASE + '/organizer/events/9/registrations'); await shot(p, 'доступ_к_чужому_403', { full: false });
  await c.close();
}
{
  const c = await ctxFor(360, 800); const p = await c.newPage();
  await login(p, 'kovaleva');
  await p.goto(BASE + '/organizer'); await shot(p, 'панель_организатора_360');
  await p.goto(BASE + '/organizer/events/1/registrations'); await shot(p, 'участники_360');
  await c.close();
}
{
  const c = await ctxFor(1280); const p = await c.newPage();
  await login(p, 'admin');
  await p.goto(BASE + '/admin'); await shot(p, 'админ_статистика');
  await c.close();
}

fs.writeFileSync(path.join(OUT, '_отчёт_снимков.json'), JSON.stringify(log, null, 2));
await browser.close();
console.log(`Снимков: ${log.length}, с горизонтальным переполнением: ${log.filter((l) => l.overflow).length}`);

