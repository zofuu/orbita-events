// Предметная логика: мероприятия, регистрации, лимит участников, каталог, проверка данных.
// Все проверки выполняются на сервере; ограничения лимита и дублей дополнительно защищены БД.
import { HttpError } from './http.js';

// ── Время ───────────────────────────────────────────────────────────────────
const p2 = (n) => String(n).padStart(2, '0');
export function localIso(d = new Date()) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MON_SHORT = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const parts = (iso) => ({ y: +iso.slice(0, 4), m: +iso.slice(5, 7) - 1, d: +iso.slice(8, 10), t: iso.slice(11, 16) });
export const fmtDate = (iso) => { const x = parts(iso); return `${x.d} ${MONTHS[x.m]} ${x.y}`; };
export const fmtDateTime = (iso) => `${fmtDate(iso)}, ${iso.slice(11, 16)}`;
export const fmtDay = (iso) => parts(iso).d;
export const fmtMon = (iso) => MON_SHORT[parts(iso).m];
export const fmtWeekday = (iso) => { const x = parts(iso); return WEEKDAYS[new Date(x.y, x.m, x.d).getDay()]; };
export const fmtRange = (a, b) => (a.slice(0, 10) === b.slice(0, 10)
  ? `${fmtDate(a)}, ${a.slice(11, 16)}–${b.slice(11, 16)}`
  : `${fmtDateTime(a)} — ${fmtDateTime(b)}`);
export const fmtPrice = (n) => (n === 0 ? 'Бесплатно' : `${n.toLocaleString('ru-RU')} ₽`);

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  return b === 1 ? one : many;
}

// ── Запросы ─────────────────────────────────────────────────────────────────
const EVENT_SELECT = `
  SELECT e.*, c.title AS cat_title, c.slug AS cat_slug, u.name AS org_name,
         (SELECT count(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'active') AS taken
    FROM events e
    JOIN categories c ON c.id = e.category_id
    JOIN users u ON u.id = e.organizer_id`;

export const withSeats = (e) => (e ? { ...e, left: Math.max(0, e.capacity - e.taken) } : e);

export function getEvent(db, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return null;
  return withSeats(db.get(`${EVENT_SELECT} WHERE e.id = ?`, n));
}

export function getCategories(db) {
  return db.all(`SELECT c.*, (SELECT count(*) FROM events e WHERE e.category_id = c.id AND e.status = 'published' AND e.ends_at >= ?) AS upcoming
                   FROM categories c ORDER BY c.sort`, localIso());
}

export const SORTS = {
  date: ['Сначала ближайшие', 'e.starts_at ASC, e.id ASC'],
  date_desc: ['Сначала дальние', 'e.starts_at DESC, e.id DESC'],
  popular: ['По популярности', 'taken DESC, e.starts_at ASC'],
  price: ['Дешевле', 'e.price ASC, e.starts_at ASC'],
  seats: ['Больше свободных мест', '(e.capacity - taken) DESC, e.starts_at ASC'],
};

// Каталог: поиск по названию, категория, период, сортировка, постраничный вывод
export function searchEvents(db, f, pageSize) {
  const where = ["e.status = 'published'"];
  const args = [];
  const now = localIso();
  const when = ['upcoming', 'past', 'all'].includes(f.when) ? f.when : 'upcoming';
  if (when === 'upcoming') { where.push('e.ends_at >= ?'); args.push(now); }
  if (when === 'past') { where.push('e.ends_at < ?'); args.push(now); }
  if (f.q) { where.push("instr(lower_ru(e.title), ?) > 0"); args.push(f.q.toLowerCase()); }
  if (f.category) { where.push('c.slug = ?'); args.push(f.category); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.from ?? '')) { where.push('e.starts_at >= ?'); args.push(f.from + 'T00:00'); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.to ?? '')) { where.push('e.starts_at <= ?'); args.push(f.to + 'T23:59'); }
  if (f.free === '1') { where.push('e.price = 0'); }
  const havingSeats = f.seats === '1' ? ' WHERE (capacity - taken) > 0' : '';
  const order = (SORTS[f.sort] ?? SORTS.date)[1];
  const base = `SELECT * FROM (${EVENT_SELECT} WHERE ${where.join(' AND ')})${havingSeats}`;
  // Подсчёт и выборка выполняются по одному набору условий
  const total = db.get(`SELECT count(*) AS n FROM (${base})`, ...args).n;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Number(f.page) || 1), pages);
  const orderOuter = order.replace(/\be\./g, '').replace('(capacity - taken)', '(capacity - taken)');
  const items = db.all(`${base} ORDER BY ${orderOuter} LIMIT ? OFFSET ?`, ...args, pageSize, (page - 1) * pageSize).map(withSeats);
  return { items, total, pages, page, when };
}

