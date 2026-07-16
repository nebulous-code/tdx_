// Shared-project access-control branches of routes/projects.ts that an owner-only
// test can't reach: a user with a viewer (read) grant on another user's project
// can GET it but not PUT/DELETE/create-child (403, denyStatus: read < write);
// an editor (write) grant unlocks PUT/DELETE/create-child.

import assert from 'node:assert';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { newId } from '../src/ids.js';
import { buildTestApp, createAndLogin } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let aliceCookie: string;
let bobCookie: string;
let bobId: string;

const now = new Date().toISOString();

const j = (method: string, url: string, payload: object | undefined, c: string) =>
  app.inject({
    method: method as 'GET',
    url,
    headers: { cookie: c },
    ...(payload ? { payload } : {}),
  });

// Grant bob `role` on `projectId` (a direct user-principal grant on a project).
const grant = (projectId: string, role: 'viewer' | 'editor') =>
  ctx.db
    .insertInto('grants')
    .values({
      id: newId(),
      resource_type: 'project',
      resource_id: projectId,
      principal_type: 'user',
      principal_id: bobId,
      role,
      created_at: now,
    })
    .execute();

before(async () => {
  ctx = await buildTestApp();
  app = ctx.app;
  ({ cookie: aliceCookie } = await createAndLogin(app, ctx.db));
  const bob = await createAndLogin(
    app,
    ctx.db,
    { username: 'bob', email: 'bob@example.com', password: 'Sup3r!secret' },
    { isAdmin: false },
  );
  bobCookie = bob.cookie;
  bobId = bob.user.id;
});
after(async () => {
  await app.close();
});

test('viewer grant: bob can GET but writes are 403, not 404', async () => {
  const p = (await j('POST', '/api/projects', { name: 'viewer-shared' }, aliceCookie)).json();

  // No grant yet → invisible to bob (404).
  assert.equal((await j('GET', `/api/projects/${p.id}`, undefined, bobCookie)).statusCode, 404);

  await grant(p.id, 'viewer');

  // Read is allowed via the grant (not ownership).
  const got = await j('GET', `/api/projects/${p.id}`, undefined, bobCookie);
  assert.equal(got.statusCode, 200);
  assert.equal(got.json().id, p.id);

  // Writes are visible-but-forbidden: 403 (level=read exists but < write).
  const put = await j('PUT', `/api/projects/${p.id}`, { name: 'hijack' }, bobCookie);
  assert.equal(put.statusCode, 403);
  assert.equal(put.json().error, 'forbidden');

  const del = await j('DELETE', `/api/projects/${p.id}`, undefined, bobCookie);
  assert.equal(del.statusCode, 403);
  assert.equal(del.json().error, 'forbidden');

  // Alice's project is untouched.
  assert.equal((await j('GET', `/api/projects/${p.id}`, undefined, aliceCookie)).statusCode, 200);
});

test('viewer grant on parent: bob creating a child is 403', async () => {
  const parent = (await j('POST', '/api/projects', { name: 'viewer-parent' }, aliceCookie)).json();
  await grant(parent.id, 'viewer');

  const child = await j('POST', '/api/projects', { name: 'child', parentId: parent.id }, bobCookie);
  assert.equal(child.statusCode, 403);
  assert.equal(child.json().error, 'forbidden');
});

test('editor grant: bob can PUT and DELETE the shared project', async () => {
  const p = (await j('POST', '/api/projects', { name: 'editor-shared' }, aliceCookie)).json();
  await grant(p.id, 'editor');

  const put = await j('PUT', `/api/projects/${p.id}`, { name: 'edited-by-bob' }, bobCookie);
  assert.equal(put.statusCode, 200);
  assert.equal(put.json().name, 'edited-by-bob');

  const del = await j('DELETE', `/api/projects/${p.id}`, undefined, bobCookie);
  assert.equal(del.statusCode, 204);
});

test('editor grant on parent: bob can create a child under it', async () => {
  const parent = (await j('POST', '/api/projects', { name: 'editor-parent' }, aliceCookie)).json();
  await grant(parent.id, 'editor');

  const child = await j('POST', '/api/projects', { name: 'child', parentId: parent.id }, bobCookie);
  assert.equal(child.statusCode, 201);
  assert.equal(child.json().parentId, parent.id);
});
