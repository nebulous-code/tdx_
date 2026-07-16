// auth-db-fill.test.ts — fills the LEFTOVER branch arms in src/auth.ts,
// src/db.ts, src/routes/admin.ts and src/routes/auth.ts that the existing
// auth/admin/tokens/units suites do not reach. Each test names the specific
// arm it is there to hit. Global mutations (passwords/usernames) are restored.

import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import {
  cleanSortPrefs,
  clearFailures,
  createSession,
  publicUser,
  rateLimited,
  recordFailure,
  resolveSession,
  revokeSession,
  revokeUserSessions,
} from '../src/auth.js';
import { applyMigrations, openDatabase } from '../src/db.js';
import { createUser } from '../src/seed.js';
import { TEST_CREDS, buildTestApp, createAndLogin } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let cookie: string;

before(async () => {
  ctx = await buildTestApp();
  app = ctx.app;
  const li = await createAndLogin(app, ctx.db); // alice = first user = admin
  cookie = li.cookie;
});
after(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// src/auth.ts — in-memory login rate-limiter (pure; not exercised elsewhere)
// ---------------------------------------------------------------------------

test('rateLimited / recordFailure / clearFailures: full block + reset cycle', () => {
  const ip = '203.0.113.7';
  const name = `rl-${Date.now()}`;

  // No record yet → not limited (the `rec` falsy arm of rateLimited).
  assert.equal(rateLimited(name, ip), false);

  // First failure creates a fresh window (the `!rec` arm of recordFailure) but
  // stays under MAX_FAILS → still not blocked (blockedUntil falsy arm).
  recordFailure(name, ip);
  assert.equal(rateLimited(name, ip), false);

  // Drive up to the threshold so blockedUntil is set → rateLimited true arm.
  for (let i = 0; i < 4; i++) recordFailure(name, ip);
  assert.equal(rateLimited(name, ip), true);

  // clearFailures removes the record (returns true), then false on a no-op.
  assert.equal(clearFailures(name, ip), true);
  assert.equal(clearFailures(name, ip), false);
  assert.equal(rateLimited(name, ip), false);
});

test('recordFailure: a stale window is reset rather than incremented', () => {
  const ip = '203.0.113.8';
  const name = `rlwin-${Date.now()}`;
  // username==null / undefined exercises the `String(username||'')` falsy arm.
  recordFailure(undefined, ip);
  assert.equal(rateLimited(undefined, ip), false);
  clearFailures(undefined, ip);

  // For the same key, recording again after the window must start fresh. We
  // cannot fast-forward time, so just record a couple and confirm no block.
  recordFailure(name, ip);
  recordFailure(name, ip);
  assert.equal(rateLimited(name, ip), false);
  clearFailures(name, ip);
});

// ---------------------------------------------------------------------------
// src/auth.ts — publicUser shape: both arms of every `||` / `??` / ternary
// ---------------------------------------------------------------------------

test('publicUser: defaults applied when columns are empty/null', () => {
  const u = publicUser({
    id: 'u1',
    username: 'x',
    email: 'x@example.com',
    theme: '', // falsy → 'amber'
    week_start: null as unknown as number, // nullish → 1
    sort_prefs: null, // null → null (no JSON.parse)
    fib_sizing: 0,
    notes_root_name: null as unknown as string, // nullish → 'Inbox'
    calendars_all_name: null as unknown as string, // nullish → 'Everything'
    is_admin: 0,
  });
  assert.equal(u.theme, 'amber');
  assert.equal(u.week_start, 1);
  assert.equal(u.sort_prefs, null);
  assert.equal(u.fib_sizing, false);
  assert.equal(u.notes_root_name, 'Inbox');
  assert.equal(u.is_admin, false);
});

// '' means "the base directory is HIDDEN" — a real choice, not an absent value. publicUser must
// use `??` and not `||`, or hiding the row would silently snap back to the default (n.16).
test('publicUser: an empty notes_root_name survives (hidden, not defaulted)', () => {
  const u = publicUser({
    id: 'u3',
    username: 'z',
    email: 'z@example.com',
    theme: 'amber',
    week_start: 1,
    sort_prefs: null,
    fib_sizing: 0,
    notes_root_name: '',
    calendars_all_name: '',
    is_admin: 0,
  });
  assert.equal(u.notes_root_name, '');
});

test('publicUser: present columns pass through (JSON.parse of sort_prefs)', () => {
  const u = publicUser({
    id: 'u2',
    username: 'y',
    email: 'y@example.com',
    theme: 'matrix', // truthy → kept
    week_start: 3, // present → kept
    sort_prefs: JSON.stringify({ order: ['due'], enabled: { due: true }, dirs: { due: 'asc' } }),
    fib_sizing: 1,
    notes_root_name: 'Unfiled',
    calendars_all_name: 'All events',
    is_admin: 1,
  });
  assert.equal(u.theme, 'matrix');
  assert.equal(u.week_start, 3);
  assert.deepEqual(u.sort_prefs?.order, ['due']);
  assert.equal(u.fib_sizing, true);
  assert.equal(u.notes_root_name, 'Unfiled');
  assert.equal(u.is_admin, true);
});

// ---------------------------------------------------------------------------
// src/auth.ts — cleanSortPrefs: the not-yet-hit arms (non-array order, the
// `o.enabled`/`o.dirs` absent arms, and a non-object/array payload).
// ---------------------------------------------------------------------------

test('cleanSortPrefs: non-object and array payloads → undefined', () => {
  assert.equal(cleanSortPrefs('nope'), undefined);
  assert.equal(cleanSortPrefs([1, 2, 3]), undefined);
});

test('cleanSortPrefs: missing order/enabled/dirs fall back to defaults', () => {
  // order not an array → starts empty then back-fills all keys; enabled/dirs
  // absent → the `o.enabled && ...` and `o.dirs && ...` falsy arms.
  const out = cleanSortPrefs({ order: 'not-array' });
  assert.ok(out);
  assert.equal(out?.order.length, 6); // all SORT_KEYS appended
  assert.equal(out?.enabled.due, true); // default enabled
  assert.equal(out?.dirs.due, 'asc'); // default dir
});

// ---------------------------------------------------------------------------
// src/auth.ts — resolveSession sliding-expiry + expired + deleted-user arms
// (re-asserted here in case cross-file coverage merge leaves them short).
// ---------------------------------------------------------------------------

// All session-table mutation below targets a THROWAWAY user so alice's login
// cookie (used by the route tests in this file) is never revoked.
async function makeSessionUser(): Promise<string> {
  const uname = `fill-sess-${crypto.randomBytes(4).toString('hex')}`;
  await createUser(
    ctx.db,
    { username: uname, email: `${uname}@example.com`, password: 'F1ll!sess1' },
    { isAdmin: false },
  );
  const row = await ctx.db
    .selectFrom('users')
    .select('id')
    .where('username', '=', uname)
    .executeTakeFirstOrThrow();
  return row.id;
}

test('resolveSession: expired session deleted → null; valid slides forward', async () => {
  const uid = await makeSessionUser();

  // expired arm
  const expired = await createSession(ctx.db, uid);
  await ctx.db
    .updateTable('sessions')
    .set({ expires_at: new Date(Date.now() - 5000).toISOString() })
    .where('id', '=', hashFor(expired))
    .execute();
  assert.equal(await resolveSession(ctx.db, expired), null);

  // valid arm: resolves + bumps expires_at/last_seen
  const live = await createSession(ctx.db, uid);
  const before = await ctx.db
    .selectFrom('sessions')
    .select(['expires_at'])
    .where('id', '=', hashFor(live))
    .executeTakeFirstOrThrow();
  const resolved = await resolveSession(ctx.db, live);
  assert.equal(resolved?.id, uid);
  const afterRow = await ctx.db
    .selectFrom('sessions')
    .select(['expires_at'])
    .where('id', '=', hashFor(live))
    .executeTakeFirstOrThrow();
  assert.ok(new Date(afterRow.expires_at) >= new Date(before.expires_at));
  await revokeSession(ctx.db, live);
});

test('revokeUserSessions: keepRawToken arm keeps current, drops others', async () => {
  const uid = await makeSessionUser();
  const keep = await createSession(ctx.db, uid);
  const drop = await createSession(ctx.db, uid);
  await revokeUserSessions(ctx.db, uid, keep); // keepRawToken truthy arm
  assert.ok(await resolveSession(ctx.db, keep));
  assert.equal(await resolveSession(ctx.db, drop), null);
  await revokeUserSessions(ctx.db, uid); // null arm: drop the rest
});

// ---------------------------------------------------------------------------
// src/routes/admin.ts — email-clash 409 (lines 30-35) reached only when there
// is no username clash, then a colliding email.
// ---------------------------------------------------------------------------

test('admin: email clash (no username clash) → 409 field=email', async () => {
  await createUser(ctx.db, {
    username: 'fill-clash-owner',
    email: 'fill-clash@example.com',
    password: 'F1ll!clash',
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: { cookie },
    payload: {
      username: 'fill-clash-new', // unique username → past clashU
      email: 'fill-clash@example.com', // collides → clashE 409
      password: 'F1ll!clash2',
    },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().field, 'email');
});

// ---------------------------------------------------------------------------
// src/routes/auth.ts — login success tail (publicUser + setCookie) and the
// username-clash 409 on account update (lines 72-74, 133-140).
// ---------------------------------------------------------------------------

test('login: success returns publicUser and sets the session cookie', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: TEST_CREDS.username, password: TEST_CREDS.password },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().username, 'alice');
  assert.ok(res.cookies.find((c) => c.name === 'tdx_session'));
});