export function upcomingEvents(db, limit, category = null) {
  const args = [localIso()];
  let cat = '';
  if (category) { cat = ' AND c.slug = ?'; args.push(category); }
  return db.all(`${EVENT_SELECT} WHERE e.status = 'published' AND e.ends_at >= ?${cat} ORDER BY e.starts_at ASC LIMIT ?`, ...args, limit).map(withSeats);
}

export function siteCounters(db) {
  return db.get(`SELECT
     (SELECT count(*) FROM events WHERE status = 'published' AND ends_at >= ?) AS events,
     (SELECT count(DISTINCT city) FROM events WHERE status = 'published' AND format = 'offline') AS cities,
     (SELECT count(*) FROM registrations WHERE status = 'active') AS regs,
     (SELECT count(*) FROM users WHERE role = 'organizer') AS organizers`, localIso());
}

// ── Состояние мероприятия для интерфейса ─────────────────────────────────────
export function eventState(e) {
  if (e.status === 'cancelled') return 'cancelled';
  if (e.status === 'draft') return 'draft';
  if (e.ends_at < localIso()) return 'past';
  if (e.starts_at <= localIso()) return 'started';
  return e.left <= 0 ? 'full' : 'open';
}

export const STATE_LABEL = {
  cancelled: 'Отменено', draft: 'Черновик', past: 'Завершено', started: 'Идёт сейчас', full: 'Мест нет', open: 'Идёт набор',
};

// ── Регистрации ─────────────────────────────────────────────────────────────
export function getUserRegistration(db, userId, eventId) {
  return db.get("SELECT * FROM registrations WHERE user_id = ? AND event_id = ? AND status = 'active'", userId, eventId) ?? null;
}

// Запись на мероприятие. Транзакция BEGIN IMMEDIATE исключает гонку между запросами,
// а триггер EVENT_FULL и частичный UNIQUE-индекс не дают нарушить правило даже при обходе кода.
export function registerForEvent(db, user, eventId) {
  const ev = getEvent(db, eventId);
  if (!ev) throw new HttpError(404, 'Мероприятие не найдено');
  const state = eventState(ev);
  if (state === 'cancelled') throw new HttpError(409, 'Мероприятие отменено организатором');
  if (state === 'draft') throw new HttpError(404, 'Мероприятие не найдено');
  if (state === 'past' || state === 'started') throw new HttpError(409, 'Регистрация закрыта: мероприятие уже началось');
  try {
    return db.tx(() => {
      const r = db.run("INSERT INTO registrations(event_id, user_id, status) VALUES (?,?, 'active')", ev.id, user.id);
      const taken = db.get("SELECT count(*) AS n FROM registrations WHERE event_id = ? AND status = 'active'", ev.id).n;
      return { id: Number(r.lastInsertRowid), event: ev, left: ev.capacity - taken };
    });
  } catch (e) {
    const msg = String(e.message);
    if (msg.includes('EVENT_FULL')) throw new HttpError(409, 'Свободных мест не осталось: лимит участников достигнут');
    if (msg.includes('EVENT_CLOSED')) throw new HttpError(409, 'Регистрация на это мероприятие недоступна');
    if (msg.includes('UNIQUE constraint failed')) throw new HttpError(409, 'Вы уже зарегистрированы на это мероприятие');
    throw e;
  }
}

// Отмена: владелец регистрации (до начала события), организатор своего события или администратор.
export function cancelRegistration(db, actor, regId) {
  const reg = db.get(`SELECT r.*, e.organizer_id, e.starts_at, e.title FROM registrations r JOIN events e ON e.id = r.event_id WHERE r.id = ?`, Number(regId) || 0);
  if (!reg) throw new HttpError(404, 'Регистрация не найдена');
  const own = reg.user_id === actor.id;
  const manager = actor.role === 'admin' || reg.organizer_id === actor.id;
  if (!own && !manager) throw new HttpError(403, 'Это не ваша регистрация');
  if (reg.status !== 'active') throw new HttpError(409, 'Регистрация уже отменена');
  if (own && !manager && reg.starts_at <= localIso()) throw new HttpError(409, 'Мероприятие уже началось: отмена невозможна');
  db.run("UPDATE registrations SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?", reg.id);
  return reg;
}

