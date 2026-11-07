// Публичные страницы: главная, каталог, мероприятие, категории, о платформе, контакты, служебные адреса.
import { html, raw } from '../html.js';
import { config } from '../config.js';
import { HttpError, redirect, send } from '../http.js';
import {
  getEvent, getCategories, searchEvents, upcomingEvents, siteCounters, SORTS, localIso, fmtRange, fmtPrice, fmtWeekday, fmtDay, fmtMon,
  eventState, STATE_LABEL, getUserRegistration, plural, canManage, EMAIL_RE,
} from '../rules.js';
import { layout, pageHead, eventCard, seatMeter, pagination, emptyState, field, csrfField, icon, photo } from '../ui.js';
import { coverSvg } from '../cover.js';

const CAT_LEAD = {
  it: 'Конференции, хакатоны и митапы для разработчиков, аналитиков и инженеров.',
  education: 'Лекции, интенсивы и мастер-классы: от основ до практики.',
  business: 'Форумы, питч-сессии и встречи для предпринимателей и команд.',
  exhibition: 'Выставки, ярмарки и фестивали: искусство, технологии, еда и игры.',
  sport: 'Забеги, турниры и открытые тренировки для любого уровня.',
  culture: 'Концерты, спектакли и вечера: живая сцена в вашем городе.',
};

function renderDescription(text) {
  // Абзацы разделяются пустой строкой; строки с «– » образуют список (всё экранируется)
  return text.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length && lines.every((l) => l.startsWith('– '))) return html`<ul class="plist">${lines.map((l) => html`<li>${l.slice(2)}</li>`)}</ul>`;
    return html`<p>${lines.join(' ')}</p>`;
  });
}

function registrationPanel(ctx, e) {
  const state = eventState(e);
  const reg = ctx.user ? getUserRegistration(ctx.db, ctx.user.id, e.id) : null;
  let action;
  if (reg) {
    action = html`<p class="note note--ok">${icon('check')} Вы зарегистрированы на это мероприятие</p>
      ${state === 'open' || state === 'full' ? html`<form method="post" action="/registrations/${reg.id}/cancel" data-confirm="Отменить регистрацию? Место будет освобождено.">${csrfField(ctx)}<input type="hidden" name="back" value="/events/${e.id}"><button class="btn btn--line btn--block" type="submit">Отменить регистрацию</button></form>` : ''}`;
  } else if (state === 'open') {
    action = ctx.user
      ? html`<form method="post" action="/events/${e.id}/register">${csrfField(ctx)}<button class="btn btn--accent btn--lg btn--block" type="submit">Зарегистрироваться</button></form>`
      : html`<a class="btn btn--accent btn--lg btn--block" href="/login?next=${encodeURIComponent('/events/' + e.id)}">Войти и зарегистрироваться</a>`;
  } else if (state === 'full') {
    action = html`<button class="btn btn--block" type="button" disabled>Мест нет</button><p class="muted small">Лимит участников достигнут. Если кто-то отменит регистрацию, место появится снова.</p>`;
  } else {
    action = html`<button class="btn btn--block" type="button" disabled>${state === 'cancelled' ? 'Мероприятие отменено' : state === 'draft' ? 'Не опубликовано' : 'Регистрация закрыта'}</button>`;
  }
  return html`
    <aside class="reg panel" aria-label="Регистрация">
      <p class="eyebrow">Регистрация</p>
      <p class="reg__price">${fmtPrice(e.price)}</p>
      ${seatMeter(e)}
      <dl class="reg__stats">
        <div><dt>Занято</dt><dd>${e.taken}</dd></div>
        <div><dt>Свободно</dt><dd>${e.left}</dd></div>
        <div><dt>Лимит</dt><dd>${e.capacity}</dd></div>
      </dl>
      ${action}
      ${canManage(ctx.user, e) ? html`<a class="btn btn--ghost btn--block" href="/organizer/events/${e.id}/registrations">Участники (${e.taken})</a>` : ''}
    </aside>`;
}

