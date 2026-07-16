import assert from 'node:assert';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, createAndLogin } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let cookie: string;
let bobCookie: string;
let aliceId: string;
let bobId: string;

const j = (method: string, url: string, payload?: object, c: string = cookie) =>
  app.inject({
    method: method as 'GET',
    url,
    headers: { cookie: c },
    ...(payload ? { payload } : {}),
  });

async function bootstrap(c: string = cookie) {
  return (
    await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { cookie: c } })
  ).json();
}

// a read-only PAT (tasks:read) for the current cookie's user
async function readOnlyToken(c: string = cookie): Promise<string> {
  return (await j('POST', '/api/auth/tokens', { name: 'ro', scopes: ['tasks:read'] }, c)).json()
    .token;
}

before(async () => {
  ctx = await buildTestApp();
  app = ctx.app;
  const alice = await createAndLogin(app, ctx.db);
  cookie = alice.cookie;
  aliceId = alice.user.id;
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

// ---- POST /api/tasks/:id/assign --------------------------------------------

test('assign a task to a valid user returns the updated task', async () => {
  const task = (await j('POST', '/api/tasks', { title: 'assignable' })).json();
  const res = await j('POST', `/api/tasks/${task.id}/assign`, { assigneeId: bobId });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().id, task.id);
  assert.equal(res.json().assigneeId, bobId);
});

// The AssignSchema's `string | null` union gets ajv-coerced so a JSON `null` arrives at the
// handler as '' — assignTask normalizes that empty value back to NULL, so clearing an
// assignee through the route works (no FK error).
test('assign with a null assigneeId clears the assignee (200)', async () => {
  const task = (await j('POST', '/api/tasks', { title: 'clear me', assigneeId: bobId })).json();
  assert.equal(task.assigneeId, bobId);
  const res = await j('POST', `/api/tasks/${task.id}/assign`, { assigneeId: null });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().assigneeId, null);
});

test('assign to a nonexistent user returns 400 badAssignee', async () => {
  const task = (await j('POST', '/api/tasks', { title: 'bad assignee' })).json();
  const res = await j('POST', `/api/tasks/${task.id}/assign`, { assigneeId: 'no-such-user' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, 'assignee does not exist');
  assert.equal(res.json().field, 'assigneeId');
});

test('assign on a missing task returns 404', async () => {
  const res = await j('POST', '/api/tasks/ghost-task/assign', { assigneeId: aliceId });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, 'not found');
});

test('assign without write scope (read-only PAT) returns 403', async () => {
  const task = (await j('POST', '/api/tasks', { title: 'ro assign' })).json();
  const tok = await readOnlyToken();
  const res = await app.inject({
    method: 'POST',
    url: `/api/tasks/${task.id}/assign`,
    headers: { authorization: `Bearer ${tok}` },
    payload: { assigneeId: bobId },
  });
  assert.equal(res.statusCode, 403);
});

test("assign another user's task returns 404", async () => {
  const task = (await j('POST', '/api/tasks', { title: 'alice private' })).json();
  const res = await j('POST', `/api/tasks/${task.id}/assign`, { assigneeId: bobId }, bobCookie);
  assert.equal(res.statusCode, 404);
});

// ---- POST /api/tasks/:id/complete ------------------------------------------

test('complete a non-recurring task marks it done with no created occurrences', async () => {
  const task = (await j('POST', '/api/tasks', { title: 'one-off' })).json();
  assert.equal(task.done, false);
  const res = await j('POST', `/api/tasks/${task.id}/complete`);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.task.id, task.id);
  assert.equal(body.task.done, true);
  assert.ok(body.task.completedAt);
  assert.deepEqual(body.created, []);
});

test('complete a recurring task spawns the next occurrence', async () => {
  const task = (
    await j('POST', '/api/tasks', {
      title: 'daily standup',
      recurrence: 'daily',
      due: '2026-06-25',
    })
  ).json();
  const res = await j('POST', `/api/tasks/${task.id}/complete`);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  // completed original
  assert.equal(body.task.id, task.id);
  assert.equal(body.task.done, true);
  assert.ok(body.task.completedAt);
  // one fresh, unchecked occurrence with the next due date
  assert.equal(body.created.length, 1);
  const next = body.created[0];
  assert.notEqual(next.id, task.id);
  assert.equal(next.done, false);
  assert.equal(next.completedAt, null);
  assert.equal(next.recurrence, 'daily');
  assert.equal(next.title, 'daily standup');
  assert.notEqual(next.due, task.due);
  // the new occurrence is live in bootstrap; the completed one is too
  const boot = await bootstrap();
  const ids = new Set(boot.tasks.map((t: { id: string }) => t.id));
  assert.ok(ids.has(next.id));
});

test('complete a recurring task also clones its subtask subtree (unchecked)', async () => {
  const root = (
    await j('POST', '/api/tasks', {
      title: 'weekly review',
      recurrence: 'daily',
      due: '2026-06-25',
    })
  ).json();
  await j('POST', '/api/tasks', { title: 'sub', parentId: root.id });

  const res = await j('POST', `/api/tasks/${root.id}/complete`);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  // a fresh root clone plus a fresh subtask clone
  assert.equal(body.created.length, 2);
  for (const c of body.created) {
    assert.equal(c.done, false);
    assert.equal(c.completedAt, null);
  }
});

test('complete a missing task returns 404', async () => {
  const res = await j('POST', '/api/tasks/ghost-complete/complete');
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, 'not found');
});

test('complete without write scope (read-only PAT) returns 403', async () => {
  const task = (await j('POST', '/api/tasks', { title: 'ro complete' })).json();
  const tok = await readOnlyToken();
  const res = await app.inject({
    method: 'POST',
    url: `/api/tasks/${task.id}/complete`,
    headers: { authorization: `Bearer ${tok}` },
  });
  assert.equal(res.statusCode, 403);
});

test("complete another user's task returns 404", async () => {
  const task = (await j('POST', '/api/tasks', { title: 'alice-only complete' })).json();
  const res = await j('POST', `/api/tasks/${task.id}/complete`, undefined, bobCookie);
  assert.equal(res.statusCode, 404);
});
