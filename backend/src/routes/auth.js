// routes/auth.js — login / logout / me / account.
//
//   POST /api/auth/login    { username, password }       -> sets cookie, returns user
//   POST /api/auth/logout                                 -> clears session + cookie
//   GET  /api/auth/me                                     -> current user (401 if none)
//   PUT  /api/auth/account  { username?, email?,          -> update profile / password
//                             oldPassword?, newPassword? }
//
// Sessions are DB-backed; the cookie holds a signed random token whose SHA-256
// hash is the sessions row id.

const db = require('../db');
const auth = require('../auth');

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: false, // plain HTTP over LAN (see docs/AUTH_FLOW.md); revisit behind HTTPS
  path: '/',
  signed: true,
  maxAge: Math.floor(auth.SESSION_TTL_MS / 1000),
};

const ALLOWED_THEMES = ['amber', 'matrix', 'ice', 'paper', 'plasma', 'magenta'];
const WEEK_STARTS = [0, 1, 2, 3, 4, 5, 6];   // 0=Sun … 6=Sat
const SORT_KEYS = ['due', 'created', 'title', 'project', 'priority', 'tag'];
// validate + normalize a client-supplied sort_prefs object → a clean {order,enabled,dirs}
// (or null). Returns undefined if the payload is malformed.
function cleanSortPrefs(p) {
  if (p === null) return null;
  if (typeof p !== 'object' || Array.isArray(p)) return undefined;
  const order = Array.isArray(p.order) ? p.order.filter(k => SORT_KEYS.includes(k)) : [];
  for (const k of SORT_KEYS) if (!order.includes(k)) order.push(k);   // backfill any missing keys
  const enabled = {}, dirs = {};
  for (const k of SORT_KEYS) {
    enabled[k] = (p.enabled && p.enabled[k] === false) ? false : true;
    dirs[k] = (p.dirs && p.dirs[k] === 'desc') ? 'desc' : 'asc';
  }
  if (!SORT_KEYS.some(k => enabled[k])) return undefined;   // at least one must stay enabled
  return { order, enabled, dirs };
}
const publicUser = (u) => ({ id: u.id, username: u.username, email: u.email, theme: u.theme || 'amber', week_start: u.week_start ?? 1, sort_prefs: u.sort_prefs ? JSON.parse(u.sort_prefs) : null });

async function routes(fastify) {
  // ---- login --------------------------------------------------------------
  fastify.post('/api/auth/login', async (request, reply) => {
    const { username, password } = request.body || {};
    const ip = request.ip;
    const GENERIC = { error: 'invalid username or password' };

    if (auth.rateLimited(username, ip)) {
      return reply.code(429).send({ error: 'too many attempts — try again shortly' });
    }
    if (!username || !password) {
      auth.recordFailure(username, ip);
      return reply.code(401).send(GENERIC);
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(String(username).trim());
    if (!user) {
      await auth.dummyVerify(String(password)); // equalize timing
      auth.recordFailure(username, ip);
      return reply.code(401).send(GENERIC);
    }
    const ok = await auth.verifyPassword(user.password_hash, String(password));
    if (!ok) {
      auth.recordFailure(username, ip);
      return reply.code(401).send(GENERIC);
    }

    auth.clearFailures(username, ip);
    const token = auth.createSession(user.id);
    reply.setCookie(auth.COOKIE_NAME, token, COOKIE_OPTS);
    return publicUser(user);
  });

  // ---- logout -------------------------------------------------------------
  fastify.post('/api/auth/logout', { preHandler: fastify.authenticate }, async (request, reply) => {
    const raw = request.cookies[auth.COOKIE_NAME];
    const unsigned = raw ? request.unsignCookie(raw) : null;
    if (unsigned && unsigned.valid && unsigned.value) auth.revokeSession(unsigned.value);
    reply.clearCookie(auth.COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  // ---- me -----------------------------------------------------------------
  fastify.get('/api/auth/me', { preHandler: fastify.authenticate }, async (request) => {
    return publicUser(request.user);
  });

  // ---- account update -----------------------------------------------------
  fastify.put('/api/auth/account', { preHandler: fastify.authenticate }, async (request, reply) => {
    const body = request.body || {};
    const userId = request.user.id;
    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!current) return reply.code(401).send({ error: 'unauthorized' });

    let username = current.username;
    let email = current.email;
    let passwordHash = current.password_hash;
    let theme = current.theme || 'amber';
    let weekStart = current.week_start ?? 1;
    let sortPrefs = current.sort_prefs ?? null;   // JSON string or null

    if (body.theme !== undefined) {
      if (!ALLOWED_THEMES.includes(body.theme)) return reply.code(400).send({ error: 'unknown theme', field: 'theme' });
      theme = body.theme;
    }
    if (body.sort_prefs !== undefined) {
      const clean = cleanSortPrefs(body.sort_prefs);
      if (clean === undefined) return reply.code(400).send({ error: 'invalid sort prefs', field: 'sort_prefs' });
      sortPrefs = clean === null ? null : JSON.stringify(clean);
    }
    if (body.week_start !== undefined) {
      if (!WEEK_STARTS.includes(Number(body.week_start))) return reply.code(400).send({ error: 'invalid week start', field: 'week_start' });
      weekStart = Number(body.week_start);
    }

    if (body.username !== undefined) {
      const v = auth.validateUsername(body.username);
      if (!v.ok) return reply.code(400).send({ error: v.error, field: 'username' });
      const clash = db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(v.value, userId);
      if (clash) return reply.code(409).send({ error: 'username is already taken', field: 'username' });
      username = v.value;
    }
    if (body.email !== undefined) {
      const v = auth.validateEmail(body.email);
      if (!v.ok) return reply.code(400).send({ error: v.error, field: 'email' });
      const clash = db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE AND id != ?').get(v.value, userId);
      if (clash) return reply.code(409).send({ error: 'email is already in use', field: 'email' });
      email = v.value;
    }

    let passwordChanged = false;
    if (body.newPassword !== undefined || body.oldPassword !== undefined) {
      const okOld = await auth.verifyPassword(current.password_hash, String(body.oldPassword || ''));
      if (!okOld) return reply.code(400).send({ error: 'current password is incorrect', field: 'oldPassword' });
      const v = auth.validatePassword(body.newPassword);
      if (!v.ok) return reply.code(400).send({ error: v.error, field: 'newPassword' });
      if (await auth.verifyPassword(current.password_hash, v.value)) {
        return reply.code(400).send({ error: 'new password must differ from the current one', field: 'newPassword' });
      }
      passwordHash = await auth.hashPassword(v.value);
      passwordChanged = true;
    }

    const now = new Date().toISOString();
    try {
      db.prepare('UPDATE users SET username = ?, email = ?, password_hash = ?, theme = ?, week_start = ?, sort_prefs = ?, updated_at = ? WHERE id = ?')
        .run(username, email, passwordHash, theme, weekStart, sortPrefs, now, userId);
    } catch (err) {
      // Backstop for the UNIQUE COLLATE NOCASE constraints if a race slips past the checks.
      if (/UNIQUE/.test(err.message)) return reply.code(409).send({ error: 'username or email already in use' });
      throw err;
    }

    if (passwordChanged) {
      // Revoke other sessions, keep the current one.
      const raw = request.cookies[auth.COOKIE_NAME];
      const unsigned = raw ? request.unsignCookie(raw) : null;
      auth.revokeUserSessions(userId, unsigned && unsigned.valid ? unsigned.value : null);
    }

    return publicUser({ id: userId, username, email, theme, week_start: weekStart, sort_prefs: sortPrefs });
  });
}

module.exports = routes;