export function publicRoutes(r) {
  // ── Главная ────────────────────────────────────────────────────────────────
  r.get('/', (ctx) => {
    const cats = getCategories(ctx.db);
    const c = siteCounters(ctx.db);
    const events = upcomingEvents(ctx.db, 6);
    const body = html`
    <section class="hero">
      <div class="wrap hero__grid">
        <div class="hero__text">
          <p class="eyebrow eyebrow--live"><i></i> Платформа мероприятий</p>
          <h1 class="display">Найдите событие<br>и займите <span class="accent">место</span></h1>
          <p class="lead">IT-конференции, лекции, форумы, фестивали, спорт и концерты в одном каталоге. Чёткий лимит мест, честная регистрация и личный кабинет.</p>
          <form class="hero__search" action="/events" method="get" role="search">
            <label class="sr" for="hq">Поиск по названию</label>
            <input id="hq" name="q" type="search" placeholder="Название мероприятия" autocomplete="off">
            <button class="btn btn--accent" type="submit">Найти</button>
          </form>
        </div>
        <div class="hero__art" aria-hidden="true">
          <img src="${photo(events[0]?.cat_slug ?? 'it', events[0]?.id ?? 1, events[0]?.title)}" alt="" width="1200" height="900">
          ${events[0] ? html`<div class="hero__tag"><span class="eyebrow">Ближайшее</span><b>${events[0].title}</b><span>${fmtDay(events[0].starts_at)} ${fmtMon(events[0].starts_at)} · ${events[0].format === 'online' ? 'Онлайн' : events[0].city}</span></div>` : ''}
        </div>
      </div>
      <div class="wrap"><dl class="stats">
        <div><dt>Предстоящих мероприятий</dt><dd>${c.events}</dd></div>
        <div><dt>Городов и онлайн</dt><dd>${c.cities}+</dd></div>
        <div><dt>Активных регистраций</dt><dd>${c.regs}</dd></div>
        <div><dt>Организаторов</dt><dd>${c.organizers}</dd></div>
      </dl></div>
    </section>

    <section class="section">
      <div class="wrap">
        <div class="section__head"><div><p class="eyebrow">Категории</p><h2 class="display display--sm">Шесть направлений</h2></div><a class="link-arrow" href="/categories">Все категории ${icon('arrow')}</a></div>
        <div class="cats">
          ${cats.map((k, i) => html`<a class="cat" href="/categories/${k.slug}"><span class="cat__n">0${i + 1}</span><span class="cat__t">${k.title}</span><span class="cat__c">${k.upcoming} ${plural(k.upcoming, 'событие', 'события', 'событий')}</span>${icon('arrow', 'cat__a')}</a>`)}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="wrap">
        <div class="section__head"><div><p class="eyebrow">Скоро</p><h2 class="display display--sm">Ближайшие мероприятия</h2></div><a class="link-arrow" href="/events">Весь каталог ${icon('arrow')}</a></div>
        <div class="grid">${events.map(eventCard)}</div>
      </div>
    </section>

    <section class="section">
      <div class="wrap">
        <p class="eyebrow">Как это работает</p>
        <h2 class="display display--sm">Три шага до места в зале</h2>
        <ol class="steps">
          <li><span class="steps__n">1</span><h3>Выберите</h3><p>Ищите по названию, категории и датам, сортируйте по популярности и цене.</p></li>
          <li><span class="steps__n">2</span><h3>Зарегистрируйтесь</h3><p>Сервер проверяет лимит и повторную запись. Результат — сразу на экране.</p></li>
          <li><span class="steps__n">3</span><h3>Управляйте</h3><p>В кабинете — предстоящие события и история. Отмена освобождает место другому.</p></li>
        </ol>
      </div>
    </section>

    <section class="section">
      <div class="wrap"><div class="cta">
        <div><p class="eyebrow">Организаторам</p><h2 class="display display--sm">Проводите мероприятия — мы считаем места</h2><p class="lead">Создайте событие, задайте лимит и следите за заполнением. Превысить лимит невозможно даже при одновременных заявках.</p></div>
        <div class="actions"><a class="btn btn--accent btn--lg" href="/register">Стать организатором</a><a class="btn btn--ghost btn--lg" href="/about">Как это устроено</a></div>
      </div></div>
    </section>`;
    return layout(ctx, {
      title: 'ОРБИТА — платформа мероприятий: поиск и регистрация на события',
      description: 'Каталог мероприятий: IT-конференции, лекции, бизнес-форумы, выставки, спорт и концерты. Поиск, фильтры и регистрация с гарантированным лимитом мест.',
      path: '/', ogImage: events[0] ? photo(events[0].cat_slug, events[0].id, events[0].title) : undefined,
    }, body);
  });

  // ── Каталог ────────────────────────────────────────────────────────────────
  r.get('/events', (ctx) => {
    const q = (ctx.query.q ?? '').trim().slice(0, 100);
    const f = { ...ctx.query, q };
    const cats = getCategories(ctx.db);
    const res = searchEvents(ctx.db, f, config.pageSize);
    const keep = Object.fromEntries(['q', 'category', 'from', 'to', 'sort', 'when', 'seats', 'free'].filter((k) => f[k]).map((k) => [k, f[k]]));
    const cat = cats.find((c) => c.slug === f.category);
    const active = Object.keys(keep).filter((k) => !['sort'].includes(k) && !(k === 'when' && keep[k] === 'upcoming')).length;
    const body = html`
    ${pageHead('Каталог', cat ? cat.title : 'Все мероприятия', cat ? CAT_LEAD[cat.slug] : 'Найдите событие по названию, категории и дате.')}
    <section class="wrap catalog">
      <form class="filters" method="get" action="/events" role="search">
        <div class="filters__row">
          <div class="field field--grow"><label for="q">Название</label><input id="q" name="q" type="search" value="${q}" placeholder="Например, DevForge" autocomplete="off"></div>
          <div class="field"><label for="category">Категория</label><select id="category" name="category"><option value="">Все категории</option>${cats.map((c) => html`<option value="${c.slug}"${f.category === c.slug ? raw(' selected') : ''}>${c.title}</option>`)}</select></div>
          <div class="field"><label for="from">Дата с</label><input id="from" name="from" type="date" value="${f.from ?? ''}"></div>
          <div class="field"><label for="to">Дата по</label><input id="to" name="to" type="date" value="${f.to ?? ''}"></div>
          <div class="field"><label for="sort">Сортировка</label><select id="sort" name="sort">${Object.entries(SORTS).map(([k, [t]]) => html`<option value="${k}"${(f.sort ?? 'date') === k ? raw(' selected') : ''}>${t}</option>`)}</select></div>
        </div>
        <div class="filters__row filters__row--b">
          <div class="seg" role="group" aria-label="Период">
            ${[['upcoming', 'Предстоящие'], ['past', 'Прошедшие'], ['all', 'Все']].map(([v, t]) => html`<label><input type="radio" name="when" value="${v}"${res.when === v ? raw(' checked') : ''}><span>${t}</span></label>`)}
          </div>
          <label class="check"><input type="checkbox" name="seats" value="1"${f.seats === '1' ? raw(' checked') : ''}><span>Только со свободными местами</span></label>
          <label class="check"><input type="checkbox" name="free" value="1"${f.free === '1' ? raw(' checked') : ''}><span>Бесплатные</span></label>
          <div class="filters__actions"><button class="btn btn--accent" type="submit">Применить</button>${active ? html`<a class="btn btn--ghost" href="/events">Сбросить</a>` : ''}</div>
        </div>
      </form>
      <p class="count" aria-live="polite">Найдено: <b>${res.total}</b> ${plural(res.total, 'мероприятие', 'мероприятия', 'мероприятий')}${res.pages > 1 ? html` · страница ${res.page} из ${res.pages}` : ''}</p>
      ${res.items.length
        ? html`<div class="grid">${res.items.map(eventCard)}</div>${pagination('/events', keep, res.page, res.pages)}`
        : emptyState('Ничего не найдено', 'Измените запрос, снимите часть фильтров или выберите другой период.', html`<a class="btn btn--accent" href="/events">Сбросить фильтры</a>`)}
    </section>`;
    return layout(ctx, {
      title: cat ? `${cat.title} — каталог мероприятий` : 'Каталог мероприятий: поиск, фильтры, регистрация',
      description: cat ? `${cat.title}: ${CAT_LEAD[cat.slug]} Расписание, свободные места, регистрация онлайн.` : 'Каталог мероприятий платформы ОРБИТА: IT, образование, бизнес, выставки, спорт и культура. Поиск по названию, фильтры по категории и дате.',
      active: '/events', path: '/events', noindex: Boolean(q || f.from || f.to || f.page > 1),
    }, body);
  });

  // ── Мероприятие ────────────────────────────────────────────────────────────
  r.get('/events/:id', (ctx) => {
    const e = getEvent(ctx.db, ctx.params.id);
    if (!e || (e.status === 'draft' && !canManage(ctx.user, e))) throw new HttpError(404, 'Мероприятие не найдено');
    const state = eventState(e);
    const similar = upcomingEvents(ctx.db, 4, e.cat_slug).filter((x) => x.id !== e.id).slice(0, 3);
    const ld = {
      '@context': 'https://schema.org', '@type': 'Event', name: e.title, description: e.summary,
      startDate: e.starts_at, endDate: e.ends_at,
      eventAttendanceMode: e.format === 'online' ? 'https://schema.org/OnlineEventAttendanceMode' : 'https://schema.org/OfflineEventAttendanceMode',
      eventStatus: e.status === 'cancelled' ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
      location: e.format === 'online' ? { '@type': 'VirtualLocation', url: `${config.siteUrl}/events/${e.id}` } : { '@type': 'Place', name: e.venue, address: e.city },
      image: `${config.siteUrl}${photo(e.cat_slug, e.id, e.title)}`, organizer: { '@type': 'Organization', name: e.org_name },
      offers: { '@type': 'Offer', price: e.price, priceCurrency: 'RUB', availability: e.left > 0 ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut', url: `${config.siteUrl}/events/${e.id}` },
    };
    const body = html`
    <article>
      <section class="ev-hero">
        <div class="wrap">
          <nav class="crumbs" aria-label="Навигация"><a href="/">Главная</a><span>/</span><a href="/events">Каталог</a><span>/</span><a href="/categories/${e.cat_slug}">${e.cat_title}</a></nav>
          <div class="ev-hero__grid">
            <div>
              <p class="eyebrow">${e.cat_title}${state !== 'open' ? html` · <span class="tag tag--${state}">${STATE_LABEL[state]}</span>` : ''}</p>
              <h1 class="display display--md">${e.title}</h1>
              <p class="lead">${e.summary}</p>
            </div>
            <img class="ev-hero__img" src="${photo(e.cat_slug, e.id, e.title)}" alt="Фото к мероприятию «${e.title}»" width="1200" height="900">
          </div>
        </div>
      </section>
      <div class="wrap ev-body">
        <div class="ev-main">
          <dl class="facts">
            <div>${icon('cal')}<dt>Дата и время</dt><dd>${fmtRange(e.starts_at, e.ends_at)}</dd></div>
            <div>${icon(e.format === 'online' ? 'globe' : 'pin')}<dt>Место</dt><dd>${e.format === 'online' ? 'Онлайн' : `${e.city}, ${e.venue}`}</dd></div>
            <div>${icon('user')}<dt>Организатор</dt><dd>${e.org_name}</dd></div>
          </dl>
          <h2 class="h3">О мероприятии</h2>
          <div class="prose">${renderDescription(e.description || e.summary)}</div>
        </div>
        ${registrationPanel(ctx, e)}
      </div>
      ${similar.length ? html`<section class="section"><div class="wrap">
        <div class="section__head"><div><p class="eyebrow">Похожие</p><h2 class="display display--sm">Ещё в категории «${e.cat_title}»</h2></div></div>
        <div class="grid">${similar.map(eventCard)}</div></div></section>` : ''}
    </article>`;
    return layout(ctx, {
      title: `${e.title} — ${fmtDay(e.starts_at)} ${fmtMon(e.starts_at).toLowerCase()}, ${e.format === 'online' ? 'онлайн' : e.city}`,
      description: `${e.summary} ${fmtRange(e.starts_at, e.ends_at)}. ${fmtPrice(e.price)}. Регистрация онлайн.`.slice(0, 300),
      path: `/events/${e.id}`, active: '/events', ogType: 'article', ogImage: photo(e.cat_slug, e.id, e.title), noindex: e.status === 'draft',
      head: raw(`<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`),
    }, body);
  });

  // ── Категории ──────────────────────────────────────────────────────────────
  r.get('/categories', (ctx) => {
    const cats = getCategories(ctx.db);
    const body = html`${pageHead('Категории', 'Выберите направление', 'Шесть тематик: от технологических конференций до концертов.')}
      <section class="wrap"><div class="catbig">
        ${cats.map((k, i) => html`<a class="catbig__item" href="/categories/${k.slug}">
          <img src="${photo(k.slug, i)}" alt="" width="1200" height="900" loading="lazy">
          <div class="catbig__t"><span class="eyebrow">0${i + 1} · ${k.upcoming} ${plural(k.upcoming, 'событие', 'события', 'событий')}</span><h2 class="h3">${k.title}</h2><p>${CAT_LEAD[k.slug]}</p></div>
        </a>`)}
      </div></section>`;
    return layout(ctx, {
      title: 'Категории мероприятий: IT, образование, бизнес, выставки, спорт, культура',
      description: 'Шесть категорий мероприятий платформы ОРБИТА: IT-конференции, лекции и мастер-классы, бизнес-форумы, выставки и фестивали, спорт, культурные события.',
      active: '/categories', path: '/categories',
    }, body);
  });

  r.get('/categories/:slug', (ctx) => {
    const cats = getCategories(ctx.db);
    const cat = cats.find((c) => c.slug === ctx.params.slug);
    if (!cat) throw new HttpError(404, 'Категория не найдена');
    const items = upcomingEvents(ctx.db, 9, cat.slug);
    const body = html`${pageHead(`Категория · ${cat.upcoming} ${plural(cat.upcoming, 'событие', 'события', 'событий')}`, cat.title, cat.description)}
      <section class="wrap">
        ${items.length ? html`<div class="grid">${items.map(eventCard)}</div>` : emptyState('Пока нет предстоящих событий', 'Загляните позже или посмотрите другие категории.', html`<a class="btn btn--accent" href="/categories">Все категории</a>`)}
        <div class="actions section__foot"><a class="btn btn--ghost" href="/events?category=${cat.slug}">Все мероприятия категории ${icon('arrow')}</a><a class="btn btn--ghost" href="/events?category=${cat.slug}&when=past">Прошедшие</a></div>
      </section>`;
    return layout(ctx, {
      title: `${cat.title} — мероприятия и регистрация`, description: `${cat.title}: ${CAT_LEAD[cat.slug]} Ближайшие события, свободные места и регистрация онлайн.`,
      active: '/categories', path: `/categories/${cat.slug}`,
    }, body);
  });

  // ── О платформе ────────────────────────────────────────────────────────────
  r.get('/about', (ctx) => {
    const body = html`${pageHead('О платформе', 'Единая площадка для событий', 'ОРБИТА объединяет участников и организаторов: каталог, регистрация и управление в одном месте.')}
    <section class="wrap prose-wide">
      <div class="cols">
        <div><h2 class="h3">Зачем это нужно</h2><p>Информация о мероприятиях разбросана по чатам и афишам, а запись ведётся в таблицах, где легко превысить число мест или записать человека дважды. ОРБИТА решает это одной системой: каталог для участников и панель для организаторов.</p></div>
        <div><h2 class="h3">Главное правило</h2><p>Число активных регистраций никогда не превышает лимит участников. Проверка выполняется на сервере в транзакции и дополнительно в базе данных: триггер блокирует лишнюю запись, а уникальный индекс — повторную регистрацию одного пользователя.</p></div>
      </div>
      <h2 class="h3 mt">Возможности</h2>
      <div class="feat">
        <div><b>Участнику</b><p>Каталог с поиском, фильтрами и сортировкой. Регистрация, отмена, предстоящие события и история посещений в личном кабинете.</p></div>
        <div><b>Организатору</b><p>Создание и редактирование событий, лимит мест, список участников, отметка посещения и выгрузка в CSV.</p></div>
        <div><b>Платформе</b><p>Роли и права на сервере, защита форм от подделки запросов, журнал обращений и резервное копирование базы.</p></div>
      </div>
      <h2 class="h3 mt">Технологии</h2>
      <p class="muted">Node.js 24, встроенная СУБД SQLite, серверная генерация страниц без внешних зависимостей, адаптивная вёрстка на CSS Grid. Проект выполнен как учебная практика УП.09.01 студентом группы 4ИСИП-723 Сидоровым Е. Д. Все данные на сайте вымышленные.</p>
      <div class="actions mt"><a class="btn btn--accent" href="/events">Открыть каталог</a><a class="btn btn--ghost" href="/contacts">Связаться с нами</a></div>
    </section>`;
    return layout(ctx, {
      title: 'О платформе ОРБИТА — как работает регистрация на мероприятия',
      description: 'Платформа ОРБИТА: каталог мероприятий для участников и панель для организаторов. Гарантированный лимит мест и защита от повторной регистрации.',
      active: '/about', path: '/about',
    }, body);
  });

  // ── Контакты ───────────────────────────────────────────────────────────────
  const contactsPage = (ctx, { values = {}, errors = {} } = {}) => layout(ctx, {
    title: 'Контакты — связаться с командой ОРБИТА',
    description: 'Напишите команде платформы ОРБИТА: вопросы по регистрации, предложения организаторам и сообщения об ошибках.',
    active: '/contacts', path: '/contacts',
  }, html`${pageHead('Контакты', 'Напишите нам', 'Вопросы по мероприятиям, предложения и сообщения об ошибках.')}
    <section class="wrap contacts">
      <div class="contacts__info">
        <div><p class="eyebrow">Почта</p><p class="h3">hello@orbita.example</p></div>
        <div><p class="eyebrow">Телефон</p><p class="h3">+7 (000) 000-00-00</p></div>
        <div><p class="eyebrow">Офис</p><p class="h3">Москва, учебный адрес: Колледж информатики и программирования</p></div>
        <p class="muted small">Контактные данные вымышленные: проект учебный.</p>
      </div>
      <form class="panel" method="post" action="/contacts" novalidate>
        ${csrfField(ctx)}
        ${field('name', 'Ваше имя', { value: values.name ?? ctx.user?.name ?? '', error: errors.name })}
        ${field('email', 'E-mail', { type: 'email', value: values.email ?? ctx.user?.email ?? '', error: errors.email })}
        ${field('text', 'Сообщение', { as: 'textarea', value: values.text ?? '', error: errors.text, hint: 'От 10 до 2000 символов' })}
        <button class="btn btn--accent btn--lg" type="submit">Отправить</button>
      </form>
    </section>`);

  r.get('/contacts', (ctx) => contactsPage(ctx));
  r.post('/contacts', (ctx) => {
    const v = { name: String(ctx.body.name ?? '').trim(), email: String(ctx.body.email ?? '').trim(), text: String(ctx.body.text ?? '').trim() };
    const errors = {};
    if (v.name.length < 2 || v.name.length > 80) errors.name = 'Имя — от 2 до 80 символов';
    if (!EMAIL_RE.test(v.email)) errors.email = 'Введите корректный e-mail';
    if (v.text.length < 10 || v.text.length > 2000) errors.text = 'Сообщение — от 10 до 2000 символов';
    if (Object.keys(errors).length) return send(ctx, 422, contactsPage(ctx, { values: v, errors }).toString());
    ctx.db.run('INSERT INTO messages(name, email, text) VALUES (?,?,?)', v.name, v.email, v.text);
    ctx.setFlash('ok', 'Сообщение отправлено. Мы ответим на указанный e-mail.');
    return redirect(ctx, '/contacts');
  });

  // ── Служебное ──────────────────────────────────────────────────────────────
  r.get('/cover/:file', (ctx) => {
    const m = /^(\d+)\.svg$/.exec(ctx.params.file);
    if (!m) throw new HttpError(404, 'Файл не найден');
    const row = ctx.db.get('SELECT e.id, c.slug FROM events e JOIN categories c ON c.id = e.category_id WHERE e.id = ?', Number(m[1]));
    if (!row) throw new HttpError(404, 'Файл не найден');
    return { body: coverSvg(row.slug, row.id), headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } };
  });

  r.get('/sitemap.xml', (ctx) => {
    const rows = ctx.db.all("SELECT id, updated_at FROM events WHERE status = 'published' ORDER BY id");
    const cats = getCategories(ctx.db);
    const u = (p, pr) => `<url><loc>${config.siteUrl}${p}</loc><priority>${pr}</priority></url>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
      + [u('/', '1.0'), u('/events', '0.9'), u('/categories', '0.7'), u('/about', '0.5'), u('/contacts', '0.4')].join('\n') + '\n'
      + cats.map((c) => u(`/categories/${c.slug}`, '0.6')).join('\n') + '\n'
      + rows.map((e) => `<url><loc>${config.siteUrl}/events/${e.id}</loc><lastmod>${e.updated_at.slice(0, 10)}</lastmod><priority>0.8</priority></url>`).join('\n')
      + '\n</urlset>\n';
    return { body: xml, headers: { 'Content-Type': 'application/xml; charset=utf-8' } };
  });

  r.get('/robots.txt', () => ({
    body: `User-agent: *\nAllow: /\nDisallow: /account\nDisallow: /organizer\nDisallow: /admin\nDisallow: /login\nDisallow: /register\nDisallow: /registrations\nSitemap: ${config.siteUrl}/sitemap.xml\n`,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  }));

  r.get('/health', (ctx) => {
    ctx.db.get('SELECT 1 AS ok');
    return { body: 'ok', headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } };
  });
}


