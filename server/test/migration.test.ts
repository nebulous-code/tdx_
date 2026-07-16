// migration.test.ts — the CI migration test. Seed an in-memory DB in the LEGACY
// shape (composite (user_id,id) PKs, prefixed ids, an archived row, a subtask, a
// multi-label task), run the migration, and assert: every row survives (incl.
// archived); every remapped parent/project/task_label ref resolves to a real new
// UUID; owner_id = creator_id; prefs carried; no grants.

import assert from 'node:assert';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { migrateFromLegacy } from '../scripts/migrate-from-legacy.js';
import { openDatabase } from '../src/db.js';
import { GLYPHS } from '../src/glyphs.js';

function seedLegacy(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, username TEXT, email TEXT, password_hash TEXT,
      state_version INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT,
      theme TEXT, week_start INTEGER DEFAULT 1, sort_prefs TEXT,
      is_admin INTEGER DEFAULT 0, fib_sizing INTEGER DEFAULT 0
    );
    CREATE TABLE projects (
      user_id TEXT, id TEXT, parent_id TEXT, name TEXT, color TEXT, glyph TEXT,
      collapsed INTEGER DEFAULT 0, position INTEGER DEFAULT 0, archived INTEGER DEFAULT 0,
      health TEXT DEFAULT '[]', PRIMARY KEY (user_id, id)
    );
    CREATE TABLE tasks (
      user_id TEXT, id TEXT, project_id TEXT, parent_id TEXT, title TEXT,
      done INTEGER DEFAULT 0, due TEXT, reminder TEXT, recurrence TEXT, notes TEXT DEFAULT '',
      priority INTEGER DEFAULT 0, size INTEGER DEFAULT 0, created_at TEXT, completed_at TEXT,
      position INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, PRIMARY KEY (user_id, id)
    );
    CREATE TABLE labels (
      user_id TEXT, id TEXT, name TEXT, pinned INTEGER DEFAULT 0, PRIMARY KEY (user_id, id)
    );
    CREATE TABLE task_labels (
      user_id TEXT, task_id TEXT, label_id TEXT, PRIMARY KEY (user_id, task_id, label_id)
    );
    CREATE TABLE saved_queries (
      user_id TEXT, id TEXT, name TEXT, glyph TEXT, query TEXT, system INTEGER DEFAULT 0,
      color TEXT, position INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0, PRIMARY KEY (user_id, id)
    );
  `);

  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, theme, week_start, sort_prefs, is_admin, fib_sizing, created_at, updated_at)
     VALUES ('u1', 'alice', 'alice@example.com', 'hash', 'matrix', 0, '{"order":["due"]}', 1, 1, '2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z')`,
  ).run();

  const proj = db.prepare(
    'INSERT INTO projects (user_id, id, parent_id, name, color, glyph, archived) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  proj.run('u1', 'p_inbox', null, 'inbox', '#ffb000', '⌂', 0);
  proj.run('u1', 'p_dev', null, 'dev', '#46d369', 'λ', 0);
  proj.run('u1', 'p_sub', 'p_dev', 'sub', '#3fd7d7', '◈', 0); // nested
  proj.run('u1', 'p_arch', null, 'archived-proj', '#ff5c5c', '✗', 1); // archived

  const label = db.prepare('INSERT INTO labels (user_id, id, name, pinned) VALUES (?, ?, ?, ?)');
  label.run('u1', 'l_a', 'urgent', 1);
  label.run('u1', 'l_b', 'bug', 0);

  const task = db.prepare(
    'INSERT INTO tasks (user_id, id, project_id, parent_id, title, done, due, created_at, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  task.run('u1', 't1', 'p_dev', null, 'root task', 0, '2026-06-18', '2026-06-01', 0);
  task.run('u1', 't2', 'p_dev', 't1', 'subtask', 0, null, '2026-06-02', 0); // subtask of t1
  task.run('u1', 't3', 'p_inbox', null, 'archived task', 1, null, '2026-05-01', 1); // archived
  task.run('u1', 't4', 'p_sub', null, 'multi-label task', 0, null, '2026-06-03', 0);

  const tl = db.prepare('INSERT INTO task_labels (user_id, task_id, label_id) VALUES (?, ?, ?)');
  tl.run('u1', 't1', 'l_a');
  tl.run('u1', 't4', 'l_a');
  tl.run('u1', 't4', 'l_b');

  db.prepare(
    "INSERT INTO saved_queries (user_id, id, name, glyph, query, system, position, pinned) VALUES ('u1', 'sv_today', 'Today', '☉', 'status:open due:today', 1, 0, 0)",
  ).run();

  return db;
}

const rows = (db: Database.Database, sql: string): any[] => db.prepare(sql).all() as any[];
const count = (db: Database.Database, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
const isUuid = (s: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);

test('migration: legacy prefixed ids -> UUIDs, survival + ref integrity', () => {
  const legacy = seedLegacy();
  const { sqlite: target } = openDatabase(':memory:');
  const stats = migrateFromLegacy(legacy, target);

  // ---- counts survive (incl. archived) ----
  assert.deepEqual(stats, {
    users: 1,
    projects: 4,
    tasks: 4,
    labels: 2,
    taskLabels: 3,
    savedQueries: 1,
  });
  assert.equal(count(target, 'projects'), 4); // p_arch archived row preserved
  assert.equal(count(target, 'tasks'), 4); // t3 archived row preserved
  assert.equal(count(target, 'task_labels'), 3);
  assert.equal(count(target, 'grants'), 0); // default private

  // ---- archived flags preserved ----
  const projByName = new Map(rows(target, 'SELECT * FROM projects').map((p) => [p.name, p]));
  assert.equal(projByName.get('archived-proj').archived, 1);
  const archTask = rows(target, 'SELECT * FROM tasks').find((t) => t.title === 'archived task');
  assert.equal(archTask.archived, 1);

  // ---- ids are UUIDs, not the legacy prefixed form ----
  const allIds = [
    ...rows(target, 'SELECT id FROM projects'),
    ...rows(target, 'SELECT id FROM tasks'),
    ...rows(target, 'SELECT id FROM labels'),
    ...rows(target, 'SELECT id FROM saved_queries'),
    ...rows(target, 'SELECT id FROM users'),
  ].map((r) => r.id);
  for (const id of allIds) assert.ok(isUuid(id), `expected UUID, got "${id}"`);

  // ---- ref integrity: every parent/project/task_label points at a real new id ----
  const userIds = new Set(rows(target, 'SELECT id FROM users').map((r) => r.id));
  const projIds = new Set(rows(target, 'SELECT id FROM projects').map((r) => r.id));
  const taskIds = new Set(rows(target, 'SELECT id FROM tasks').map((r) => r.id));
  const labelIds = new Set(rows(target, 'SELECT id FROM labels').map((r) => r.id));

  for (const p of rows(target, 'SELECT * FROM projects')) {
    assert.ok(userIds.has(p.owner_id));
    if (p.parent_id) assert.ok(projIds.has(p.parent_id), 'project parent_id resolves');
  }
  for (const t of rows(target, 'SELECT * FROM tasks')) {
    assert.ok(userIds.has(t.owner_id));
    assert.equal(t.owner_id, t.creator_id); // owner = creator
    assert.equal(t.assignee_id, null); // unassigned
    if (t.project_id) assert.ok(projIds.has(t.project_id), 'task project_id resolves');
    if (t.parent_id) assert.ok(taskIds.has(t.parent_id), 'task parent_id resolves');
  }
  for (const tl of rows(target, 'SELECT * FROM task_labels')) {
    assert.ok(taskIds.has(tl.task_id) && labelIds.has(tl.label_id), 'task_label refs resolve');
  }

  // ---- the subtask actually points at its parent's new id ----
  const t1 = rows(target, 'SELECT * FROM tasks').find((t) => t.title === 'root task');
  const t2 = rows(target, 'SELECT * FROM tasks').find((t) => t.title === 'subtask');
  assert.equal(t2.parent_id, t1.id);

  // ---- the multi-label task kept both labels ----
  const t4 = rows(target, 'SELECT * FROM tasks').find((t) => t.title === 'multi-label task');
  assert.equal(count2(target, t4.id), 2);

  // ---- user prefs carried; state_version dropped ----
  const u = rows(target, 'SELECT * FROM users')[0];
  assert.equal(u.username, 'alice');
  assert.equal(u.theme, 'matrix');
  assert.equal(u.week_start, 0);
  assert.equal(u.is_admin, 1);
  assert.equal(u.fib_sizing, 1);
  assert.equal(u.sort_prefs, '{"order":["due"]}');
  // 008: a legacy row predates the column, so the DEFAULT is what it gets — the base directory
  // shows up named for everyone who migrates, rather than silently staying hidden (n.16)
  assert.equal(u.notes_root_name, 'Inbox');
  // 009: the legacy fixture seeds a lowercase 'inbox' project (that's what the old app wrote);
  // migrating capitalizes it, so the app-chosen name matches every user-chosen one around it
  const projNames = rows(target, 'SELECT * FROM projects').map((p) => p.name);
  assert.ok(projNames.includes('Inbox'));
  assert.ok(!projNames.includes('inbox'));

  // 011: the "all calendars" nav row's name lands on a legacy row too (e.10)
  assert.equal(u.calendars_all_name, 'Everything');

  // a.9 — the glyph lock. The IMPORTER must normalize, not migration 010: migrations run
  // against the empty target BEFORE these rows are inserted, so 010 never sees them. The
  // legacy fixture seeds the Inbox with ⌂ (which left the picker) and a Today view with ☉
  // (which joined it) — so this pins both halves of the rule.
  const inbox = rows(target, 'SELECT * FROM projects').find((p) => p.name === 'Inbox');
  assert.equal(inbox.glyph, '❯', '⌂ left the picker; the importer must map the Inbox to ❯');
  const today = rows(target, 'SELECT * FROM saved_queries').find((s) => s.name === 'Today');
  assert.equal(today.glyph, '☉', '☉ is legal now — a shipped icon must NOT be normalized away');
  for (const g of rows(target, 'SELECT glyph FROM projects').map((p) => p.glyph)) {
    assert.ok(GLYPHS.includes(g), `imported project glyph ${g} is not in the picker`);
  }
});

function count2(db: Database.Database, taskId: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS c FROM task_labels WHERE task_id = ?').get(taskId) as {
      c: number;
    }
  ).c;
}