export function setAttendance(db, actor, regId, attended) {
  const reg = db.get('SELECT r.*, e.organizer_id FROM registrations r JOIN events e ON e.id = r.event_id WHERE r.id = ?', Number(regId) || 0);
  if (!reg) throw new HttpError(404, 'Регистрация не найдена');
  if (actor.role !== 'admin' && reg.organizer_id !== actor.id) throw new HttpError(403, 'Отмечать посещение может только организатор мероприятия');
  if (reg.status !== 'active') throw new HttpError(409, 'Регистрация отменена');
  db.run('UPDATE registrations SET attended = ? WHERE id = ?', attended ? 1 : 0, reg.id);
  return reg;
}

export function userRegistrations(db, userId, tab) {
  const now = localIso();
  const base = `SELECT r.id AS reg_id, r.status AS reg_status, r.attended, r.created_at AS reg_at, r.cancelled_at,
                       e.id, e.title, e.summary, e.starts_at, e.ends_at, e.city, e.venue, e.format, e.price, e.status AS event_status,
                       e.capacity, c.slug AS cat_slug, c.title AS cat_title
                  FROM registrations r JOIN events e ON e.id = r.event_id JOIN categories c ON c.id = e.category_id
                 WHERE r.user_id = ?`;
  if (tab === 'history') return db.all(`${base} AND r.status = 'active' AND e.ends_at < ? ORDER BY e.starts_at DESC`, userId, now);
  if (tab === 'cancelled') return db.all(`${base} AND r.status = 'cancelled' ORDER BY r.cancelled_at DESC`, userId);
  return db.all(`${base} AND r.status = 'active' AND e.ends_at >= ? ORDER BY e.starts_at ASC`, userId, now);
}

export function userStats(db, userId) {
  const now = localIso();
  return db.get(`SELECT
      (SELECT count(*) FROM registrations r JOIN events e ON e.id = r.event_id WHERE r.user_id = ?1 AND r.status = 'active' AND e.ends_at >= ?2) AS upcoming,
      (SELECT count(*) FROM registrations r JOIN events e ON e.id = r.event_id WHERE r.user_id = ?1 AND r.status = 'active' AND e.ends_at < ?2 AND r.attended = 1) AS visited,
      (SELECT count(*) FROM registrations WHERE user_id = ?1 AND status = 'cancelled') AS cancelled`, userId, now);
}

export function eventRegistrations(db, eventId) {
  return db.all(`SELECT r.id, r.status, r.attended, r.created_at, r.cancelled_at, u.name, u.email, u.login
                   FROM registrations r JOIN users u ON u.id = r.user_id
                  WHERE r.event_id = ? ORDER BY (r.status = 'active') DESC, r.created_at ASC, r.id ASC`, eventId);
}

// ── Мероприятия организатора ────────────────────────────────────────────────
export function organizerEvents(db, user) {
  const scope = user.role === 'admin' ? '' : 'WHERE e.organizer_id = ?';
  const args = user.role === 'admin' ? [] : [user.id];
  return db.all(`${EVENT_SELECT} ${scope} ORDER BY e.starts_at DESC`, ...args).map(withSeats);
}

export function canManage(user, event) {
  return Boolean(user && (user.role === 'admin' || (user.role === 'organizer' && event.organizer_id === user.id)));
}

export function getManagedEvent(db, user, id) {
  const ev = getEvent(db, id);
  if (!ev) throw new HttpError(404, 'Мероприятие не найдено');
  if (!canManage(user, ev)) throw new HttpError(403, 'Вы не являетесь организатором этого мероприятия');
  return ev;
}

