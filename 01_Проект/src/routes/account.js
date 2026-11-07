// Личный кабинет, мои регистрации, запись на мероприятие и отмена.
import { html } from '../html.js';
import { HttpError, redirect, send, safeLocal } from '../http.js';
import {
  registerForEvent, cancelRegistration, userRegistrations, userStats, fmtRange, fmtDay, fmtMon, fmtPrice, plural, EMAIL_RE, localIso,
} from '../rules.js';
import { layout, pageHead, field, csrfField, emptyState, icon } from '../ui.js';

const TABS = [['upcoming', 'Предстоящие'], ['history', 'История посещений'], ['cancelled', 'Отменённые']];

function regRow(ctx, x, tab) {
  const cancellable = tab === 'upcoming' && x.starts_at > localIso();
  return html`<article class="reg-row${tab !== 'upcoming' ? ' reg-row--dim' : ''}">
    <div class="reg-row__date"><b>${fmtDay(x.starts_at)}</b><span>${fmtMon(x.starts_at)}</span></div>
    <div class="reg-row__main">
      <p class="eyebrow"><a href="/categories/${x.cat_slug}">${x.cat_title}</a> · ${x.format === 'online' ? 'Онлайн' : x.city}</p>
      <h3 class="reg-row__t"><a href="/events/${x.id}">${x.title}</a></h3>
      <p class="muted">${fmtRange(x.starts_at, x.ends_at)} · ${x.format === 'online' ? 'Онлайн' : x.venue} · ${fmtPrice(x.price)}</p>
      ${tab === 'history' ? html`<p>${x.attended ? html`<span class="tag tag--ok">Посещено</span>` : html`<span class="tag tag--past">Присутствие не отмечено</span>`}</p>` : ''}
      ${tab === 'cancelled' ? html`<p><span class="tag tag--cancelled">Регистрация отменена</span> ${x.event_status === 'cancelled' ? html`<span class="tag tag--cancelled">Мероприятие отменено</span>` : ''}</p>` : ''}
      ${tab === 'upcoming' && x.event_status === 'cancelled' ? html`<p><span class="tag tag--cancelled">Мероприятие отменено организатором</span></p>` : ''}
    </div>
    <div class="reg-row__act">
      <a class="btn btn--ghost btn--sm" href="/events/${x.id}">Подробнее</a>
      ${cancellable ? html`<form method="post" action="/registrations/${x.reg_id}/cancel" data-confirm="Отменить регистрацию на «${x.title}»? Место будет освобождено.">${csrfField(ctx)}<button class="btn btn--line btn--sm" type="submit">Отменить</button></form>` : ''}
    </div>
  </article>`;
}

