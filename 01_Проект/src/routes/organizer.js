// Панель организатора (создание, правка, участники) и раздел администратора.
import { html, raw } from '../html.js';
import { HttpError, redirect, send, safeLocal } from '../http.js';
import {
  getCategories, organizerEvents, getManagedEvent, validateEvent, saveEvent, eventRegistrations, setAttendance, eventState,
  STATE_LABEL, fmtDateTime, fmtRange, fmtPrice, plural, localIso, accessStats,
} from '../rules.js';
import { layout, pageHead, field, csrfField, seatMeter, emptyState, icon } from '../ui.js';

const ORG = { roles: ['organizer', 'admin'] };

function eventForm(ctx, { values, errors = {}, event }) {
  const cats = getCategories(ctx.db);
  const isNew = !event;
  const action = isNew ? '/organizer/events' : `/organizer/events/${event.id}`;
  const v = values;
  const locked = event?.taken ?? 0;
  return html`
  <form class="panel eform" method="post" action="${action}" novalidate>
    ${csrfField(ctx)}
    <div class="eform__grid">
      <div class="eform__wide">${field('title', 'Название', { value: v.title, error: errors.title, attrs: 'maxlength="120"' })}</div>
      ${field('category_id', 'Категория', { as: 'select', value: v.category_id, error: errors.category_id, options: [['', 'Выберите…'], ...cats.map((c) => [c.id, c.title])] })}
      ${field('format', 'Формат', { as: 'select', value: v.format, error: errors.format, options: [['offline', 'Очно'], ['online', 'Онлайн']] })}
      <div class="eform__wide">${field('summary', 'Краткое описание', { value: v.summary, error: errors.summary, hint: 'Показывается в карточке, 10–200 символов', attrs: 'maxlength="200"' })}</div>
      <div class="eform__wide">${field('description', 'Подробное описание', { as: 'textarea', rows: 8, value: v.description, error: errors.description, required: false, hint: 'Абзацы разделяйте пустой строкой; строки, начинающиеся с «– », станут списком' })}</div>
      ${field('city', 'Город', { value: v.city, error: errors.city })}
      ${field('venue', 'Место проведения', { value: v.venue, error: errors.venue, hint: 'Для онлайн — платформа или ссылка-описание' })}
      ${field('starts_at', 'Начало', { type: 'datetime-local', value: v.starts_at, error: errors.starts_at })}
      ${field('ends_at', 'Окончание', { type: 'datetime-local', value: v.ends_at, error: errors.ends_at })}
      ${field('capacity', 'Лимит участников', { type: 'number', value: v.capacity, error: errors.capacity, attrs: 'min="1" max="100000" inputmode="numeric"', hint: locked ? `Уже занято мест: ${locked} — лимит нельзя сделать меньше` : 'Максимальное число активных регистраций' })}
      ${field('price', 'Стоимость, ₽', { type: 'number', value: v.price, error: errors.price, required: false, attrs: 'min="0" inputmode="numeric"', hint: '0 — бесплатно' })}
      ${isNew || event.status !== 'cancelled' ? field('status', 'Публикация', { as: 'select', value: v.status, options: [['draft', 'Черновик (виден только вам)'], ['published', 'Опубликовать в каталоге']] }) : ''}
    </div>
    <div class="actions"><button class="btn btn--accent btn--lg" type="submit">${isNew ? 'Создать мероприятие' : 'Сохранить изменения'}</button><a class="btn btn--ghost btn--lg" href="/organizer">Отмена</a></div>
  </form>`;
}

const emptyValues = () => {
  const d = new Date(Date.now() + 14 * 864e5);
  d.setHours(18, 0, 0, 0);
  const e = new Date(d.getTime() + 2 * 36e5);
  return { title: '', category_id: '', format: 'offline', summary: '', description: '', city: '', venue: '', starts_at: localIso(d), ends_at: localIso(e), capacity: 50, price: 0, status: 'draft' };
};

const csvCell = (s) => {
  let t = String(s ?? '');
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; // защита от формул в Excel
  return `"${t.replace(/"/g, '""')}"`;
};

