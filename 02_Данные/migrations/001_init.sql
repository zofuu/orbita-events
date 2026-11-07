-- ОРБИТА · мероприятия. Схема БД (SQLite). Автор: Сидоров Е.Д., 4ИСИП-723.
-- Предметное правило темы №6: число активных регистраций не превышает лимит участников.
-- Правило защищено на трёх уровнях: транзакция сервера, триггеры и частичный UNIQUE-индекс.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  login         TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(login) BETWEEN 3 AND 32),
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  email         TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (email LIKE '_%@_%._%'),
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('user', 'organizer', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  csrf       TEXT NOT NULL,
  flash      TEXT,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  organizer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  summary      TEXT NOT NULL CHECK (length(summary) BETWEEN 10 AND 200),
  description  TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  format       TEXT NOT NULL DEFAULT 'offline' CHECK (format IN ('offline', 'online')),
  city         TEXT NOT NULL CHECK (length(city) BETWEEN 2 AND 60),
  venue        TEXT NOT NULL CHECK (length(venue) BETWEEN 2 AND 120),
  starts_at    TEXT NOT NULL CHECK (starts_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]'),
  ends_at      TEXT NOT NULL CHECK (ends_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]' AND ends_at > starts_at),
  capacity     INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 100000),
  price        INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE registrations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  attended     INTEGER NOT NULL DEFAULT 0 CHECK (attended IN (0, 1)),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  cancelled_at TEXT
);

-- Один пользователь — одна АКТИВНАЯ регистрация на мероприятие (после отмены можно записаться снова).
CREATE UNIQUE INDEX ux_registrations_active ON registrations (event_id, user_id) WHERE status = 'active';

CREATE TABLE messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  email      TEXT NOT NULL,
  text       TEXT NOT NULL CHECK (length(text) BETWEEN 10 AND 2000),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Журнал обращений к приложению (для статистики: число запросов, доля ошибок, медиана длительности).
CREATE TABLE access_log (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     INTEGER NOT NULL,
  method TEXT NOT NULL,
  route  TEXT NOT NULL,
  status INTEGER NOT NULL,
  ms     REAL NOT NULL
);

-- ── Триггеры: ограничения предметной области на уровне СУБД ──────────────────

-- Новая активная регистрация: мероприятие опубликовано и есть свободное место.
CREATE TRIGGER trg_reg_insert BEFORE INSERT ON registrations WHEN NEW.status = 'active'
BEGIN
  SELECT RAISE(ABORT, 'EVENT_CLOSED')
   WHERE (SELECT status FROM events WHERE id = NEW.event_id) IS NOT 'published';
  SELECT RAISE(ABORT, 'EVENT_FULL')
   WHERE (SELECT count(*) FROM registrations WHERE event_id = NEW.event_id AND status = 'active')
         >= (SELECT capacity FROM events WHERE id = NEW.event_id);
END;

-- Повторная активация отменённой регистрации подчиняется тому же лимиту.
CREATE TRIGGER trg_reg_reactivate BEFORE UPDATE OF status ON registrations
WHEN NEW.status = 'active' AND OLD.status <> 'active'
BEGIN
  SELECT RAISE(ABORT, 'EVENT_CLOSED')
   WHERE (SELECT status FROM events WHERE id = NEW.event_id) IS NOT 'published';
  SELECT RAISE(ABORT, 'EVENT_FULL')
   WHERE (SELECT count(*) FROM registrations WHERE event_id = NEW.event_id AND status = 'active')
         >= (SELECT capacity FROM events WHERE id = NEW.event_id);
END;

-- Лимит нельзя уменьшить ниже числа уже занятых мест.
CREATE TRIGGER trg_event_capacity BEFORE UPDATE OF capacity ON events
WHEN NEW.capacity < (SELECT count(*) FROM registrations WHERE event_id = NEW.id AND status = 'active')
BEGIN
  SELECT RAISE(ABORT, 'CAPACITY_BELOW_ACTIVE');
END;

-- Мероприятия создают только организаторы и администраторы.
CREATE TRIGGER trg_event_organizer_ins BEFORE INSERT ON events
WHEN (SELECT role FROM users WHERE id = NEW.organizer_id) NOT IN ('organizer', 'admin')
BEGIN
  SELECT RAISE(ABORT, 'ORGANIZER_ROLE_REQUIRED');
END;
