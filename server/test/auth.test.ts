import assert from 'node:assert';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { createUser } from '../src/seed.js';
import { TEST_CREDS, buildTestApp, createAndLogin, login } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let cookie: string;

before(async () => {
  ctx = await buildTestApp();
  app = ctx.app;
  ({ cookie } = await createAndLogin(app, ctx.db));
});
after(async () => {
  await app.close();
});

test('login returns publicUser + sets a signed session cookie', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: TEST_CREDS.username, password: TEST_CREDS.password },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.username, 'alice');
  assert.equal(body.email, 'alice@example.com');
  assert.equal(body.is_admin, true);
  assert.equal(body.theme, 'amber');
  assert.equal(body.sort_prefs, null);
  assert.ok(!('password_hash' in body));
  assert.ok(res.cookies.find((c) => c.name === 'tdx_session'));
});

test('login with wrong password → 401', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'alice', password: 'wrong-password' },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, 'invalid username or password');
});

test('GET /me → 401 without cookie, 200 with', async () => {
  const anon = await app.inject({ method: 'GET', url: '/api/auth/me' });
  assert.equal(anon.statusCode, 401);
  const authed = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  assert.equal(authed.statusCode, 200);
  assert.equal(authed.json().username, 'alice');
});

test('rate limit: 5 failures → 429', async () => {
  // an unknown username, isolated from alice's key
  for (let i = 0; i < 5; i++) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ratebot', password: 'nope' },
    });
    assert.equal(r.statusCode, 401);
  }
  const blocked = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'ratebot', password: 'nope' },
  });
  assert.equal(blocked.statusCode, 429);
});

test('account: change theme; reject unknown theme', async () => {
  const ok = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { theme: 'matrix' },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().theme, 'matrix');

  const bad = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { theme: 'neon' },
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().field, 'theme');
});

test('account: username clash → 409', async () => {
  await createUser(ctx.db, { username: 'bob', email: 'bob@example.com', password: 'B0b!secret' });
  const res = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { username: 'bob' },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().field, 'username');
});

test('password change revokes OTHER sessions, keeps current; new password works', async () => {
  // a fresh login for the same user → a second, independent session
  const otherCookie = await login(app, 'alice', TEST_CREDS.password);

  const changed = await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { oldPassword: TEST_CREDS.password, newPassword: 'N3w!password' },
  });
  assert.equal(changed.statusCode, 200);

  // current session still valid
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  assert.equal(me.statusCode, 200);
  // the other session was revoked
  const other = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie: otherCookie },
  });
  assert.equal(other.statusCode, 401);
  // can log in with the new password
  const relogin = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'alice', password: 'N3w!password' },
  });
  assert.equal(relogin.statusCode, 200);

  // restore the password so later assumptions/tests stay simple
  await app.inject({
    method: 'PUT',
    url: '/api/auth/account',
    headers: { cookie },
    payload: { oldPassword: 'N3w!password', newPassword: TEST_CREDS.password },
  });
});

test('logout clears the session; cookie no longer authenticates', async () => {
  const sess = await login(app, 'alice', TEST_CREDS.password);
  const out = await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { cookie: sess },
  });
  assert.equal(out.statusCode, 200);
  assert.deepEqual(out.json(), { ok: true });
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sess } });
  assert.equal(me.statusCode, 401);
});
