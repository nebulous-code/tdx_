import assert from 'node:assert';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { createUser } from '../src/seed.js';
import { buildTestApp, createAndLogin, login } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let adminCookie: string;

before(async () => {
  ctx = await buildTestApp();
  app = ctx.app;
  ({ cookie: adminCookie } = await createAndLogin(app, ctx.db)); // alice = first user = admin
});
after(async () => {
  await app.close();
});

test('admin creates a user (201); the user can log in', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: { cookie: adminCookie },
    payload: { username: 'carol', email: 'carol@example.com', password: 'C@rol1234' },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().username, 'carol');
  const cookie = await login(app, 'carol', 'C@rol1234');
  assert.ok(cookie.startsWith('tdx_session='));
});

test('duplicate username → 409; weak password → 400', async () => {
  const dup = await app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: { cookie: adminCookie },
    payload: { username: 'carol', email: 'other@example.com', password: 'C@rol1234' },
  });
  assert.equal(dup.statusCode, 409);

  const weak = await app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: { cookie: adminCookie },
    payload: { username: 'eve', email: 'eve@example.com', password: 'weak' },
  });
  assert.equal(weak.statusCode, 400);
  assert.equal(weak.json().field, 'password');
});

test('non-admin → 403; unauthenticated → 401', async () => {
  await createUser(
    ctx.db,
    { username: 'dave', email: 'dave@example.com', password: 'D@ve1234' },
    { isAdmin: false },
  );
  const daveCookie = await login(app, 'dave', 'D@ve1234');
  const forbidden = await app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: { cookie: daveCookie },
    payload: { username: 'mallory', email: 'mallory@example.com', password: 'M@llory12' },
  });
  assert.equal(forbidden.statusCode, 403);

  const anon = await app.inject({
    method: 'POST',
    url: '/api/admin/users',
    payload: { username: 'mallory', email: 'mallory@example.com', password: 'M@llory12' },
  });
  assert.equal(anon.statusCode, 401);
});
