import assert from 'node:assert';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../src/db.js';
import { newId } from '../src/ids.js';
import { createUser } from '../src/seed.js';
import { buildTestApp, createAndLogin } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let db: DB;
let cookie: string;
let alice: { id: string };
let inboxId: string;

async function insertTask(
  owner: string,
  projectId: string | null,
  over: { title?: string; done?: 0 | 1 } = {},
) {
  const now = new Date().toISOString();
  const id = newId();
  await db
    .insertInto('tasks')
    .values({
      id,
      owner_id: owner,
      creator_id: owner,
      assignee_id: null,
      project_id: projectId,
      parent_id: null,
      title: over.title ?? 'task',
      done: over.done ?? 0,
      due: null,
      reminder: null,
      recurrence: null,
      notes: '',
      priority: 0,
      size: 0,
      position: 0,
      archived: 0,
      created_at: now,
      completed_at: over.done ? now : null,
      updated_at: now,
    })
    .execute();
  return id;
}

before(async () => {
  ctx = await buildTestApp();
  app = ctx.app;
  db = ctx.db;
  const li = await createAndLogin(app, db);
  cookie = li.cookie;
  alice = li.user;
  const boot = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { cookie } });
  inboxId = boot.json().projects.find((p: { name: string }) => p.name === 'inbox').id;
});
after(async () => {
  await app.close();
});

test('bootstrap returns the seeded inbox + system views (task + per-app), no tasks yet', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.projects.some((p: { name: string }) => p.name === 'inbox'));
  // 6 task views + 3 events views + 4 notes views (§2.4 per-app seed views)
  assert.equal(body.savedQueries.length, 13);
  assert.equal(
    body.savedQueries.filter((s: { query: string }) => s.query.includes('type:event')).length,
    3,
  );
  assert.equal(
    body.savedQueries.filter((s: { query: string }) => s.query.includes('type:note')).length,
    4,
  );
  assert.equal(body.tasks.length, 0);
});

test('query runs server-side, owner-scoped, with limit/offset', async () => {
  await insertTask(alice.id, inboxId, { title: 'open one', done: 0 });
  await insertTask(alice.id, inboxId, { title: 'done one', done: 1 });
  // a second user's task must not leak into alice's results
  const bob = await createUser(db, { username: 'bob', email: 'bob@x.com', password: 'B0b!secret' });
  await insertTask(bob.id, null, { title: 'bob task', done: 0 });

  const q = (query: string, extra: object = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/query',
      headers: { cookie },
      payload: { query, ...extra },
    });

  const open = await q('status:open');
  assert.equal(open.statusCode, 200);
  assert.equal(open.json().total, 1);
  assert.equal(open.json().items[0].title, 'open one');
  assert.equal(open.json().items[0].done, false);

  assert.equal((await q('status:done')).json().total, 1);
  assert.equal((await q('project:inbox')).json().total, 2);

  // limit slices items but total reflects the full match count
  const limited = await q('project:inbox', { limit: 1 });
  assert.equal(limited.json().total, 2);
  assert.equal(limited.json().items.length, 1);
});

test('bootstrap reflects the inserted tasks', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { cookie } });
  assert.equal(res.json().tasks.length, 2);
});
