// Общие компоненты интерфейса: каркас страницы, карточка мероприятия, поля форм, пагинация.
import { html, raw, esc } from './html.js';
import { config } from './config.js';
import { fmtDay, fmtMon, fmtWeekday, fmtPrice, eventState, STATE_LABEL, plural } from './rules.js';

const ICONS = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 4v12M6 11l6 6 6-6M5 20h14"/>',
};
export const icon = (n, cls = '') => raw(`<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] ?? ''}</svg>`);

// Фото по категории (Unsplash, свободная лицензия); вариант выбирается по номеру мероприятия
// Фото подбирается по смыслу названия; иначе — из «нейтральных» вариантов категории по номеру события
const PHOTO_BY_WORD = [
  [/йог|тренировк/i, 'sport-2'], [/заплыв|плав/i, 'sport-4'], [/забег|марафон|пробег|лыжн/i, 'sport-3'],
  [/хакатон|кибербезопас/i, 'it-4'], [/python|meetup|облач|frontend|devops|data/i, 'it-3'], [/нейросет/i, 'it-2'],
  [/библиотек|финансов/i, 'education-4'], [/sql|git|английск/i, 'education-2'],
  [/робот|выставк.*цифров|свет/i, 'exhibition-1'], [/ремёсл|фотовыставк/i, 'exhibition-3'], [/книж/i, 'exhibition-4'],
  [/джаз|электрон|хоров|симфон/i, 'culture-4'], [/стендап|спектакл|поэз/i, 'culture-3'],
];
const NEUTRAL = { sport: [1, 3], it: [1, 3], education: [1, 3], exhibition: [2, 4], culture: [1, 2], business: [1, 2, 3, 4] };
export const photo = (slug, id, title = '') => {
  const hit = PHOTO_BY_WORD.find(([re, f]) => f.startsWith(slug) && re.test(title));
  if (hit) return `/static/img/photos/${hit[1]}.jpg`;
  const pool = NEUTRAL[slug] ?? [1, 2, 3, 4];
  return `/static/img/photos/${slug}-${pool[id % pool.length]}.jpg`;
};

export const csrfField = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.csrf()}">`;

const NAV = [
  ['/events', 'Каталог'],
  ['/categories', 'Категории'],
  ['/about', 'О платформе'],
  ['/contacts', 'Контакты'],
];

function header(ctx, active) {
  const u = ctx.user;
  const cur = (href) => (active === href ? raw(' aria-current="page"') : '');
  return html`
  <a class="skip" href="#main">К основному содержимому</a>
  <header class="top">
    <div class="wrap top__row">
      <a class="logo" href="/" aria-label="ОРБИТА — на главную">
        <svg viewBox="0 0 32 32" class="logo__mark" aria-hidden="true"><circle cx="16" cy="16" r="12.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="25.4" cy="7.8" r="3.6" fill="var(--accent)"/></svg>
        <span class="logo__word">ОРБИТА</span>
      </a>
      <nav class="nav" aria-label="Основная навигация">
        ${NAV.map(([href, label]) => html`<a href="${href}"${cur(href)}>${label}</a>`)}
      </nav>
      <div class="top__auth">
        ${u ? html`
          ${u.role !== 'user' ? html`<a class="btn btn--ghost btn--sm" href="/organizer"${cur('/organizer')}>Панель</a>` : ''}
          <a class="btn btn--ghost btn--sm" href="/account/registrations"${cur('/account/registrations')}>Мои регистрации</a>
          <a class="btn btn--ghost btn--sm" href="/account"${cur('/account')}>${u.name.split(' ')[0]}</a>
          <form method="post" action="/logout" class="inline">${csrfField(ctx)}<button class="btn btn--line btn--sm" type="submit">Выйти</button></form>`
        : html`
          <a class="btn btn--ghost btn--sm" href="/login"${cur('/login')}>Войти</a>
          <a class="btn btn--accent btn--sm" href="/register"${cur('/register')}>Регистрация</a>`}
      </div>
    </div>
  </header>`;
}