export function accountRoutes(r) {
  r.get('/account', (ctx) => {
    const u = ctx.user;
    const st = userStats(ctx.db, u.id);
    const next = userRegistrations(ctx.db, u.id, 'upcoming').slice(0, 3);
    const roleLabel = { user: 'Участник', organizer: 'Организатор', admin: 'Администратор' }[u.role];
    const body = html`${pageHead('Личный кабинет', u.name, `${roleLabel} · ${u.email}`)}
    <section class="wrap">
      <dl class="stats stats--3">
        <div><dt>Предстоящие</dt><dd>${st.upcoming}</dd></div>
        <div><dt>Посещено</dt><dd>${st.visited}</dd></div>
        <div><dt>Отменено</dt><dd>${st.cancelled}</dd></div>
      </dl>
      <div class="cols cols--wide">
        <div>
          <div class="section__head"><h2 class="h3">Ближайшие мероприятия</h2><a class="link-arrow" href="/account/registrations">Все регистрации ${icon('arrow')}</a></div>
          ${next.length ? html`<div class="reg-list">${next.map((x) => regRow(ctx, x, 'upcoming'))}</div>`
            : emptyState('Пока нет регистраций', 'Выберите мероприятие в каталоге и займите место.', html`<a class="btn btn--accent" href="/events">Открыть каталог</a>`)}
        </div>
        <form class="panel" method="post" action="/account/profile" novalidate>
          <h2 class="h3">Профиль</h2>
          ${csrfField(ctx)}
          ${field('name', 'Имя и фамилия', { value: u.name })}
          ${field('email', 'E-mail', { type: 'email', value: u.email })}
          <p class="muted small">Логин: <b>${u.login}</b> (изменить нельзя)</p>
          <button class="btn btn--accent" type="submit">Сохранить</button>
        </form>
      </div>
    </section>`;
    return layout(ctx, { title: 'Личный кабинет', noindex: true, active: '/account' }, body);
  }, { auth: true });

  r.post('/account/profile', (ctx) => {
    const name = String(ctx.body.name ?? '').trim();
    const email = String(ctx.body.email ?? '').trim();
    if (name.length < 2 || name.length > 80 || !EMAIL_RE.test(email)) {
      ctx.setFlash('err', 'Проверьте данные: имя — от 2 до 80 символов, e-mail — корректный адрес.');
      return redirect(ctx, '/account');
    }
    try {
      ctx.db.run('UPDATE users SET name = ?, email = ? WHERE id = ?', name, email, ctx.user.id);
      ctx.setFlash('ok', 'Профиль сохранён.');
    } catch (e) {
      if (!String(e.message).includes('UNIQUE')) throw e;
      ctx.setFlash('err', 'Этот e-mail уже используется другим пользователем.');
    }
    return redirect(ctx, '/account');
  }, { auth: true });

  r.get('/account/registrations', (ctx) => {
    const tab = TABS.some(([k]) => k === ctx.query.tab) ? ctx.query.tab : 'upcoming';
    const counts = Object.fromEntries(TABS.map(([k]) => [k, userRegistrations(ctx.db, ctx.user.id, k).length]));
    const list = userRegistrations(ctx.db, ctx.user.id, tab);
    const empty = {
      upcoming: ['Нет предстоящих регистраций', 'Найдите мероприятие и зарегистрируйтесь.'],
      history: ['История пуста', 'Здесь появятся мероприятия, которые уже прошли.'],
      cancelled: ['Отменённых регистраций нет', 'Отменённые вами регистрации будут показаны здесь.'],
    }[tab];
    const body = html`${pageHead('Мои регистрации', 'Ваши мероприятия')}
    <section class="wrap">
      <nav class="tabs" aria-label="Разделы регистраций">
        ${TABS.map(([k, t]) => html`<a href="/account/registrations?tab=${k}"${k === tab ? html` aria-current="page"` : ''}>${t} <span>${counts[k]}</span></a>`)}
      </nav>
      ${list.length ? html`<div class="reg-list">${list.map((x) => regRow(ctx, x, tab))}</div>`
        : emptyState(empty[0], empty[1], html`<a class="btn btn--accent" href="/events">Открыть каталог</a>`)}
    </section>`;
    return layout(ctx, { title: 'Мои регистрации', noindex: true, active: '/account/registrations' }, body);
  }, { auth: true });

  // Запись на мероприятие (правило темы: лимит и повторная запись проверяются сервером и БД)
  r.post('/events/:id/register', (ctx) => {
    const back = `/events/${Number(ctx.params.id) || 0}`;
    try {
      const res = registerForEvent(ctx.db, ctx.user, ctx.params.id);
      ctx.setFlash('ok', `Вы зарегистрированы на «${res.event.title}». Свободных мест осталось: ${res.left}.`);
    } catch (e) {
      if (!(e instanceof HttpError) || e.status === 404 || e.status >= 500) throw e;
      ctx.setFlash('err', e.message);
    }
    return redirect(ctx, back);
  }, { auth: true });

  r.post('/registrations/:id/cancel', (ctx) => {
    const reg = cancelRegistration(ctx.db, ctx.user, ctx.params.id);
    ctx.setFlash('ok', `Регистрация на «${reg.title}» отменена. Место освобождено.`);
    return redirect(ctx, safeLocal(ctx.body.back) || '/account/registrations');
  }, { auth: true });
}
