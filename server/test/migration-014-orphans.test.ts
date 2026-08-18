// migration 014 — the one-time backfill that closes orphaned open subtasks left behind
// before completion cascaded (t_0687). buildTestApp already ran every migration on an empty
// DB (so 014 was a no-op); here we seed orphans and re-run the migration SQL (it's idempotent
// by its `done=0` filter) to assert the backfill closes open descendants of done tasks at all
// depths while leaving already-done rows and unrelated tasks alone.

import assert from 'node:assert';
import fs from 'node:fs';
import { after, before, test } from 'node:test';
import type { DB } from '../src/db.js';
import { newId } from '../src/ids.js';
import { buildTestApp, createAndLogin } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let db: DB;
let owner: string;

async function ins(over: {
  parent?: string | null;
  done?: 0 | 1;
  completedAt?: string | null;
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
      title: 't',
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
      completed_at: over.completedAt ?? null,
      updated_at: now,
    })
    .execute();
  return id;
}

before(async () => {
  ctx = await buildTestApp();
  db = ctx.db;
  const li = await createAndLogin(ctx.app, db);
  owner = li.user.id;
});
after(async () => {
  await ctx.app.close();
});

test('014 closes open descendants of done tasks at every depth, leaving others untouched', async () => {
  const doneParent = await ins({ done: 1 });
  const openChild = await ins({ parent: doneParent });
  const openGrandchild = await ins({ parent: openChild }); // depth 2 — parent itself is open
  const alreadyDoneChild = await ins({
    parent: doneParent,
    done: 1,
    completedAt: '2020-01-01T00:00:00.000Z',
  });
  const openParent = await ins({ done: 0 });
  const childOfOpen = await ins({ parent: openParent }); // parent open → must stay open
  const rootless = await ins({}); // unrelated top-level open task

  const sql = fs.readFileSync(
    new URL('../migrations/014_close_orphaned_subtasks.sql', import.meta.url),
    'utf8',
  );
  ctx.sqlite.exec(sql);

  const rows = await db
    .selectFrom('tasks')
    .select(['id', 'done', 'completed_at'])
    .where('id', 'in', [openChild, openGrandchild, alreadyDoneChild, childOfOpen, rootless])
    .execute();
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));

  assert.equal(by[openChild].done, 1, 'open child of a done parent is closed');
  assert.equal(by[openGrandchild].done, 1, 'open grandchild (open middle) is closed too');
  assert.equal(by[alreadyDoneChild].done, 1, 'already-done child stays done');
  assert.equal(
    by[alreadyDoneChild].completed_at,
    '2020-01-01T00:00:00.000Z',
    'already-done child keeps its completed_at',
  );
  assert.equal(by[childOfOpen].done, 0, 'child of an OPEN parent is left open');
  assert.equal(by[rootless].done, 0, 'unrelated top-level task is left open');

  // idempotent: no orphans remain, so a second run changes nothing
  const orphansBefore = ctx.sqlite
    .prepare(
      'SELECT count(*) c FROM tasks WHERE done=0 AND parent_id IN (SELECT id FROM tasks WHERE done=1)',
    )
    .get() as { c: number };
  assert.equal(orphansBefore.c, 0, 'no direct-child orphans remain after the backfill');
});
