import assert from 'node:assert';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { newId } from '../src/ids.js';
import { archiveProject } from '../src/services/projects.js';
import { buildTestApp, createAndLogin } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let cookie: string; // alice
let bobCookie: string; // a second user (no access to alice's data)

const j = (method: string, url: string, payload?: object, c: string = cookie) =>
  app.inject({
    method: method as 'GET',
    url,
    headers: { cookie: c },
    ...(payload ? { payload } : {}),
  });

before(async () => {
  ctx = await buildTestApp();
  app = ctx.app;
  ({ cookie } = await createAndLogin(app, ctx.db));
  ({ cookie: bobCookie } = await createAndLogin(
    app,
    ctx.db,
    { username: 'bob', email: 'bob@example.com', password: 'Sup3r!secret' },
    { isAdmin: false },
  ));
});
after(async () => {
  await app.close();
});

test('create applies defaults; explicit fields are honored', async () => {
  const def = await j('POST', '/api/projects', { name: 'plain' });
  assert.equal(def.statusCode, 201);
  assert.ok(def.headers.etag);
  const dp = def.json();
  assert.equal(dp.color, '#ffb000'); // default amber
  assert.equal(dp.glyph, '●');
  assert.equal(dp.collapsed, false);
  assert.deepEqual(dp.health, []);
  assert.equal(dp.parentId, null);

  const full = await j('POST', '/api/projects', {
    name: 'fancy',
    color: '#abcdef',
    glyph: '★',
    collapsed: true,
    health: ['mind', 'body'],
    position: 9,
  });
  const fp = full.json();
  assert.equal(fp.color, '#abcdef');
  assert.equal(fp.glyph, '★');
  assert.equal(fp.collapsed, true);
  assert.deepEqual(fp.health, ['mind', 'body']);
  assert.equal(fp.position, 9);
});

test('create under a valid parent succeeds; bad/forbidden parent is rejected', async () => {
  const parent = (await j('POST', '/api/projects', { name: 'parent' })).json();
  const child = await j('POST', '/api/projects', { name: 'child', parentId: parent.id });
  assert.equal(child.statusCode, 201);
  assert.equal(child.json().parentId, parent.id);

  // parent that doesn't exist → 404 (invisible)
  const ghost = await j('POST', '/api/projects', { name: 'orphan', parentId: newId() });
  assert.equal(ghost.statusCode, 404);

  // parent owned by someone else → 404 (not leaked as 403)
  const bobProj = (await j('POST', '/api/projects', { name: 'bob root' }, bobCookie)).json();
  const cross = await j('POST', '/api/projects', { name: 'sneaky', parentId: bobProj.id });
  assert.equal(cross.statusCode, 404);
});

test('get returns the project; 404 for missing and for another user', async () => {
  const p = (await j('POST', '/api/projects', { name: 'gettable' })).json();
  const got = await j('GET', `/api/projects/${p.id}`);
  assert.equal(got.statusCode, 200);
  assert.equal(got.json().id, p.id);
  assert.ok(got.headers.etag);

  assert.equal((await j('GET', `/api/projects/${newId()}`)).statusCode, 404);
  assert.equal((await j('GET', `/api/projects/${p.id}`, undefined, bobCookie)).statusCode, 404);
});

test('update edits fields and bumps the etag', async () => {
  const p = (await j('POST', '/api/projects', { name: 'before' })).json();
  const upd = await j('PUT', `/api/projects/${p.id}`, {
    name: 'after',
    color: '#111111',
    glyph: '◆',
    collapsed: true,
    position: 3,
    health: ['focus'],
  });
  assert.equal(upd.statusCode, 200);
  const up = upd.json();
  assert.equal(up.name, 'after');
  assert.equal(up.color, '#111111');
  assert.equal(up.glyph, '◆');
  assert.equal(up.collapsed, true);
  assert.equal(up.position, 3);
  assert.deepEqual(up.health, ['focus']);
  assert.notEqual(upd.headers.etag, undefined);
});

test('update is 404 for missing and a stale If-Match is 412', async () => {
  assert.equal((await j('PUT', `/api/projects/${newId()}`, { name: 'x' })).statusCode, 404);

  const p = (await j('POST', '/api/projects', { name: 'concur' })).json();
  const stale = await app.inject({
    method: 'PUT',
    url: `/api/projects/${p.id}`,
    headers: { cookie, 'if-match': '"not-the-current-etag"' },
    payload: { name: 'nope' },
  });
  assert.equal(stale.statusCode, 412);
  assert.equal(stale.json().error, 'stale');
  assert.equal(stale.json().current.id, p.id);
});

test('delete archives the project, its subtree, and all their tasks', async () => {
  const root = (await j('POST', '/api/projects', { name: 'tree root' })).json();
  const sub = (await j('POST', '/api/projects', { name: 'tree sub', parentId: root.id })).json();
  const tRoot = (await j('POST', '/api/tasks', { title: 'at root', projectId: root.id })).json();
  const tSub = (await j('POST', '/api/tasks', { title: 'at sub', projectId: sub.id })).json();

  const del = await j('DELETE', `/api/projects/${root.id}`);
  assert.equal(del.statusCode, 204);

  // the whole subtree (both projects + both tasks) is archived → absent from bootstrap,
  // the live read that filters archived rows
  const boot = (await j('GET', '/api/bootstrap')).json();
  assert.ok(!boot.projects.some((p: { id: string }) => p.id === root.id));
  assert.ok(!boot.projects.some((p: { id: string }) => p.id === sub.id));
  assert.ok(!boot.tasks.some((t: { id: string }) => t.id === tRoot.id));
  assert.ok(!boot.tasks.some((t: { id: string }) => t.id === tSub.id));
});

test("delete another user's project is 404", async () => {
  const bobProj = (await j('POST', '/api/projects', { name: 'bob private' }, bobCookie)).json();
  assert.equal((await j('DELETE', `/api/projects/${bobProj.id}`)).statusCode, 404);
  // still there for bob
  assert.equal(
    (await j('GET', `/api/projects/${bobProj.id}`, undefined, bobCookie)).statusCode,
    200,
  );
});

test('archiveProject on a missing id is a no-op (service guard)', async () => {
  await assert.doesNotReject(archiveProject(ctx.db, newId()));
});
