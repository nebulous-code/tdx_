import assert from 'node:assert';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { newId } from '../src/ids.js';
import { buildTestApp, createAndLogin } from './support/app.js';

// Covers the projectId access guard on POST /api/tasks: creating a task INTO a project
// you can't write to must fail (404 invisible / 403 read-only), not silently succeed.
let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let alice: string;
let aliceId: string;
let bob: string;

const j = (method: string, url: string, payload?: object, c: string = alice) =>
  app.inject({
    method: method as 'GET',
    url,
    headers: { cookie: c },
    ...(payload ? { payload } : {}),
  });

before(async () => {
  ctx = await buildTestApp();
  app = ctx.app;
  const a = await createAndLogin(app, ctx.db);
  alice = a.cookie;
  aliceId = a.user.id;
  bob = (
    await createAndLogin(
      app,
      ctx.db,
      { username: 'bob', email: 'bob@example.com', password: 'Sup3r!secret' },
      { isAdmin: false },
    )
  ).cookie;
});
after(async () => {
  await app.close();
});

test('create a task into a project that does not exist → 404', async () => {
  const res = await j('POST', '/api/tasks', { title: 'orphan', projectId: newId() });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, 'not found');
});

test("create a task into another user's project → 404 (invisible)", async () => {
  const bobProj = (await j('POST', '/api/projects', { name: 'bob proj' }, bob)).json();
  const res = await j('POST', '/api/tasks', { title: 'sneaky', projectId: bobProj.id });
  assert.equal(res.statusCode, 404);
});

test('create a task into a project you can only READ → 403 (forbidden)', async () => {
  const bobProj = (await j('POST', '/api/projects', { name: 'shared proj' }, bob)).json();
  // grant alice a viewer (read-only) role on bob's project
  await ctx.db
    .insertInto('grants')
    .values({
      id: newId(),
      resource_type: 'project',
      resource_id: bobProj.id,
      principal_type: 'user',
      principal_id: aliceId,
      role: 'viewer',
      created_at: new Date().toISOString(),
    })
    .execute();
  // sanity: alice can now READ it
  assert.equal((await j('GET', `/api/projects/${bobProj.id}`)).statusCode, 200);
  // but creating a task into it is a write → 403
  const res = await j('POST', '/api/tasks', { title: 'read-only write', projectId: bobProj.id });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error, 'forbidden');
});
