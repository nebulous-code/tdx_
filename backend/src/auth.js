// auth.js — password hashing, session tokens, validators, rate-limiting, and the
// Fastify `authenticate` preHandler. Shared by routes/auth.js and the tools/ CLI.

const crypto = require('crypto');
const argon2 = require('@node-rs/argon2');
const db = require('./db');

// ---- password hashing (argon2id, WASP/Lucia/OWASP-aligned, hardcoded) ------
const ARGON_OPTS = {
  // @node-rs/argon2 defaults to Argon2id; set it explicitly but tolerate enum
  // shape differences across versions (Argon2id == 2).
  algorithm: argon2.Algorithm && argon2.Algorithm.Argon2id != null ? argon2.Algorithm.Argon2id : 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};
const hashPassword = (plain) => argon2.hash(plain, ARGON_OPTS);
const verifyPassword = (hash, plain) => argon2.verify(hash, plain).catch(() => false);

// A throwaway hash so login can run a verify even when the username is unknown,
// keeping response time roughly constant (no user-enumeration timing leak).
let _dummyHash = null;
async function dummyVerify(plain) {
  if (!_dummyHash) _dummyHash = await hashPassword('timing-equalizer');
  await verifyPassword(_dummyHash, plain);
}

// ---- session tokens --------------------------------------------------------
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, sliding
const COOKIE_NAME = 'tdx_session';

const mintToken = () => crypto.randomBytes(32).toString('base64url');     // -> cookie
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex'); // -> sessions.id

function createSession(userId) {
  const token = mintToken();
  const now = new Date();
  db.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)'
  ).run(hashToken(token), userId, now.toISOString(), new Date(now.getTime() + SESSION_TTL_MS).toISOString(), now.toISOString());
  return token; // raw token goes in the cookie; only its hash is stored
}

// Resolve a raw token to its user, sliding the expiry forward. Returns the user
// row ({id, username, email}) or null. Deletes the session if expired.
function resolveSession(rawToken) {
  if (!rawToken) return null;
  const sid = hashToken(rawToken);
  const sess = db.prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?').get(sid);
  if (!sess) return null;
  const now = new Date();
  if (new Date(sess.expires_at) <= now) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
    return null;
  }
  db.prepare('UPDATE sessions SET expires_at = ?, last_seen = ? WHERE id = ?')
    .run(new Date(now.getTime() + SESSION_TTL_MS).toISOString(), now.toISOString(), sid);
  return db.prepare('SELECT id, username, email, theme, week_start, sort_prefs, is_admin FROM users WHERE id = ?').get(sess.user_id) || null;
}

const revokeSession = (rawToken) =>
  db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(rawToken));
// Revoke every session for a user except an optional one to keep (the current).
function revokeUserSessions(userId, keepRawToken) {
  if (keepRawToken) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, hashToken(keepRawToken));
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

// ---- validators (shared with the CLI tools) --------------------------------
function validateUsername(raw) {
  const value = String(raw ?? '').trim();
  if (value.length < 1 || value.length > 32) return { ok: false, error: 'username must be 1–32 characters' };
  return { ok: true, value };
}
function validateEmail(raw) {
  const value = String(raw ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { ok: false, error: 'enter a valid email address' };
  return { ok: true, value };
}
function validatePassword(raw) {
  const value = String(raw ?? '');
  if (value.length < 8) return { ok: false, error: 'password must be at least 8 characters' };
  if (!/[A-Z]/.test(value)) return { ok: false, error: 'password needs an uppercase letter' };
  if (!/[a-z]/.test(value)) return { ok: false, error: 'password needs a lowercase letter' };
  if (!/[0-9]/.test(value)) return { ok: false, error: 'password needs a number' };
  if (!/[^A-Za-z0-9]/.test(value)) return { ok: false, error: 'password needs a symbol' };
  return { ok: true, value };
}

// ---- login rate-limiting (in-memory; resets on restart) --------------------
// Keyed by "username|ip": after 5 failures within 15 min, block for 60s.
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 60 * 1000;
const attempts = new Map();
const rlKey = (username, ip) => `${String(username || '').toLowerCase()}|${ip}`;

function rateLimited(username, ip) {
  const rec = attempts.get(rlKey(username, ip));
  return !!(rec && rec.blockedUntil && rec.blockedUntil > Date.now());
}
function recordFailure(username, ip) {
  const key = rlKey(username, ip);
  const now = Date.now();
  let rec = attempts.get(key);
  if (!rec || now - rec.windowStart > WINDOW_MS) rec = { windowStart: now, fails: 0, blockedUntil: 0 };
  rec.fails += 1;
  if (rec.fails >= MAX_FAILS) rec.blockedUntil = now + BLOCK_MS;
  attempts.set(key, rec);
}
const clearFailures = (username, ip) => attempts.delete(rlKey(username, ip));

// ---- Fastify guard ---------------------------------------------------------
// Attach as a per-route preHandler on protected routes. On success sets
// request.user = {id, username, email}; otherwise replies 401.
async function authenticate(request, reply) {
  const raw = request.cookies ? request.cookies[COOKIE_NAME] : null;
  if (!raw) return reply.code(401).send({ error: 'unauthorized' });
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return reply.code(401).send({ error: 'unauthorized' });
  const user = resolveSession(unsigned.value);
  if (!user) return reply.code(401).send({ error: 'unauthorized' });
  request.user = user;
}

// Admin-only guard: authenticate first, then require is_admin. Used by the
// instance-level backup routes (a backup is the whole multi-tenant DB).
async function authenticateAdmin(request, reply) {
  await authenticate(request, reply);
  if (reply.sent) return;                 // authenticate already replied 401
  if (!request.user || !request.user.is_admin) {
    return reply.code(403).send({ error: 'forbidden' });
  }
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  dummyVerify,
  createSession,
  resolveSession,
  revokeSession,
  revokeUserSessions,
  validateUsername,
  validateEmail,
  validatePassword,
  rateLimited,
  recordFailure,
  clearFailures,
  authenticate,
  authenticateAdmin,
};
