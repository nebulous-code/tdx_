import assert from 'node:assert';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, createAndLogin } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let cookie: string;
let inboxId: string;

const j = (method: string, url: string, payload?: object) =>
  app.inject({
    method: method as 'GET',
    url,
    headers: { cookie },
    ...(payload ? { payload } : {}),
  });

async function bootstrap() {
  return (await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { cookie } })).json();
}

before(async () => {
  ctx = await buildTestApp();
  app = ctx.app;
  ({ cookie } = await createAndLogin(app, ctx.db));
  inboxId = (await bootstrap()).projects.find((p: { name: string }) => p.name === 'inbox').id;
});
after(async () => {
  await app.close();
});

test('task create / read / update / archive', async () => {
  const created = await j('POST', '/api/tasks', { title: 'write tests', projectId: inboxId });
  assert.equal(created.statusCode, 201);
  const task = created.json();
  assert.equal(task.title, 'write tests');
  assert.equal(task.done, false);
  assert.ok(created.headers.etag);

  const got = await j('GET', `/api/tasks/${task.id}`);
  assert.equal(got.statusCode, 200);
  assert.equal(got.json().id, task.id);

  const upd = await j('PUT', `/api/tasks/${task.id}`, { title: 'write more tests', done: true });
  assert.equal(upd.statusCode, 200);
  assert.equal(upd.json().title, 'write more tests');
  assert.equal(upd.json().done, true);
  assert.ok(upd.json().completedAt);

  assert.ok((await bootstrap()).tasks.some((t: { id: string }) => t.id === task.id));

  const del = await j('DELETE', `/api/tasks/${task.id}`);
  assert.equal(del.statusCode, 204);
  assert.ok(!(await bootstrap()).tasks.some((t: { id: string }) => t.id === task.id));
});

test('project archive cascades to its tasks', async () => {
  const proj = (await j('POST', '/api/projects', { name: 'work' })).json();
  const t = (await j('POST', '/api/tasks', { title: 'in work', projectId: proj.id })).json();
  assert.ok((await bootstrap()).tasks.some((x: { id: string }) => x.id === t.id));

  const del = await j('DELETE', `/api/projects/${proj.id}`);
  assert.equal(del.statusCode, 204);
  const boot = await bootstrap();
  assert.ok(!boot.projects.some((p: { id: string }) => p.id === proj.id));
  assert.ok(!boot.tasks.some((x: { id: string }) => x.id === t.id)); // cascaded
});

test('label create / update / attach / delete strips from tasks', async () => {
  const label = (await j('POST', '/api/labels', { name: 'urgent' })).json();
  assert.equal(label.pinned, false);
  const pinned = await j('PUT', `/api/labels/${label.id}`, { pinned: true });
  assert.equal(pinned.json().pinned, true);

  const t = (
    await j('POST', '/api/tasks', { title: 'tagged', projectId: inboxId, labels: [label.id] })
  ).json();
  assert.deepEqual(t.labels, [label.id]);

  const del = await j('DELETE', `/api/labels/${label.id}`);
  assert.equal(del.statusCode, 204);
  // task survives, label stripped
  const got = await j('GET', `/api/tasks/${t.id}`);
  assert.deepEqual(got.json().labels, []);
});

test('label merge folds one into another (deduped)', async () => {
  const a = (await j('POST', '/api/labels', { name: 'bug' })).json();
  const b = (await j('POST', '/api/labels', { name: 'defect' })).json();
  const t = (
    await j('POST', '/api/tasks', { title: 'both', projectId: inboxId, labels: [a.id, b.id] })
  ).json();

  const merge = await j('POST', '/api/labels/merge', { from: a.id, to: b.id });
  assert.equal(merge.statusCode, 200);

  const got = await j('GET', `/api/tasks/${t.id}`);
  assert.deepEqual(got.json().labels, [b.id]); // deduped to the survivor
  assert.ok(!(await bootstrap()).labels.some((l: { id: string }) => l.id === a.id));
});

test('saved-query create / update / delete', async () => {
  const sv = (
    await j('POST', '/api/saved-queries', { name: 'My open', query: 'status:open' })
  ).json();
  assert.equal(sv.system, false);
  const upd = await j('PUT', `/api/saved-queries/${sv.id}`, { name: 'Open!' });
  assert.equal(upd.json().name, 'Open!');
  const del = await j('DELETE', `/api/saved-queries/${sv.id}`);
  assert.equal(del.statusCode, 204);
  assert.ok(!(await bootstrap()).savedQueries.some((s: { id: string }) => s.id === sv.id));
});

test('a read-only PAT cannot create a task (403)', async () => {
  const tok = (await j('POST', '/api/auth/tokens', { name: 'ro', scopes: ['tasks:read'] })).json()
    .token;
  const res = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: { authorization: `Bearer ${tok}` },
    payload: { title: 'nope', projectId: inboxId },
  });
  assert.equal(res.statusCode, 403);
});
