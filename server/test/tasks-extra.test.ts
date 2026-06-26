import assert from 'node:assert';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { createUser } from '../src/seed.js';
import { PreconditionFailed } from '../src/services/concurrency.js';
import {
  archiveTask,
  assignTask,
  createTask,
  getTask,
  loadTask,
  updateTask,
} from '../src/services/tasks.js';
import { buildTestApp, createAndLogin } from './support/app.js';

const positionOf = (id: string) =>
  ctx.db
    .selectFrom('tasks')
    .select('position')
    .where('id', '=', id)
    .executeTakeFirstOrThrow()
    .then((r) => r.position);

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let cookie: string;
let bobCookie: string;
let aliceId: string;
let bobId: string;
let inboxId: string;

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
  inboxId = (await bootstrap()).projects.find((p: { name: string }) => p.name === 'inbox').id;
});
after(async () => {
  await app.close();
});

// ---- route: POST /api/tasks projectId branches -----------------------------

test('create task with no projectId skips the access check (201)', async () => {
  const res = await j('POST', '/api/tasks', { title: 'no project' });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().projectId, null);
});

test('create task into a project you cannot see returns 404', async () => {
  const proj = (await j('POST', '/api/projects', { name: 'alice-only' })).json();
  // bob cannot see alice's project → denyStatus 'none' → 404 'not found'
  const res = await j('POST', '/api/tasks', { title: 'sneaky', projectId: proj.id }, bobCookie);
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, 'not found');
});

test('create task into a project you can only read returns 403', async () => {
  const proj = (await j('POST', '/api/projects', { name: 'shared-ro' })).json();
  // grant bob viewer (read-only) on the project
  await ctx.db
    .insertInto('grants')
    .values({
      id: `g_${Math.random().toString(36).slice(2)}`,
      resource_type: 'project',
      resource_id: proj.id,
      principal_type: 'user',
      principal_id: bobId,
      role: 'viewer',
      created_at: new Date().toISOString(),
    })
    .execute();
  const res = await j('POST', '/api/tasks', { title: 'ro write', projectId: proj.id }, bobCookie);
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error, 'forbidden');
});

// ---- route: GET /api/tasks/:id ---------------------------------------------

test('GET unknown task id returns 404', async () => {
  const res = await j('GET', '/api/tasks/does-not-exist');
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, 'not found');
});

test('GET own task returns 200 with an etag header', async () => {
  const task = (await j('POST', '/api/tasks', { title: 'gettable' })).json();
  const res = await j('GET', `/api/tasks/${task.id}`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().id, task.id);
  assert.equal(res.headers.etag, `"${task.updatedAt}"`);
});

test("a second user cannot see another user's task (404)", async () => {
  const task = (await j('POST', '/api/tasks', { title: 'private' })).json();
  const res = await j('GET', `/api/tasks/${task.id}`, undefined, bobCookie);
  assert.equal(res.statusCode, 404);
});

// ---- route: PUT /api/tasks/:id ifMatch / 404 -------------------------------

test('PUT with a stale If-Match returns 412 with the current entity', async () => {
  const task = (await j('POST', '/api/tasks', { title: 'concurrent' })).json();
  const res = await app.inject({
    method: 'PUT',
    url: `/api/tasks/${task.id}`,
    headers: { cookie, 'if-match': '"bogus"' },
    payload: { title: 'wins?' },
  });
  assert.equal(res.statusCode, 412);
  const body = res.json();
  assert.equal(body.error, 'stale');
  assert.equal(body.current.id, task.id);
  assert.equal(body.current.title, 'concurrent'); // unchanged
});

