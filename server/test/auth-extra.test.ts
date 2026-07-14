import assert from 'node:assert';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import {
  createSession,
  resolveSession,
  revokeSession,
  revokeUserSessions,
  validateEmail,
  validateUsername,
} from '../src/auth.js';
import { createUser } from '../src/seed.js';
import { TEST_CREDS, buildTestApp, createAndLogin, login } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let cookie: string;
let userId: string;

before(async () => {
  ctx = await buildTestApp();
  app = ctx.app;
  const li = await createAndLogin(app, ctx.db); // alice = first user = admin
  cookie = li.cookie;
  userId = li.user.id;
});
after(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// routes/auth.ts — login branches
// ---------------------------------------------------------------------------

test('login: missing username/password → 401 (the !username||!password branch)', async () => {
  const noBody = await app.inject({ method: 'POST', url: '/api/auth/login', payload: {} });
  assert.equal(noBody.statusCode, 401);
  assert.equal(noBody.json().error, 'invalid username or password');

  const onlyUser = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'someone' },
  });
  assert.equal(onlyUser.statusCode, 401);

  const onlyPass = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password: 'whatever' },
  });
  assert.equal(onlyPass.statusCode, 401);
});

test('login: unknown user → 401 (dummyVerify path)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'nobody-here', password: 'Sup3r!secret' },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, 'invalid username or password');
});

// ---------------------------------------------------------------------------
// routes/auth.ts — logout branches (valid cookie vs missing/invalid)
// ---------------------------------------------------------------------------

test('logout: with a valid session cookie revokes it', async () => {
  const sess = await login(app, 'alice', TEST_CREDS.password);
  const out = await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { cookie: sess },
  });
  assert.equal(out.statusCode, 200);
  assert.deepEqual(out.json(), { ok: true });
});

test('logout: authenticated via Bearer (no session cookie) → unsigned is null branch', async () => {
  // A PAT authenticates the request, so app.authenticate passes, but there is
  // no session cookie → the `raw ? ... : null` and `unsigned?.valid` falsy arm.
  const mk = await app.inject({
    method: 'POST',
    url: '/api/auth/tokens',
    headers: { cookie },
    payload: { name: 'logout-bearer' },
  });
  assert.equal(mk.statusCode, 201);
  const token = mk.json().token as string;

  const out = await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(out.statusCode, 200);
  assert.deepEqual(out.json(), { ok: true });
});

// ---------------------------------------------------------------------------
// routes/auth.ts — /me
// ---------------------------------------------------------------------------

test('me: authenticated returns the public user', async () => {
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().username, 'alice');
});

// ---------------------------------------------------------------------------
// routes/auth.ts — account update: each optional-field branch, both arms
// ---------------------------------------------------------------------------

test('account: sort_prefs accepted then rejected when malformed', async () => {
  const ok = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: {
      sort_prefs: { order: ['due', 'title'], enabled: { due: true }, dirs: { due: 'desc' } },
    },
  });
  assert.equal(ok.statusCode, 200);
  assert.ok(ok.json().sort_prefs);

  // setting it back to null is also valid
  const cleared = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { sort_prefs: null },
  });
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.json().sort_prefs, null);

  // malformed (all sort keys disabled → cleanSortPrefs returns undefined)
  const bad = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: {
      sort_prefs: {
        enabled: {
          due: false,
          created: false,
          title: false,
          project: false,
          priority: false,
          tag: false,
        },
      },
    },
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().field, 'sort_prefs');
});

test('account: week_start accepted then rejected when out of range', async () => {
  const ok = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { week_start: 0 },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().week_start, 0);

  const bad = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { week_start: 9 },
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().field, 'week_start');
});

test('account: fib_sizing accepted then rejected when not 0/1', async () => {
  const ok = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { fib_sizing: 1 },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().fib_sizing, true);

  const bad = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { fib_sizing: 5 },
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().field, 'fib_sizing');
});

// ---- notes_root_name: the vault's base directory (n.16) --------------------

