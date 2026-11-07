// Пароли (scrypt), серверные сеансы, CSRF-токены, ограничение частоты входа.
import crypto from 'node:crypto';
import { config } from './config.js';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(String(pw), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Заглушка для постоянного времени проверки при неизвестном логине
export const DUMMY_HASH = hashPassword('dummy-password-0');

export function createSession(db, userId = null) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  db.run('INSERT INTO sessions(token_hash, user_id, csrf, expires_at) VALUES (?,?,?,?)',
    sha(token), userId, csrf, Date.now() + config.sessionTtl);
  return { token, csrf, user_id: userId };
}

export function loadSession(db, token) {
  if (!token) return null;
  const s = db.get('SELECT token_hash, user_id, csrf, flash, expires_at FROM sessions WHERE token_hash = ?', sha(token));
  if (!s || s.expires_at < Date.now()) return null;
  return s;
}

export function loadUser(db, id) {
  return id ? db.get('SELECT id, login, name, email, role FROM users WHERE id = ?', id) ?? null : null;
}

export function destroySession(db, token) {
  if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha(token));
}

export const sessionKey = sha;

export function checkCsrf(session, given) {
  if (!session || !given) return false;
  const a = Buffer.from(session.csrf);
  const b = Buffer.from(String(given));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Не более 5 неудачных входов подряд: блокировка на 10 минут (ключ: логин + адрес)
const attempts = new Map();
const MAX_FAILS = 5;
const LOCK_MS = 10 * 60 * 1000;

export const loginLimiter = {
  isLocked(key) {
    const a = attempts.get(key);
    return Boolean(a && a.until > Date.now());
  },
  fail(key) {
    const a = attempts.get(key) ?? { fails: 0, until: 0 };
    if (a.until && a.until <= Date.now()) { a.fails = 0; a.until = 0; }
    a.fails += 1;
    if (a.fails >= MAX_FAILS) a.until = Date.now() + LOCK_MS;
    attempts.set(key, a);
  },
  reset(key) { attempts.delete(key); },
  clear() { attempts.clear(); },
};