test('PUT with a matching If-Match succeeds', async () => {
  const create = await j('POST', '/api/tasks', { title: 'matchme' });
  const task = create.json();
  const res = await app.inject({
    method: 'PUT',
    url: `/api/tasks/${task.id}`,
    headers: { cookie, 'if-match': `"${task.updatedAt}"` },
    payload: { title: 'matched' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().title, 'matched');
});

test('PUT a task a second user cannot write returns 404', async () => {
  const task = (await j('POST', '/api/tasks', { title: 'hands off' })).json();
  const res = await j('PUT', `/api/tasks/${task.id}`, { title: 'nope' }, bobCookie);
  assert.equal(res.statusCode, 404);
});

// ---- service: createTask defaults vs provided ------------------------------

test('createTask falls back to defaults when optionals are omitted', async () => {
  const t = await createTask(ctx.db, aliceId, { title: 'bare' });
  assert.equal(t.notes, '');
  assert.equal(t.priority, 0);
  assert.equal(t.size, 0);
  assert.equal(t.done, false);
  assert.equal(t.completedAt, null);
  assert.equal(t.projectId, null);
  assert.equal(t.parentId, null);
  assert.equal(t.assigneeId, null);
  assert.deepEqual(t.labels, []);
  assert.ok((await positionOf(t.id)) > 0);
});

test('createTask honors all provided optionals incl. explicit position and done', async () => {
  const due = '2026-07-01T00:00:00.000Z';
  const t = await createTask(ctx.db, aliceId, {
    id: 'fixed-id-task',
    title: 'loaded',
    projectId: inboxId,
    done: true,
    due,
    reminder: due,
    recurrence: 'FREQ=DAILY',
    notes: 'hello',
    priority: 3,
    size: 5,
    assigneeId: aliceId,
    position: 9999,
  });
  assert.equal(t.id, 'fixed-id-task');
  assert.equal(t.done, true);
  assert.ok(t.completedAt); // done → completed_at set
  assert.equal(await positionOf(t.id), 9999); // explicit position used (skips max() branch)
  assert.equal(t.notes, 'hello');
  assert.equal(t.priority, 3);
  assert.equal(t.size, 5);
  assert.equal(t.assigneeId, aliceId);
  assert.equal(t.recurrence, 'FREQ=DAILY');
});

test('createTask computes position from max when omitted (and bumps subsequent ones)', async () => {
  const u = await createUser(
    ctx.db,
    { username: 'solo', email: 'solo@example.com', password: 'Sup3r!secret' },
    { isAdmin: false },
  );
  const owner = u.id;
  // first task for a fresh owner: max() is null → ?? 0 → position 1
  const first = await createTask(ctx.db, owner, { title: 'first' });
  assert.equal(await positionOf(first.id), 1);
  const second = await createTask(ctx.db, owner, { title: 'second' });
  assert.equal(await positionOf(second.id), (await positionOf(first.id)) + 1);
});

test('createTask attaches only labels owned by the creator', async () => {
  const mine = (await j('POST', '/api/labels', { name: 'mine-extra' })).json();
  const t = await createTask(ctx.db, aliceId, {
    title: 'tagged-extra',
    labels: [mine.id, 'not-a-real-label'],
  });
  assert.deepEqual(t.labels, [mine.id]); // foreign/unknown id dropped
});

// ---- service: updateTask branches ------------------------------------------

test('updateTask returns null for a missing task', async () => {
  const res = await updateTask(ctx.db, 'ghost-task', { title: 'x' });
  assert.equal(res, null);
});

test('updateTask throws PreconditionFailed on a stale If-Match', async () => {
  const t = await createTask(ctx.db, aliceId, { title: 'opt' });
  await assert.rejects(
    () => updateTask(ctx.db, t.id, { title: 'y' }, '"stale"'),
    PreconditionFailed,
  );
});

test('updateTask done toggling sets and clears completedAt', async () => {
  const t = await createTask(ctx.db, aliceId, { title: 'toggle' });
  const done = await updateTask(ctx.db, t.id, { done: true });
  assert.ok(done?.completedAt);
  const stamp = done?.completedAt;
  // staying done keeps the original completedAt (row.completed_at ?? now)
  const stillDone = await updateTask(ctx.db, t.id, { done: true, title: 'renamed' });
  assert.equal(stillDone?.completedAt, stamp);
  // un-done clears it
  const undone = await updateTask(ctx.db, t.id, { done: false });
  assert.equal(undone?.completedAt, null);
});

test('updateTask applies every optional field branch', async () => {
  const child = await createTask(ctx.db, aliceId, { title: 'a parent' });
  const due = '2026-08-01T00:00:00.000Z';
  const lbl = (await j('POST', '/api/labels', { name: 'upd-label' })).json();
  const upd = await updateTask(ctx.db, child.id, {
    title: 'patched',
    projectId: inboxId,
    parentId: null,
    due,
    reminder: due,
    recurrence: 'FREQ=WEEKLY',
    notes: 'notes',
    priority: 2,
    size: 4,
    assigneeId: aliceId,
    position: 42,
    labels: [lbl.id],
  });
  assert.equal(upd?.title, 'patched');
  assert.equal(upd?.projectId, inboxId);
  assert.equal(upd?.due, due);
  assert.equal(upd?.reminder, due);
  assert.equal(upd?.recurrence, 'FREQ=WEEKLY');
  assert.equal(upd?.notes, 'notes');
  assert.equal(upd?.priority, 2);
  assert.equal(upd?.size, 4);
  assert.equal(upd?.assigneeId, aliceId);
  assert.equal(await positionOf(child.id), 42);
  assert.deepEqual(upd?.labels, [lbl.id]);
  // clearing labels takes the empty-labels branch in setTaskLabels
  const cleared = await updateTask(ctx.db, child.id, { labels: [] });
  assert.deepEqual(cleared?.labels, []);
});

// ---- service: assignTask branches ------------------------------------------

test('assignTask returns badAssignee for an unknown user', async () => {
  const t = await createTask(ctx.db, aliceId, { title: 'assignable' });
  const res = await assignTask(ctx.db, t.id, 'no-such-user');
  assert.equal(res, 'badAssignee');
});

test('assignTask returns null when the task is missing', async () => {
  const res = await assignTask(ctx.db, 'ghost', null);
  assert.equal(res, null);
});

test('assignTask sets and clears a valid assignee', async () => {
  const t = await createTask(ctx.db, aliceId, { title: 'assign me' });
  const assigned = await assignTask(ctx.db, t.id, bobId);
  assert.notEqual(assigned, 'badAssignee');
  assert.equal((assigned as { assigneeId: string }).assigneeId, bobId);
  const cleared = await assignTask(ctx.db, t.id, null); // null skips the user lookup
  assert.equal((cleared as { assigneeId: string | null }).assigneeId, null);
});

// ---- service: archiveTask branches -----------------------------------------

test('archiveTask on an unknown id is a no-op', async () => {
  await assert.doesNotReject(() => archiveTask(ctx.db, 'nope'));
});

test('archiveTask cascades to the whole subtree', async () => {
  const root = await createTask(ctx.db, aliceId, { title: 'root' });
  const childA = await createTask(ctx.db, aliceId, { title: 'childA', parentId: root.id });
  const grand = await createTask(ctx.db, aliceId, { title: 'grand', parentId: childA.id });
  const sibling = await createTask(ctx.db, aliceId, { title: 'unrelated' });

  await archiveTask(ctx.db, root.id);

  const boot = await bootstrap();
  const ids = new Set(boot.tasks.map((t: { id: string }) => t.id));
  assert.ok(!ids.has(root.id));
  assert.ok(!ids.has(childA.id));
  assert.ok(!ids.has(grand.id)); // grandchild cascaded too
  assert.ok(ids.has(sibling.id)); // unrelated task untouched
});

// ---- service: getTask / loadTask null --------------------------------------

test('getTask / loadTask return null for an unknown id', async () => {
  assert.equal(await getTask(ctx.db, 'missing'), null);
  assert.equal(await loadTask(ctx.db, 'missing'), null);
});