export function organizerRoutes(r) {
  // ── Дашборд ────────────────────────────────────────────────────────────────
  r.get('/organizer', (ctx) => {
    const list = organizerEvents(ctx.db, ctx.user);
    const live = list.filter((e) => e.status === 'published' && e.ends_at >= localIso());
    const taken = live.reduce((s, e) => s + e.taken, 0);
    const cap = live.reduce((s, e) => s + e.capacity, 0);
    const body = html`${pageHead('Панель организатора', ctx.user.role === 'admin' ? 'Все мероприятия' : 'Ваши мероприятия', 'Создавайте события, задавайте лимит мест и следите за регистрациями.')}
    <section class="wrap">
      <dl class="stats">
        <div><dt>Всего мероприятий</dt><dd>${list.length}</dd></div>
        <div><dt>Активных сейчас</dt><dd>${live.length}</dd></div>
        <div><dt>Регистраций в активных</dt><dd>${taken}</dd></div>
        <div><dt>Заполненность</dt><dd>${cap ? Math.round((taken / cap) * 100) : 0}%</dd></div>
      </dl>
      <div class="section__head"><h2 class="h3">Мероприятия</h2>
        <div class="actions"><a class="btn btn--accent" href="/organizer/events/new">${icon('plus')} Создать мероприятие</a>${ctx.user.role === 'admin' ? html`<a class="btn btn--ghost" href="/admin">Статистика и сообщения</a>` : ''}</div></div>
      ${list.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>Мероприятие</th><th>Дата</th><th>Статус</th><th>Места</th><th><span class="sr">Действия</span></th></tr></thead>
        <tbody>${list.map((e) => { const st = eventState(e); return html`<tr>
          <td data-label="Мероприятие"><a class="table__title" href="/events/${e.id}">${e.title}</a><span class="muted small">${e.cat_title}${ctx.user.role === 'admin' ? ` · ${e.org_name}` : ''}</span></td>
          <td data-label="Дата">${fmtDateTime(e.starts_at)}</td>
          <td data-label="Статус"><span class="tag tag--${st}">${STATE_LABEL[st]}</span></td>
          <td data-label="Места"><div class="table__seats"><b>${e.taken}/${e.capacity}</b>${seatMeter(e, { compact: true })}<span class="muted small">свободно: ${e.left}</span></div></td>
          <td data-label="" class="table__act"><a class="btn btn--ghost btn--sm" href="/organizer/events/${e.id}/registrations">Участники</a><a class="btn btn--line btn--sm" href="/organizer/events/${e.id}/edit">Изменить</a></td>
        </tr>`; })}</tbody></table></div>`
        : emptyState('Мероприятий пока нет', 'Создайте первое событие — оно появится в каталоге после публикации.', html`<a class="btn btn--accent" href="/organizer/events/new">Создать мероприятие</a>`)}
    </section>`;
    return layout(ctx, { title: 'Панель организатора', noindex: true, active: '/organizer' }, body);
  }, ORG);

  // ── Создание и редактирование ──────────────────────────────────────────────
  r.get('/organizer/events/new', (ctx) => layout(ctx, { title: 'Новое мероприятие', noindex: true, active: '/organizer' },
    html`${pageHead('Создание', 'Новое мероприятие')}<section class="wrap">${eventForm(ctx, { values: emptyValues() })}</section>`), ORG);

  r.post('/organizer/events', (ctx) => {
    const { errors, values } = validateEvent(ctx.db, ctx.body, { isNew: true });
    if (Object.keys(errors).length) {
      return send(ctx, 422, layout(ctx, { title: 'Новое мероприятие', noindex: true, active: '/organizer' },
        html`${pageHead('Создание', 'Новое мероприятие')}<section class="wrap"><div class="flash flash--err" role="alert"><span>Исправьте отмеченные поля — данные не сохранены.</span></div>${eventForm(ctx, { values, errors })}</section>`).toString());
    }
    const id = saveEvent(ctx.db, ctx.user, null, values);
    ctx.setFlash('ok', values.status === 'published' ? 'Мероприятие создано и опубликовано.' : 'Черновик сохранён. Опубликуйте мероприятие, когда будете готовы.');
    return redirect(ctx, `/organizer/events/${id}/registrations`);
  }, ORG);

  r.get('/organizer/events/:id/edit', (ctx) => {
    const e = getManagedEvent(ctx.db, ctx.user, ctx.params.id);
    const values = { ...e, status: e.status === 'cancelled' ? 'draft' : e.status };
    return layout(ctx, { title: `Изменение: ${e.title}`, noindex: true, active: '/organizer' }, html`
      ${pageHead('Редактирование', e.title)}
      <section class="wrap">
        ${eventForm(ctx, { values, event: e })}
        <div class="danger">
          <h2 class="h3">Управление мероприятием</h2>
          <div class="actions">
            ${e.status === 'draft' ? html`<form method="post" action="/organizer/events/${e.id}/status">${csrfField(ctx)}<input type="hidden" name="action" value="publish"><button class="btn btn--accent" type="submit">Опубликовать</button></form>` : ''}
            ${e.status === 'published' ? html`<form method="post" action="/organizer/events/${e.id}/status">${csrfField(ctx)}<input type="hidden" name="action" value="unpublish"><button class="btn btn--line" type="submit">Снять с публикации</button></form>` : ''}
            ${e.status !== 'cancelled' ? html`<form method="post" action="/organizer/events/${e.id}/status" data-confirm="Отменить мероприятие? Оно останется в каталоге с пометкой «Отменено», регистрация закроется.">${csrfField(ctx)}<input type="hidden" name="action" value="cancel"><button class="btn btn--line" type="submit">Отменить мероприятие</button></form>`
              : html`<form method="post" action="/organizer/events/${e.id}/status">${csrfField(ctx)}<input type="hidden" name="action" value="restore"><button class="btn btn--line" type="submit">Вернуть в черновики</button></form>`}
            <form method="post" action="/organizer/events/${e.id}/delete" data-confirm="Удалить мероприятие «${e.title}» навсегда? Это действие нельзя отменить.">${csrfField(ctx)}<button class="btn btn--danger" type="submit">Удалить</button></form>
          </div>
          <p class="muted small">Удалить можно только мероприятие без активных регистраций. Иначе сначала отмените его.</p>
        </div>
      </section>`);
  }, ORG);

  r.post('/organizer/events/:id', (ctx) => {
    const e = getManagedEvent(ctx.db, ctx.user, ctx.params.id);
    const { errors, values } = validateEvent(ctx.db, ctx.body, { isNew: false });
    const fail = (errs, vals) => send(ctx, 422, layout(ctx, { title: `Изменение: ${e.title}`, noindex: true, active: '/organizer' },
      html`${pageHead('Редактирование', e.title)}<section class="wrap"><div class="flash flash--err" role="alert"><span>Исправьте отмеченные поля — изменения не сохранены.</span></div>${eventForm(ctx, { values: vals, errors: errs, event: e })}</section>`).toString());
    if (Object.keys(errors).length) return fail(errors, values);
    try { saveEvent(ctx.db, ctx.user, e.id, values); } catch (err) {
      if (err instanceof HttpError && err.status === 422) return fail({ capacity: err.message }, values);
      throw err;
    }
    ctx.setFlash('ok', 'Изменения сохранены.');
    return redirect(ctx, `/organizer/events/${e.id}/registrations`);
  }, ORG);

  r.post('/organizer/events/:id/status', (ctx) => {
    const e = getManagedEvent(ctx.db, ctx.user, ctx.params.id);
    const act = String(ctx.body.action ?? '');
    const next = { publish: 'published', unpublish: 'draft', cancel: 'cancelled', restore: 'draft' }[act];
    if (!next) throw new HttpError(400, 'Неизвестное действие');
    const allowed = { publish: ['draft'], unpublish: ['published'], cancel: ['draft', 'published'], restore: ['cancelled'] }[act];
    if (!allowed.includes(e.status)) throw new HttpError(409, 'Это действие недоступно для текущего статуса мероприятия');
    if (act === 'unpublish' && e.taken > 0) {
      ctx.setFlash('err', `Нельзя снять с публикации: есть активные регистрации (${e.taken}). Отмените мероприятие или регистрации.`);
      return redirect(ctx, `/organizer/events/${e.id}/edit`);
    }
    ctx.db.run("UPDATE events SET status = ?, updated_at = datetime('now') WHERE id = ?", next, e.id);
    ctx.setFlash('ok', { publish: 'Мероприятие опубликовано.', unpublish: 'Мероприятие снято с публикации.', cancel: 'Мероприятие отменено.', restore: 'Мероприятие возвращено в черновики.' }[act]);
    return redirect(ctx, `/organizer/events/${e.id}/registrations`);
  }, ORG);

  r.post('/organizer/events/:id/delete', (ctx) => {
    const e = getManagedEvent(ctx.db, ctx.user, ctx.params.id);
    if (e.taken > 0) {
      ctx.setFlash('err', `Нельзя удалить: у мероприятия ${e.taken} активных регистраций. Сначала отмените мероприятие.`);
      return redirect(ctx, `/organizer/events/${e.id}/edit`);
    }
    ctx.db.run('DELETE FROM events WHERE id = ?', e.id);
    ctx.setFlash('ok', `Мероприятие «${e.title}» удалено.`);
    return redirect(ctx, '/organizer');
  }, ORG);

  // ── Участники ──────────────────────────────────────────────────────────────
  r.get('/organizer/events/:id/registrations', (ctx) => {
    const e = getManagedEvent(ctx.db, ctx.user, ctx.params.id);
    const regs = eventRegistrations(ctx.db, e.id);
    const active = regs.filter((x) => x.status === 'active');
    const st = eventState(e);
    const back = `/organizer/events/${e.id}/registrations`;
    const body = html`${pageHead('Участники', e.title, `${fmtRange(e.starts_at, e.ends_at)} · ${e.format === 'online' ? 'Онлайн' : `${e.city}, ${e.venue}`}`)}
    <section class="wrap">
      <div class="manage">
        <dl class="stats stats--4">
          <div><dt>Лимит</dt><dd>${e.capacity}</dd></div>
          <div><dt>Занято</dt><dd>${e.taken}</dd></div>
          <div><dt>Свободно</dt><dd>${e.left}</dd></div>
          <div><dt>Статус</dt><dd class="stats__s"><span class="tag tag--${st}">${STATE_LABEL[st]}</span></dd></div>
        </dl>
        ${seatMeter(e)}
        <div class="actions">
          <a class="btn btn--line" href="/organizer/events/${e.id}/edit">Изменить мероприятие</a>
          <a class="btn btn--ghost" href="/events/${e.id}">Страница мероприятия</a>
          ${active.length ? html`<a class="btn btn--ghost" href="/organizer/events/${e.id}/registrations.csv">${icon('download')} Скачать CSV</a>` : ''}
        </div>
      </div>
      <h2 class="h3">Зарегистрированные пользователи <span class="muted">(${active.length})</span></h2>
      ${regs.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>Участник</th><th>E-mail</th><th>Дата записи</th><th>Статус</th><th>Присутствие</th><th><span class="sr">Действия</span></th></tr></thead>
        <tbody>${regs.map((x) => html`<tr class="${x.status === 'cancelled' ? 'is-dim' : ''}">
          <td data-label="Участник"><b>${x.name}</b><span class="muted small">@${x.login}</span></td>
          <td data-label="E-mail">${x.email}</td>
          <td data-label="Дата записи">${x.created_at.slice(0, 16).replace('T', ' ')}</td>
          <td data-label="Статус">${x.status === 'active' ? html`<span class="tag tag--ok">Активна</span>` : html`<span class="tag tag--cancelled">Отменена</span>`}</td>
          <td data-label="Присутствие">${x.status === 'active' ? html`<form method="post" action="/organizer/registrations/${x.id}/attended">${csrfField(ctx)}<input type="hidden" name="attended" value="${x.attended ? 0 : 1}"><input type="hidden" name="back" value="${back}"><button class="btn btn--sm ${x.attended ? 'btn--accent' : 'btn--line'}" type="submit" aria-pressed="${x.attended ? 'true' : 'false'}">${x.attended ? 'Присутствовал' : 'Отметить'}</button></form>` : '—'}</td>
          <td data-label="" class="table__act">${x.status === 'active' ? html`<form method="post" action="/registrations/${x.id}/cancel" data-confirm="Отменить регистрацию участника ${x.name}? Место освободится.">${csrfField(ctx)}<input type="hidden" name="back" value="${back}"><button class="btn btn--line btn--sm" type="submit">Отменить</button></form>` : ''}</td>
        </tr>`)}</tbody></table></div>`
        : emptyState('Регистраций пока нет', st === 'draft' ? 'Опубликуйте мероприятие, чтобы участники могли записаться.' : 'Как только кто-то запишется, он появится в списке.')}
    </section>`;
    return layout(ctx, { title: `Участники: ${e.title}`, noindex: true, active: '/organizer' }, body);
  }, ORG);

  r.get('/organizer/events/:id/registrations.csv', (ctx) => {
    const e = getManagedEvent(ctx.db, ctx.user, ctx.params.id);
    const rows = eventRegistrations(ctx.db, e.id).filter((x) => x.status === 'active');
    const csv = '﻿' + ['№;Имя;E-mail;Логин;Дата регистрации;Присутствие',
      ...rows.map((x, i) => [i + 1, csvCell(x.name), csvCell(x.email), csvCell(x.login), x.created_at, x.attended ? 'да' : 'нет'].join(';'))].join('\r\n');
    return { body: csv, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="participants-${e.id}.csv"`, 'Cache-Control': 'no-store' } };
  }, ORG);

  r.post('/organizer/registrations/:id/attended', (ctx) => {
    setAttendance(ctx.db, ctx.user, ctx.params.id, ctx.body.attended === '1');
    return redirect(ctx, safeLocal(ctx.body.back) || '/organizer');
  }, ORG);

  // ── Администратор: статистика обращений, сообщения, пользователи ─────────────
  r.get('/admin', (ctx) => {
    const s = accessStats(ctx.db);
    const msgs = ctx.db.all('SELECT * FROM messages ORDER BY id DESC LIMIT 10');
    const users = ctx.db.all("SELECT id, login, name, role, created_at, (SELECT count(*) FROM registrations r WHERE r.user_id = users.id AND r.status = 'active') AS regs FROM users ORDER BY id DESC LIMIT 15");
    const total = ctx.db.get('SELECT count(*) AS n FROM users').n;
    const body = html`${pageHead('Администрирование', 'Статистика платформы')}
    <section class="wrap">
      <dl class="stats">
        <div><dt>Обращений к сайту</dt><dd>${s.total}</dd></div>
        <div><dt>Ошибочных ответов (4xx/5xx)</dt><dd>${s.errors}</dd></div>
        <div><dt>Доля ошибок</dt><dd>${s.share.toFixed(1)}%</dd></div>
        <div><dt>Медиана длительности</dt><dd>${s.median.toFixed(1)} мс</dd></div>
      </dl>
      <div class="cols cols--wide">
        <div><h2 class="h3">Самые частые маршруты</h2>
          <div class="table-wrap"><table class="table"><thead><tr><th>Маршрут</th><th>Запросов</th></tr></thead>
          <tbody>${s.top.map((x) => html`<tr><td data-label="Маршрут"><code>${x.route}</code></td><td data-label="Запросов">${x.n}</td></tr>`)}</tbody></table></div></div>
        <div><h2 class="h3">Сообщения из формы контактов</h2>
          ${msgs.length ? html`<ul class="msgs">${msgs.map((m) => html`<li><b>${m.name}</b> <span class="muted small">${m.email} · ${m.created_at.slice(0, 16)}</span><p>${m.text}</p></li>`)}</ul>` : html`<p class="muted">Сообщений пока нет.</p>`}</div>
      </div>
      <h2 class="h3 mt">Пользователи <span class="muted">(последние 15 из ${total})</span></h2>
      <div class="table-wrap"><table class="table"><thead><tr><th>Логин</th><th>Имя</th><th>Роль</th><th>Регистраций</th><th>Создан</th></tr></thead>
      <tbody>${users.map((u) => html`<tr><td data-label="Логин">${u.login}</td><td data-label="Имя">${u.name}</td><td data-label="Роль"><span class="tag">${{ user: 'участник', organizer: 'организатор', admin: 'админ' }[u.role]}</span></td><td data-label="Регистраций">${u.regs}</td><td data-label="Создан">${u.created_at.slice(0, 10)}</td></tr>`)}</tbody></table></div>
    </section>`;
    return layout(ctx, { title: 'Администрирование', noindex: true, active: '/organizer' }, body);
  }, { roles: ['admin'] });
}