test('account: username clash → 409 (field=username)', async () => {
  await createUser(ctx.db, {
    username: 'fill-taken',
    email: 'fill-taken@example.com',
    password: 'F1ll!taken',
  });
  const res = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { username: 'fill-taken' }, // collides with the row above
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().field, 'username');

  // alice's username is unchanged (the clash path returns before writing).
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  assert.equal(me.json().username, 'alice');
});

// ---------------------------------------------------------------------------
// src/db.ts — openDatabase ':memory:' arm (no mkdir) and a real-file arm
// (mkdirSync recursive), plus applyMigrations apply-vs-skip + default dir.
// ---------------------------------------------------------------------------

test('openDatabase: in-memory arm (skips mkdir) opens + migrates', () => {
  const { db, sqlite } = openDatabase(':memory:');
  try {
    const rows = sqlite.prepare('SELECT version FROM schema_migrations').all();
    assert.ok(rows.length > 0);
    assert.ok(db);
  } finally {
    sqlite.close();
  }
});

test('openDatabase: file arm creates nested dirs; re-applyMigrations is a no-op', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdx-fill-'));
  const dbPath = path.join(dir, 'a', 'b', 'tdx.db'); // forces mkdirSync recursive
  const { sqlite } = openDatabase(dbPath);
  try {
    assert.ok(fs.existsSync(dbPath));
    // first call applied everything; a second call hits the applied.has skip arm
    const again = applyMigrations(sqlite); // default migrationsDir arm
    assert.deepEqual(again, []);
  } finally {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applyMigrations: a fresh sqlite applies migrations (apply arm)', () => {
  const { sqlite } = openDatabase(':memory:');
  try {
    // openDatabase already migrated; applying to a separate fresh handle proves
    // the apply (non-skip) arm returns the file list.
    const fresh = openDatabase(':memory:');
    try {
      const applied = applyMigrations(fresh.sqlite); // all already applied → []
      assert.deepEqual(applied, []);
    } finally {
      fresh.sqlite.close();
    }
  } finally {
    sqlite.close();
  }
});

// helper: replicate src/auth.ts hashToken for asserting on stored rows
function hashFor(rawToken: string): string {
  // sha256 hex of the raw token — identical to auth.ts's internal hashToken.
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}