function footer() {
  return html`
  <footer class="foot">
    <div class="wrap foot__grid">
      <div class="foot__brand">
        <p class="foot__big">Мероприятия,<br>которые стоит<br><span class="accent">посетить</span></p>
        <p class="muted">Единая площадка для поиска, организации и регистрации на события.</p>
      </div>
      <nav aria-label="Разделы" class="foot__col">
        <h2 class="eyebrow">Разделы</h2>
        <a href="/events">Каталог мероприятий</a><a href="/categories">Категории</a><a href="/about">О платформе</a><a href="/contacts">Контакты</a>
      </nav>
      <nav aria-label="Аккаунт" class="foot__col">
        <h2 class="eyebrow">Аккаунт</h2>
        <a href="/login">Вход</a><a href="/register">Регистрация</a><a href="/account/registrations">Мои регистрации</a><a href="/organizer">Панель организатора</a>
      </nav>
      <div class="foot__col">
        <h2 class="eyebrow">Служебное</h2>
        <a href="/sitemap.xml">Карта сайта</a>
        <span class="muted">Учебный проект УП.09.01</span>
        <span class="muted">Сидоров Е. Д., 4ИСИП-723</span>
      </div>
    </div>
  </footer>`;
}

// Каркас страницы. opts: title, description, path (канонический адрес), noindex, active, ogImage, wide
export function layout(ctx, opts, body) {
  const title = opts.title.includes('ОРБИТА') ? opts.title : `${opts.title} — ОРБИТА`;
  const desc = opts.description ?? 'ОРБИТА — платформа для поиска, организации и регистрации на мероприятия: IT, образование, бизнес, выставки, спорт и культура.';
  const canonical = `${config.siteUrl}${opts.path ?? ctx.url.pathname}`;
  const flash = ctx.flash;
  return html`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${desc}">
  <meta name="theme-color" content="#0a0a0b">
  ${opts.noindex ? raw('<meta name="robots" content="noindex, nofollow">') : html`<link rel="canonical" href="${canonical}">`}
  <meta property="og:type" content="${opts.ogType ?? 'website'}">
  <meta property="og:site_name" content="ОРБИТА">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${desc}">
  <meta property="og:url" content="${canonical}">
  ${opts.ogImage ? html`<meta property="og:image" content="${config.siteUrl}${opts.ogImage}">` : ''}
  <link rel="icon" href="/static/img/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="/static/fonts/onest-cyrillic.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/static/css/style.css">
  ${opts.head ?? ''}
</head>
<body>
  ${header(ctx, opts.active)}
  <main id="main" class="${opts.wide ? '' : ''}" tabindex="-1">
    ${flash ? html`<div class="wrap"><div class="flash flash--${flash.type}" role="${flash.type === 'err' ? 'alert' : 'status'}"><span>${flash.text}</span><button type="button" class="flash__close" data-dismiss aria-label="Закрыть уведомление">${icon('x')}</button></div></div>` : ''}
    ${body}
  </main>
  ${footer()}
  <script src="/static/js/app.js" defer></script>
</body>
</html>`;
}

export const pageHead = (eyebrow, title, lead = '') => html`
  <section class="pagehead"><div class="wrap">
    <p class="eyebrow">${eyebrow}</p>
    <h1 class="display display--md">${title}</h1>
    ${lead ? html`<p class="lead">${lead}</p>` : ''}
  </div></section>`;

export function seatMeter(e, { compact = false } = {}) {
  const state = eventState(e);
  const label = state === 'full' ? 'Мест нет'
    : state === 'cancelled' ? 'Отменено'
    : state === 'draft' ? 'Не опубликовано'
    : `${e.left} ${plural(e.left, 'место', 'места', 'мест')} из ${e.capacity}`;
  return html`<div class="seats seats--${state}${compact ? ' seats--compact' : ''}">
    <progress max="${e.capacity}" value="${Math.min(e.taken, e.capacity)}" aria-label="Занято ${e.taken} из ${e.capacity} мест"></progress>
    <span class="seats__t">${label}</span>
  </div>`;
}

