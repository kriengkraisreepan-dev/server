'use strict';

// Owner login for the Admin web: one account, password hash from env ADMIN_PASSWORD_HASH.
// Hash format: scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>  (create with `npm run hash-password`).
const crypto = require('node:crypto');

const COOKIE_NAME = 'hub_admin';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function hashPassword(password, { N = 16384, r = 8, p = 1 } = {}) {
  if (typeof password !== 'string' || password.length < 10) throw new Error('password must be at least 10 characters');
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64url');
  let actual;
  try {
    actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64url'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** In-memory sessions (single hub instance in Phase A). Restarting the hub logs the owner out. */
function createSessions({ clock, ttlMs = SESSION_TTL_MS }) {
  const sessions = new Map();
  return {
    create() {
      const sid = crypto.randomBytes(32).toString('base64url');
      sessions.set(sid, { expiresAt: clock.now() + ttlMs });
      return sid;
    },
    valid(sid) {
      if (typeof sid !== 'string') return false;
      const s = sessions.get(sid);
      if (!s) return false;
      if (s.expiresAt <= clock.now()) {
        sessions.delete(sid);
        return false;
      }
      return true;
    },
    destroy(sid) {
      sessions.delete(sid);
    },
  };
}

function sessionCookie(sid, { secure, maxAgeMs = SESSION_TTL_MS }) {
  const attrs = [`${COOKIE_NAME}=${sid}`, 'Path=/admin', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

function clearCookie({ secure }) {
  return sessionCookie('', { secure, maxAgeMs: 0 });
}

module.exports = { COOKIE_NAME, hashPassword, verifyPassword, parseCookies, createSessions, sessionCookie, clearCookie };
