// Recurrence-spawn parity: asserts the invariants the JS Tier-2 golden
// (test/goldens/store.spawn.json) already validated — completing a recurring task
// spawns the next occurrence (correct due / reminder-gap) plus a fresh, unchecked
// clone of the whole subtask subtree. Driven through the service to inspect
// `created`, then once over HTTP. Due dates drive the math (clock-independent).

import assert from 'node:assert';
import { after, before, test } from 'node:test';
import type { DB } from '../src/db.js';
import { newId } from '../src/ids.js';
import { completeTask } from '../src/services/recurrence.js';
import { buildTestApp, createAndLogin } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let db: DB;
let cookie: string;
let owner: string;

async function ins(over: {
  title?: string;
  recurrence?: string | null;
  due?: string | null;
  reminder?: string | null;
  parent?: string | null;
  position?: number;
  done?: 0 | 1;
}): Promise<string> {
  const id = newId();
  const now = new Date().toISOString();
  await db
    .insertInto('tasks')
    .values({
      id,
      owner_id: owner,
      creator_id: owner,
      assignee_id: null,
      project_id: null,
      parent_id: over.parent ?? null,
      title: over.title ?? 't',
      done: over.done ?? 0,
      due: over.due ?? null,
      reminder: over.reminder ?? null,
      recurrence: over.recurrence ?? null,
      notes: '',
      priority: 0,
      size: 0,
      position: over.position ?? 0,
      archived: 0,
      created_at: now,
      completed_at: null,
      updated_at: now,
    })
    .execute();
  return id;
}

before(async () => {
  ctx = await buildTestApp();
  db = ctx.db;
  const li = await createAndLogin(ctx.app, db);
  cookie = li.cookie;
  owner = li.user.id;
});
after(async () => {
  await ctx.app.close();
});

test('weekly task with a subtree → next occurrence + fresh unchecked subtree', async () => {
  const t1 = await ins({ title: 't1', recurrence: 'weekly on mon,wed,fri', due: '2026-06-18' });
  await ins({ title: 's1', parent: t1, position: 0 });
  await ins({ title: 's2', parent: t1, position: 1, done: 1 }); // a completed subtask
  await ins({ title: 's3', parent: t1, position: 2 });

  const res = (await completeTask(db, t1))!;
  assert.equal(res.task.done, true);
  assert.equal(res.created.length, 4); // root + 3 subtasks

  const root = res.created.find((c) => c.parentId === null)!;
  assert.equal(root.title, 't1');
  assert.equal(root.due, '2026-06-19'); // next Fri after Thu 6-18
  assert.equal(root.recurrence, 'weekly on mon,wed,fri');
  assert.equal(root.done, false);

  const subs = res.created.filter((c) => c.parentId === root.id);
  assert.equal(subs.length, 3);
  assert.ok(subs.every((s) => s.done === false)); // all reset to unchecked
  assert.deepEqual(subs.map((s) => s.title).sort(), ['s1', 's2', 's3']);
});

test('every-3-days advances the due date by the interval', async () => {
  const h3 = await ins({ title: 'h3', recurrence: 'every 3 days', due: '2026-06-18' });
  const res = (await completeTask(db, h3))!;
  assert.equal(res.created.length, 1);
  assert.equal(res.created[0].due, '2026-06-21');
});

test('monthly task preserves the reminder day-gap', async () => {
  const m1 = await ins({
    title: 'm1',
    recurrence: 'monthly on day 1',
    due: '2026-06-17',
    reminder: '2026-06-15',
  });
  const res = (await completeTask(db, m1))!;
  assert.equal(res.created.length, 1);
  assert.equal(res.created[0].due, '2026-07-01');
  assert.equal(res.created[0].reminder, '2026-06-29'); // gap of -2 days preserved
});

test('a non-recurring task spawns nothing', async () => {
  const t2 = await ins({ title: 't2', due: '2026-06-19' });
  const res = (await completeTask(db, t2))!;
  assert.equal(res.task.done, true);
  assert.equal(res.created.length, 0);
});

test('POST /complete and /assign over HTTP', async () => {
  const t = (
    await ctx.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { cookie },
      payload: { title: 'recurring', recurrence: 'daily', due: '2026-06-18' },
    })
  ).json();

  const done = await ctx.app.inject({
    method: 'POST',
    url: `/api/tasks/${t.id}/complete`,
    headers: { cookie },
  });
  assert.equal(done.statusCode, 200);
  assert.equal(done.json().task.done, true);
  assert.equal(done.json().created[0].due, '2026-06-19');

  const assign = await ctx.app.inject({
    method: 'POST',
    url: `/api/tasks/${t.id}/assign`,
    headers: { cookie },
    payload: { assigneeId: owner },
  });
  assert.equal(assign.statusCode, 200);
  assert.equal(assign.json().assigneeId, owner);

  const bad = await ctx.app.inject({
    method: 'POST',
    url: `/api/tasks/${t.id}/assign`,
    headers: { cookie },
    payload: { assigneeId: 'does-not-exist' },
  });
  assert.equal(bad.statusCode, 400);
});