export function eventCard(e) {
  const state = eventState(e);
  return html`
  <article class="card${state === 'past' || state === 'cancelled' ? ' card--dim' : ''}">
    <a class="card__cover" href="/events/${e.id}" tabindex="-1" aria-hidden="true">
      <img src="${photo(e.cat_slug, e.id, e.title)}" alt="" width="800" height="600" loading="lazy">
      <span class="card__date"><b>${fmtDay(e.starts_at)}</b>${fmtMon(e.starts_at)}</span>
      ${state !== 'open' ? html`<span class="tag tag--${state} card__state">${STATE_LABEL[state]}</span>` : ''}
    </a>
    <div class="card__body">
      <p class="eyebrow"><a href="/categories/${e.cat_slug}">${e.cat_title}</a> · ${e.format === 'online' ? 'Онлайн' : e.city}</p>
      <h3 class="card__title"><a href="/events/${e.id}">${e.title}</a></h3>
      <p class="card__meta">${fmtWeekday(e.starts_at)}, ${e.starts_at.slice(11, 16)} · ${e.format === 'online' ? 'Онлайн-трансляция' : e.venue}</p>
      <div class="card__foot">${seatMeter(e, { compact: true })}<span class="price">${fmtPrice(e.price)}</span></div>
    </div>
  </article>`;
}

// ── Формы ───────────────────────────────────────────────────────────────────
export function field(name, label, { type = 'text', value = '', error, hint, required = true, attrs = '', as, options, rows = 5 } = {}) {
  const id = `f-${name}`;
  const common = `id="${id}" name="${name}"${required ? ' required' : ''}${error ? ' aria-invalid="true"' : ''} aria-describedby="${id}-m" ${attrs}`;
  let control;
  if (as === 'textarea') control = html`<textarea ${raw(common)} rows="${rows}">${value}</textarea>`;
  else if (as === 'select') control = html`<select ${raw(common)}>${options.map(([v, t]) => html`<option value="${v}"${String(v) === String(value) ? raw(' selected') : ''}>${t}</option>`)}</select>`;
  else control = html`<input ${raw(common)} type="${type}" value="${value}">`;
  return html`<div class="field${error ? ' field--err' : ''}">
    <label for="${id}">${label}${required ? '' : html` <i>(необязательно)</i>`}</label>
    ${control}
    <p class="field__m" id="${id}-m">${error ?? hint ?? ''}</p>
  </div>`;
}

export function pagination(path, query, page, pages) {
  if (pages <= 1) return '';
  const href = (p) => {
    const q = new URLSearchParams(query);
    q.delete('page');
    if (p > 1) q.set('page', p);
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  const nums = [];
  for (let p = 1; p <= pages; p++) if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
  const out = [];
  nums.forEach((p, i) => {
    if (i && p - nums[i - 1] > 1) out.push(html`<span class="pager__gap">…</span>`);
    out.push(p === page ? html`<span class="pager__n is-cur" aria-current="page">${p}</span>` : html`<a class="pager__n" href="${href(p)}">${p}</a>`);
  });
  return html`<nav class="pager" aria-label="Страницы каталога">
    ${page > 1 ? html`<a class="pager__a" href="${href(page - 1)}" rel="prev">← Назад</a>` : html`<span class="pager__a is-off">← Назад</span>`}
    <div class="pager__list">${out}</div>
    ${page < pages ? html`<a class="pager__a" href="${href(page + 1)}" rel="next">Далее →</a>` : html`<span class="pager__a is-off">Далее →</span>`}
  </nav>`;
}

export const emptyState = (title, text, action) => html`
  <div class="empty"><p class="empty__t">${title}</p><p class="muted">${text}</p>${action ?? ''}</div>`;

export { esc };


