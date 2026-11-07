// Вход, регистрация и выход.
import { html } from '../html.js';
import { HttpError, redirect, send, safeLocal as safeNext } from '../http.js';
import { hashPassword, verifyPassword, DUMMY_HASH, loginLimiter } from '../auth.js';
import { validateRegistration } from '../rules.js';
import { layout, field, csrfField } from '../ui.js';

function authShell(ctx, { eyebrow, title, lead, form, aside, opts }) {
  return layout(ctx, { noindex: true, active: opts.active, title: opts.title }, html`
    <section class="auth"><div class="wrap auth__grid">
      <div class="auth__intro">
        <p class="eyebrow">${eyebrow}</p>
        <h1 class="display display--md">${title}</h1>
        <p class="lead">${lead}</p>
        ${aside}
      </div>
      <div class="panel auth__panel">${form}</div>
    </div></section>`);
}

function loginPage(ctx, { values = {}, error, next }) {
  const form = html`
    <form method="post" action="/login" novalidate>
      ${csrfField(ctx)}
      <input type="hidden" name="next" value="${next ?? ''}">
      ${error ? html`<div class="flash flash--err" role="alert"><span>${error}</span></div>` : ''}
      ${field('login', 'Логин', { value: values.login ?? '', attrs: 'autocomplete="username" autocapitalize="none" spellcheck="false"' })}
      ${field('password', 'Пароль', { type: 'password', attrs: 'autocomplete="current-password"' })}
      <button class="btn btn--accent btn--lg btn--block" type="submit">Войти</button>
      <p class="muted center">Нет аккаунта? <a href="/register">Зарегистрируйтесь</a></p>
    </form>`;
  return authShell(ctx, {
    eyebrow: 'Вход', title: html`С возвращением`, lead: 'Войдите, чтобы записываться на мероприятия, отменять регистрации и управлять событиями.',
    form, opts: { title: 'Вход', active: '/login' },
    aside: html`<ul class="ticks"><li>Личный кабинет и история посещений</li><li>Регистрация в один клик</li><li>Панель организатора для своих событий</li></ul>`,
  });
}

function registerPage(ctx, { values = {}, errors = {} }) {
  const form = html`
    <form method="post" action="/register" novalidate>
      ${csrfField(ctx)}
      ${field('name', 'Имя и фамилия', { value: values.name ?? '', error: errors.name, attrs: 'autocomplete="name"' })}
      ${field('login', 'Логин', { value: values.login ?? '', error: errors.login, hint: 'Латиница, цифры, _ . -', attrs: 'autocomplete="username" autocapitalize="none" spellcheck="false"' })}
      ${field('email', 'E-mail', { type: 'email', value: values.email ?? '', error: errors.email, attrs: 'autocomplete="email"' })}
      ${field('password', 'Пароль', { type: 'password', error: errors.password, hint: 'От 8 символов, буквы и цифры', attrs: 'autocomplete="new-password"' })}
      <fieldset class="roles">
        <legend>Кто вы?</legend>
        <label class="radio"><input type="radio" name="role" value="user"${values.role !== 'organizer' ? ' checked' : ''}><span><b>Участник</b>Ищу события и регистрируюсь</span></label>
        <label class="radio"><input type="radio" name="role" value="organizer"${values.role === 'organizer' ? ' checked' : ''}><span><b>Организатор</b>Создаю мероприятия и принимаю заявки</span></label>
      </fieldset>
      <button class="btn btn--accent btn--lg btn--block" type="submit">Создать аккаунт</button>
      <p class="muted center">Уже есть аккаунт? <a href="/login">Войти</a></p>
    </form>`;
  return authShell(ctx, {
    eyebrow: 'Регистрация', title: html`Присоединяйтесь<br>к орбите`, lead: 'Один аккаунт для участия и организации мероприятий. Пароль хранится только в виде хеша.',
    form, opts: { title: 'Регистрация', active: '/register' },
    aside: html`<ul class="ticks"><li>Роль участника или организатора</li><li>Лимит мест соблюдается всегда</li><li>Отмена регистрации освобождает место</li></ul>`,
  });
}

export function authRoutes(r) {
  r.get('/login', (ctx) => {
    if (ctx.user) return redirect(ctx, '/account');
    return loginPage(ctx, { next: safeNext(ctx.query.next) });
  });

  r.post('/login', (ctx) => {
    const login = String(ctx.body.login ?? '').trim();
    const next = safeNext(ctx.body.next);
    const key = `${login.toLowerCase()}|${ctx.req.socket.remoteAddress}`;
    if (loginLimiter.isLocked(key)) throw new HttpError(429, 'Слишком много неудачных попыток. Повторите вход через 10 минут.');
    const u = login ? ctx.db.get('SELECT * FROM users WHERE login = ?', login) : null;
    // Проверка хеша выполняется всегда: по времени ответа нельзя понять, существует ли логин
    const ok = verifyPassword(ctx.body.password ?? '', u?.password_hash ?? DUMMY_HASH) && u;
    if (!ok) {
      loginLimiter.fail(key);
      ctx.res.statusCode = 401;
      return send(ctx, 401, loginPage(ctx, { values: { login }, error: 'Неверный логин или пароль', next }).toString());
    }
    loginLimiter.reset(key);
    ctx.login({ id: u.id, login: u.login, name: u.name, email: u.email, role: u.role });
    ctx.setFlash('ok', `Добро пожаловать, ${u.name.split(' ')[0]}!`);
    return redirect(ctx, next || (u.role === 'user' ? '/account' : '/organizer'));
  });

  r.get('/register', (ctx) => (ctx.user ? redirect(ctx, '/account') : registerPage(ctx, {})));

  r.post('/register', (ctx) => {
    const { errors, values } = validateRegistration(ctx.db, ctx.body);
    if (Object.keys(errors).length) {
      return send(ctx, 422, registerPage(ctx, { values, errors }).toString());
    }
    let id;
    try {
      id = Number(ctx.db.run('INSERT INTO users(login, name, email, password_hash, role) VALUES (?,?,?,?,?)',
        values.login, values.name, values.email, hashPassword(values.password), values.role).lastInsertRowid);
    } catch (e) {
      // Гонка двух одинаковых регистраций: уникальность проверяет СУБД
      if (String(e.message).includes('UNIQUE')) return send(ctx, 422, registerPage(ctx, { values, errors: { login: 'Логин или e-mail уже используется' } }).toString());
      throw e;
    }
    ctx.login({ id, login: values.login, name: values.name, email: values.email, role: values.role });
    ctx.setFlash('ok', 'Аккаунт создан. Добро пожаловать на платформу!');
    return redirect(ctx, values.role === 'organizer' ? '/organizer' : '/events');
  });

  r.post('/logout', (ctx) => {
    ctx.logout();
    ctx.ensureSession();
    ctx.setFlash('info', 'Вы вышли из аккаунта.');
    return redirect(ctx, '/');
  });
}