test('account: notes_root_name accepted, echoed, and survives a round-trip to /me', async () => {
  const ok = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { notes_root_name: 'Unfiled' },
  });
  assert.equal(ok.statusCode, 200);
  // the response is hand-built, NOT re-read from the row — this asserts it was not forgotten
  assert.equal(ok.json().notes_root_name, 'Unfiled');

  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  assert.equal(me.json().notes_root_name, 'Unfiled');

  await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { notes_root_name: 'inbox' }, // back to the default for the tests that follow
  });
});

test('account: a blank notes_root_name is VALID — it hides the base directory', async () => {
  const res = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { notes_root_name: '' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().notes_root_name, ''); // not coerced back to 'inbox'

  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  assert.equal(me.json().notes_root_name, '');

  await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { notes_root_name: 'inbox' },
  });
});

test('account: notes_root_name over 60 chars → 400', async () => {
  const res = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { notes_root_name: 'x'.repeat(61) },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().field, 'notes_root_name');
});

// `folder:` matches by NAME, so a base directory sharing a real folder's name makes the token
// ambiguous. Reject it at the door — the collision can still arise later via a vault sync, and
// that case degrades at query time (the alias switches off; the real directory wins).
test('account: notes_root_name colliding with a real folder → 400', async () => {
  const mk = await app.inject({
    method: 'POST',
    url: '/api/folders',
    headers: { cookie },
    payload: { name: 'Archive' },
  });
  assert.equal(mk.statusCode, 201);

  const res = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { notes_root_name: 'archive' }, // slug-equal → collides
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().field, 'notes_root_name');
});

test('account: username invalid → 400; valid + no clash → 200', async () => {
  const bad = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { username: '' }, // fails validateUsername
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().field, 'username');

  const ok = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { username: 'alice2' }, // no clash → success
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().username, 'alice2');

  // rename back so other tests can log in as alice
  const back = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { username: 'alice' },
  });
  assert.equal(back.statusCode, 200);
});

test('account: email invalid → 400; clash → 409; valid+no-clash → 200', async () => {
  await createUser(ctx.db, {
    username: 'mona',
    email: 'mona@example.com',
    password: 'M0na!secret',
  });

  const bad = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { email: 'not-an-email' },
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().field, 'email');

  const clash = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { email: 'mona@example.com' },
  });
  assert.equal(clash.statusCode, 409);
  assert.equal(clash.json().field, 'email');

  const ok = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { email: 'alice-new@example.com' },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().email, 'alice-new@example.com');
});

test('account: wrong old password → 400; same-as-current new password → 400', async () => {
  const wrongOld = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { oldPassword: 'definitely-wrong', newPassword: 'An0ther!one' },
  });
  assert.equal(wrongOld.statusCode, 400);
  assert.equal(wrongOld.json().field, 'oldPassword');

  // weak new password → validatePassword fails
  const weakNew = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { oldPassword: TEST_CREDS.password, newPassword: 'weak' },
  });
  assert.equal(weakNew.statusCode, 400);
  assert.equal(weakNew.json().field, 'newPassword');

  // new password equals current → rejected
  const same = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { oldPassword: TEST_CREDS.password, newPassword: TEST_CREDS.password },
  });
  assert.equal(same.statusCode, 400);
  assert.equal(same.json().field, 'newPassword');
});

test('account: current user gone → 401', async () => {
  // Make a throwaway user, log in, delete the row, then hit account.
  await createUser(
    ctx.db,
    { username: 'ghost', email: 'ghost@example.com', password: 'Gh0st!secret' },
    { isAdmin: false },
  );
  const ghostCookie = await login(app, 'ghost', 'Gh0st!secret');
  await ctx.db.deleteFrom('users').where('username', '=', 'ghost').execute();

  const res = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie: ghostCookie },
    payload: { theme: 'matrix' },
  });
  assert.equal(res.statusCode, 401);
});

// ---------------------------------------------------------------------------
// admin.ts — validators and clash branches
// ---------------------------------------------------------------------------

test('admin: invalid username → 400', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: { cookie },
    payload: { username: '', email: 'x@example.com', password: 'X@mpl1234' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().field, 'username');
});