// Проверка данных формы мероприятия: возвращает { errors, values }
export function validateEvent(db, input, { isNew }) {
  const errors = {};
  const s = (k) => String(input[k] ?? '').trim();
  const v = {
    title: s('title'), summary: s('summary'), description: s('description'), city: s('city'), venue: s('venue'),
    category_id: Number(input.category_id), format: s('format'), starts_at: s('starts_at'), ends_at: s('ends_at'),
    capacity: Number(input.capacity), price: s('price') === '' ? 0 : Number(input.price),
    status: s('status') || 'draft',
  };
  if (v.title.length < 3 || v.title.length > 120) errors.title = 'Название — от 3 до 120 символов';
  if (v.summary.length < 10 || v.summary.length > 200) errors.summary = 'Краткое описание — от 10 до 200 символов';
  if (v.description.length > 4000) errors.description = 'Описание — не более 4000 символов';
  if (v.city.length < 2 || v.city.length > 60) errors.city = 'Город — от 2 до 60 символов';
  if (v.venue.length < 2 || v.venue.length > 120) errors.venue = 'Место — от 2 до 120 символов';
  if (!db.get('SELECT 1 AS x FROM categories WHERE id = ?', v.category_id || 0)) errors.category_id = 'Выберите категорию из списка';
  if (!['offline', 'online'].includes(v.format)) errors.format = 'Выберите формат';
  const dt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  if (!dt.test(v.starts_at) || Number.isNaN(Date.parse(v.starts_at))) errors.starts_at = 'Укажите дату и время начала';
  else if (isNew && v.starts_at <= localIso()) errors.starts_at = 'Начало должно быть в будущем';
  if (!dt.test(v.ends_at) || Number.isNaN(Date.parse(v.ends_at))) errors.ends_at = 'Укажите дату и время окончания';
  else if (!errors.starts_at && v.ends_at <= v.starts_at) errors.ends_at = 'Окончание должно быть позже начала';
  if (!Number.isInteger(v.capacity) || v.capacity < 1 || v.capacity > 100000) errors.capacity = 'Лимит участников — целое число от 1 до 100 000';
  if (!Number.isInteger(v.price) || v.price < 0 || v.price > 1000000) errors.price = 'Стоимость — целое число от 0 до 1 000 000 ₽';
  if (!['draft', 'published'].includes(v.status)) v.status = 'draft';
  return { errors, values: v };
}

export function saveEvent(db, user, id, v) {
  try {
    if (id) {
      db.run(`UPDATE events SET title=?, category_id=?, summary=?, description=?, format=?, city=?, venue=?, starts_at=?, ends_at=?,
                capacity=?, price=?, status=CASE WHEN status='cancelled' THEN status ELSE ? END, updated_at=datetime('now') WHERE id=?`,
        v.title, v.category_id, v.summary, v.description, v.format, v.city, v.venue, v.starts_at, v.ends_at, v.capacity, v.price, v.status, id);
      return id;
    }
    const r = db.run(`INSERT INTO events(title, category_id, organizer_id, summary, description, format, city, venue, starts_at, ends_at, capacity, price, status)
                      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      v.title, v.category_id, user.id, v.summary, v.description, v.format, v.city, v.venue, v.starts_at, v.ends_at, v.capacity, v.price, v.status);
    return Number(r.lastInsertRowid);
  } catch (e) {
    if (String(e.message).includes('CAPACITY_BELOW_ACTIVE')) {
      const n = db.get("SELECT count(*) AS n FROM registrations WHERE event_id = ? AND status = 'active'", id).n;
      throw new HttpError(422, `Лимит нельзя сделать меньше числа активных регистраций (${n})`, { field: 'capacity' });
    }
    throw e;
  }
}

// ── Данные пользователя ─────────────────────────────────────────────────────
export const LOGIN_RE = /^[A-Za-z0-9_.-]{3,32}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateRegistration(db, input) {
  const errors = {};
  const v = {
    name: String(input.name ?? '').trim(), login: String(input.login ?? '').trim(), email: String(input.email ?? '').trim(),
    password: String(input.password ?? ''), role: input.role === 'organizer' ? 'organizer' : 'user',
  };
  if (v.name.length < 2 || v.name.length > 80) errors.name = 'Имя — от 2 до 80 символов';
  if (!LOGIN_RE.test(v.login)) errors.login = 'Логин — 3–32 символа: латиница, цифры, _ . -';
  else if (db.get('SELECT 1 AS x FROM users WHERE login = ?', v.login)) errors.login = 'Такой логин уже занят';
  if (!EMAIL_RE.test(v.email)) errors.email = 'Введите корректный e-mail';
  else if (db.get('SELECT 1 AS x FROM users WHERE email = ?', v.email)) errors.email = 'Этот e-mail уже используется';
  if (v.password.length < 8 || !/[A-Za-zА-Яа-я]/.test(v.password) || !/\d/.test(v.password)) errors.password = 'Пароль — не менее 8 символов, буквы и цифры';
  return { errors, values: v };
}

// ── Статистика обращений (журнал access_log) ─────────────────────────────────
export function accessStats(db) {
  const rows = db.all('SELECT status, ms FROM access_log');
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
  const errors = rows.filter((r) => r.status >= 400).length;
  const mid = ms.length >> 1;
  const med = ms.length ? (ms.length % 2 ? ms[mid] : (ms[mid - 1] + ms[mid]) / 2) : 0;
  const top = db.all('SELECT route, count(*) AS n FROM access_log GROUP BY route ORDER BY n DESC LIMIT 8');
  return { total: rows.length, errors, share: rows.length ? (errors / rows.length) * 100 : 0, median: med, top };
}