test('admin: invalid email → 400', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: { cookie },
    payload: { username: 'newbie', email: 'bad', password: 'X@mpl1234' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().field, 'email');
});

test('admin: email clash → 409', async () => {
  // alice currently has alice-new@example.com (from the account test). Use a
  // freshly created user whose email collides.
  await createUser(ctx.db, {
    username: 'clasher',
    email: 'clash@example.com',
    password: 'Cl@sh1234',
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: { cookie },
    payload: { username: 'brandnew', email: 'clash@example.com', password: 'Br@nd1234' },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().field, 'email');
});

test('admin: username clash → 409', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: { cookie },
    payload: { username: 'clasher', email: 'unique-clash@example.com', password: 'Cl@sh1234' },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().field, 'username');
});

test('admin: isAdmin flag honored (201)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: { cookie },
    payload: {
      username: 'superuser',
      email: 'superuser@example.com',
      password: 'Sup3r!user1',
      isAdmin: true,
    },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().username, 'superuser');
});

// ---------------------------------------------------------------------------
// auth.ts — direct unit coverage of session internals + validators
// ---------------------------------------------------------------------------

test('resolveSession: empty token → null', async () => {
  assert.equal(await resolveSession(ctx.db, ''), null);
});

test('resolveSession: unknown token → null', async () => {
  assert.equal(await resolveSession(ctx.db, 'no-such-token'), null);
});

test('resolveSession: expired session is deleted and returns null', async () => {
  const token = await createSession(ctx.db, userId);
  // force the stored session to be already expired
  await ctx.db
    .updateTable('sessions')
    .set({ expires_at: new Date(Date.now() - 1000).toISOString() })
    .where('user_id', '=', userId)
    .execute();
  const resolved = await resolveSession(ctx.db, token);
  assert.equal(resolved, null);
});

test('resolveSession: valid session resolves to the user (sliding expiry)', async () => {
  const token = await createSession(ctx.db, userId);
  const resolved = await resolveSession(ctx.db, token);
  assert.ok(resolved);
  assert.equal(resolved?.id, userId);
  await revokeSession(ctx.db, token);
});

test('resolveSession: session pointing at a deleted user → null', async () => {
  await createUser(
    ctx.db,
    { username: 'transient', email: 'transient@example.com', password: 'Tr@ns1234' },
    { isAdmin: false },
  );
  const row = await ctx.db
    .selectFrom('users')
    .select('id')
    .where('username', '=', 'transient')
    .executeTakeFirstOrThrow();
  const token = await createSession(ctx.db, row.id);
  await ctx.db.deleteFrom('users').where('id', '=', row.id).execute();
  const resolved = await resolveSession(ctx.db, token);
  assert.equal(resolved, null);
});

test('revokeUserSessions: keepRawToken keeps the current session, drops others', async () => {
  const keep = await createSession(ctx.db, userId);
  const drop = await createSession(ctx.db, userId);
  await revokeUserSessions(ctx.db, userId, keep);
  assert.ok(await resolveSession(ctx.db, keep));
  assert.equal(await resolveSession(ctx.db, drop), null);
  await revokeSession(ctx.db, keep);
});

test('revokeUserSessions: no keep token removes all sessions', async () => {
  await createSession(ctx.db, userId);
  await createSession(ctx.db, userId);
  await revokeUserSessions(ctx.db, userId);
  const rows = await ctx.db
    .selectFrom('sessions')
    .select('id')
    .where('user_id', '=', userId)
    .execute();
  assert.equal(rows.length, 0);
});

test('validateUsername / validateEmail edge branches', () => {
  const okName = validateUsername('  ok  ');
  assert.equal(okName.ok && okName.value, 'ok');
  assert.equal(validateUsername('').ok, false);
  assert.equal(validateUsername('x'.repeat(33)).ok, false);
  assert.equal(validateEmail('a@b.co').ok, true);
  assert.equal(validateEmail('nope').ok, false);
  assert.equal(validateEmail(null).ok, false);
});
