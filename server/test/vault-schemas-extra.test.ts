// Branch-coverage focused unit tests for vault.ts (path containment + env-default
// + mkdir branches), the schemas.ts row→JSON mappers + parseHealth (both arms of
// every nullish/ternary field), and the remaining uncovered service branches in
// services/notes.ts (scanFile missing-file → null, existing frontmatter id vs
// generated, foreign same-id owner conflict, uniqueFile collision suffix,
// resolveNoteName by title vs filename vs dangling, reconcileFileLinks self/dangling).

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import type {
  EventsTable,
  LabelsTable,
  NotesTable,
  ProjectsTable,
  SavedQueriesTable,
  TasksTable,
} from '../src/db.js';
import {
  parseHealth,
  rowToEvent,
  rowToLabel,
  rowToNote,
  rowToProject,
  rowToSavedQuery,
  rowToTask,
} from '../src/schemas.js';

// A temp vault is needed BEFORE the vault.ts / notes.ts helpers are exercised.
let vault: string;
before(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'tdx-vse-'));
  process.env.VAULT_DIR = vault;
});
after(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

// ---- schemas.ts — parseHealth (both arms) ----------------------------------

test('parseHealth: null/empty → []', () => {
  assert.deepEqual(parseHealth(null), []);
  assert.deepEqual(parseHealth(''), []); // falsy string short-circuits too
});

test('parseHealth: valid JSON array keeps only strings', () => {
  assert.deepEqual(parseHealth('["on-track","at-risk"]'), ['on-track', 'at-risk']);
  // non-string members are filtered out (the Array.isArray + filter branch)
  assert.deepEqual(parseHealth('["ok",1,null,true,"go"]'), ['ok', 'go']);
});

test('parseHealth: valid JSON that is not an array → []', () => {
  assert.deepEqual(parseHealth('{"a":1}'), []); // Array.isArray false arm
  assert.deepEqual(parseHealth('"just a string"'), []);
});

test('parseHealth: malformed JSON → [] (catch arm)', () => {
  assert.deepEqual(parseHealth('not json at all'), []);
  assert.deepEqual(parseHealth('[unterminated'), []);
});

// ---- schemas.ts — rowToTask (done 0/1, nullable fields both arms) -----------

const baseTask: TasksTable = {
  id: 't1',
  owner_id: 'o',
  creator_id: 'o',
  assignee_id: null,
  project_id: null,
  parent_id: null,
  title: 'T',
  done: 0,
  due: null,
  reminder: null,
  recurrence: null,
  notes: '',
  priority: 0,
  size: 0,
  position: 0,
  archived: 0,
  created_at: 'c',
  completed_at: null,
  updated_at: 'u',
};

test('rowToTask: null/falsy arms', () => {
  const j = rowToTask(baseTask, []);
  assert.equal(j.done, false); // !!0
  assert.equal(j.projectId, null);
  assert.equal(j.parentId, null);
  assert.equal(j.due, null);
  assert.equal(j.reminder, null);
  assert.equal(j.recurrence, null);
  assert.equal(j.assigneeId, null);
  assert.equal(j.completedAt, null);
  assert.deepEqual(j.labels, []);
});

test('rowToTask: set/truthy arms', () => {
  const j = rowToTask(
    {
      ...baseTask,
      done: 1,
      project_id: 'p',
      parent_id: 'par',
      due: '2026-01-01',
      reminder: '2026-01-02',
      recurrence: 'FREQ=DAILY',
      assignee_id: 'a',
      completed_at: '2026-01-03',
      priority: 3,
      size: 5,
    },
    ['urgent', 'home'],
  );
  assert.equal(j.done, true); // !!1
  assert.equal(j.projectId, 'p');
  assert.equal(j.parentId, 'par');
  assert.equal(j.due, '2026-01-01');
  assert.equal(j.assigneeId, 'a');
  assert.equal(j.completedAt, '2026-01-03');
  assert.equal(j.priority, 3);
  assert.deepEqual(j.labels, ['urgent', 'home']);
});

// ---- schemas.ts — rowToProject (collapsed 0/1, health empty/full) ----------

const baseProject: ProjectsTable = {
  id: 'p1',
  owner_id: 'o',
  parent_id: null,
  name: 'P',
  color: '#fff',
  glyph: '*',
  collapsed: 0,
  position: 0,
  archived: 0,
  health: '',
  created_at: 'c',
  updated_at: 'u',
};

test('rowToProject: collapsed false + empty health', () => {
  const j = rowToProject(baseProject);
  assert.equal(j.collapsed, false);
  assert.equal(j.parentId, null);
  assert.deepEqual(j.health, []);
});

test('rowToProject: collapsed true + populated health + parent', () => {
  const j = rowToProject({
    ...baseProject,
    collapsed: 1,
    parent_id: 'root',
    health: '["green"]',
  });
  assert.equal(j.collapsed, true);
  assert.equal(j.parentId, 'root');
  assert.deepEqual(j.health, ['green']);
});

// ---- schemas.ts — rowToLabel (pinned 0/1) ----------------------------------

test('rowToLabel: both pinned arms', () => {
  const off: LabelsTable = { id: 'l', owner_id: 'o', name: 'home', pinned: 0 };
  assert.deepEqual(rowToLabel(off), { id: 'l', name: 'home', pinned: false });
  assert.deepEqual(rowToLabel({ ...off, pinned: 1 }), { id: 'l', name: 'home', pinned: true });
});

// ---- schemas.ts — rowToSavedQuery (system/pinned 0/1, color null/set) -------

const baseSq: SavedQueriesTable = {
  id: 'q',
  owner_id: 'o',
  name: 'All',
  glyph: '#',
  query: 'done:false',
  system: 0,
  color: null,
  position: 0,
  pinned: 0,
};

test('rowToSavedQuery: falsy arms (system/pinned false, color null)', () => {
  const j = rowToSavedQuery(baseSq);
  assert.equal(j.system, false);
  assert.equal(j.pinned, false);
  assert.equal(j.color, null);
});

test('rowToSavedQuery: truthy arms (system/pinned true, color set)', () => {
  const j = rowToSavedQuery({ ...baseSq, system: 1, pinned: 1, color: '#abc' });
  assert.equal(j.system, true);
  assert.equal(j.pinned, true);
  assert.equal(j.color, '#abc');
});

// ---- schemas.ts — rowToEvent (all_day 0/1, nullable fields both arms) -------

const baseEvent: EventsTable = {
  id: 'e',
  owner_id: 'o',
  creator_id: 'o',
  assignee_id: null,
  title: 'E',
  notes: '',
  location: null,
  all_day: 0,
  start_at: '2026-01-01',
  end_at: null,
  recurrence: null,
  reminder: null,
  position: 0,
  archived: 0,
  created_at: 'c',
  updated_at: 'u',
};

test('rowToEvent: falsy/null arms', () => {
  const j = rowToEvent(baseEvent);
  assert.equal(j.allDay, false);
  assert.equal(j.assigneeId, null);
  assert.equal(j.location, null);
  assert.equal(j.endAt, null);
  assert.equal(j.recurrence, null);
  assert.equal(j.reminder, null);
});

test('rowToEvent: truthy/set arms', () => {
  const j = rowToEvent({
    ...baseEvent,
    all_day: 1,
    assignee_id: 'a',
    location: 'HQ',
    end_at: '2026-01-02',
    recurrence: 'FREQ=WEEKLY',
    reminder: '2026-01-01T09:00',
  });
  assert.equal(j.allDay, true);
  assert.equal(j.assigneeId, 'a');
  assert.equal(j.location, 'HQ');
  assert.equal(j.endAt, '2026-01-02');
  assert.equal(j.recurrence, 'FREQ=WEEKLY');
  assert.equal(j.reminder, '2026-01-01T09:00');
});

// ---- schemas.ts — rowToNote -------------------------------------------------

test('rowToNote: maps row + injected body', () => {
  const row: NotesTable = {
    id: 'n',
    owner_id: 'o',
    path: 'A.md',
    title: 'A',
    mtime: 'm',
    frontmatter: null,
    tombstoned: 0,
    created_at: 'c',
    updated_at: 'u',
  };
  assert.deepEqual(rowToNote(row, 'hello body'), {
    id: 'n',
    ownerId: 'o',
    path: 'A.md',
    title: 'A',
    body: 'hello body',
    createdAt: 'c',
    updatedAt: 'u',
  });
});

// ---- vault.ts — abs containment + env default + mkdir branches --------------

test('vault: abs allows the root itself and paths within it', async () => {
  const { abs, vaultRoot } = await import('../src/vault.js');
  const root = vaultRoot('owner1');
  assert.equal(abs('owner1', '.'), root); // p === root arm
  assert.equal(abs('owner1', 'sub/note.md'), path.join(root, 'sub/note.md')); // startsWith arm
});

test('vault: abs throws on a `..` traversal that escapes the root', async () => {
  const { abs } = await import('../src/vault.js');
  assert.throws(() => abs('owner1', '../escape.md'), /escapes its root/);
  assert.throws(() => abs('owner1', '../../etc/passwd'), /escapes its root/);
});

test('vault: abs throws on an absolute path outside the root', async () => {
  const { abs } = await import('../src/vault.js');
  assert.throws(() => abs('owner1', '/etc/passwd'), /escapes its root/);
});

test('vault: a sibling-prefix dir does NOT count as inside the root', async () => {
  const { abs, vaultRoot } = await import('../src/vault.js');
  const root = vaultRoot('own'); // .../own
  // ../own-evil resolves to a sibling that shares the "own" name prefix → must throw
  assert.throws(() => abs('own', '../own-evil/x.md'), /escapes its root/);
  assert.ok(root.endsWith(`${path.sep}own`));
});

test('vault: vaultBase honors VAULT_DIR, and falls back to the default when unset', async () => {
  const { vaultBase } = await import('../src/vault.js');
  // truthy branch: env is set (by before())
  assert.equal(vaultBase(), vault);

  // falsy branch: temporarily unset to hit the `|| <default>` arm
  const saved = process.env.VAULT_DIR;
  process.env.VAULT_DIR = undefined;
  // biome-ignore lint/performance/noDelete: must truly remove the key so `||` sees undefined
  delete process.env.VAULT_DIR;
  try {
    const base = vaultBase();
    assert.ok(base.endsWith(path.join('data', 'vault')));
    assert.ok(fs.existsSync(base)); // mkdirSync ran
  } finally {
    if (saved !== undefined) process.env.VAULT_DIR = saved;
  }
});

// ---- services/notes.ts — remaining service branches ------------------------
// These need a migrated DB + the temp VAULT_DIR (set in before()).

import { type DB, type Sqlite, openDatabase } from '../src/db.js';
import { newId } from '../src/ids.js';
import { extractLinks, serializeNote } from '../src/services/markdown.js';
import { createNote, reconcileFileLinks, scanFile, updateNote } from '../src/services/notes.js';
import { abs, vaultRoot } from '../src/vault.js';

let sqlite: Sqlite;
let db: DB;
const OWNER = 'owner-notes';
const FOREIGN = 'someone-else';

// notes.owner_id has an FK to users(id); seed minimal user rows for our owners.
async function seedUser(id: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insertInto('users')
    .values({
      id,
      username: id,
      email: `${id}@x.com`,
      password_hash: 'x',
      theme: null,
      week_start: 1,
      sort_prefs: null,
      fib_sizing: 0,
      is_admin: 0,
      created_at: now,
      updated_at: now,
    })
    .execute();
}

before(async () => {
  ({ sqlite, db } = openDatabase(':memory:'));
  await seedUser(OWNER);
  await seedUser(FOREIGN);
  vaultRoot(OWNER); // ensure the owner dir exists
});
after(() => {
  sqlite.close();
});

test('scanFile: missing file returns null (the catch → null arm)', async () => {
  const res = await scanFile(db, OWNER, 'does-not-exist.md');
  assert.equal(res, null);
});

test('scanFile: file WITHOUT a frontmatter id gets one written back (generated arm)', async () => {
  const rel = 'no-id.md';
  fs.writeFileSync(abs(OWNER, rel), '# Hand written\n\nbody text');
  const note = await scanFile(db, OWNER, rel);
  assert.ok(note);
  const raw = fs.readFileSync(abs(OWNER, rel), 'utf8');
  assert.match(raw, /^---\nid: [0-9a-f-]{36}\n/); // injected id
  // re-scan: now the file HAS an id → the `if (!id)` false arm + the update path
  const again = await scanFile(db, OWNER, rel);
  assert.equal(again?.id, note.id);
});

test('scanFile: empty frontmatter → fmJson null; extra frontmatter → fmJson set', async () => {
  // empty frontmatter (only the managed id) → Object.keys(...).length === 0 → null arm
  const id1 = newId();
  fs.writeFileSync(abs(OWNER, 'empty-fm.md'), serializeNote({ id: id1, body: 'x' }));
  await scanFile(db, OWNER, 'empty-fm.md');
  const r1 = await db
    .selectFrom('notes')
    .select('frontmatter')
    .where('id', '=', id1)
    .executeTakeFirst();
  assert.equal(r1?.frontmatter, null);

  // extra (non-id) frontmatter key → length > 0 → JSON.stringify arm
  const id2 = newId();
  fs.writeFileSync(
    abs(OWNER, 'extra-fm.md'),
    serializeNote({ id: id2, body: 'y', frontmatter: { status: 'draft' } }),
  );
  await scanFile(db, OWNER, 'extra-fm.md');
  const r2 = await db
    .selectFrom('notes')
    .select('frontmatter')
    .where('id', '=', id2)
    .executeTakeFirst();
  assert.equal(r2?.frontmatter, '{"status":"draft"}');
});

test('scanFile: a foreign-owned same-id row is NOT treated as ours (owner-scoped existing lookup)', async () => {
  const sharedId = newId();
  const now = new Date().toISOString();
  // a foreign owner already holds a row with this id
  await db
    .insertInto('notes')
    .values({
      id: sharedId,
      owner_id: FOREIGN,
      path: 'theirs.md',
      title: 'theirs',
      mtime: now,
      frontmatter: null,
      tombstoned: 0,
      created_at: now,
      updated_at: now,
    })
    .execute();

  // OUR file carries the same frontmatter id. The existing-lookup is scoped to OUR
  // owner_id, so it MISSES the foreign row and takes the INSERT arm (never the
  // UPDATE arm) — which collides on the global `id` PK, proving the row wasn't
  // resolved as ours and the foreign row stays untouched.
  fs.writeFileSync(abs(OWNER, 'mine.md'), serializeNote({ id: sharedId, body: 'mine' }));
  await assert.rejects(scanFile(db, OWNER, 'mine.md'), /UNIQUE constraint failed: notes\.id/);

  // the foreign row is untouched (it was never updated as if it were ours)
  const theirs = await db
    .selectFrom('notes')
    .select(['path', 'title'])
    .where('id', '=', sharedId)
    .where('owner_id', '=', FOREIGN)
    .executeTakeFirst();
  assert.equal(theirs?.path, 'theirs.md');
  assert.equal(theirs?.title, 'theirs');
});

test('createNote then re-create same title hits the uniqueFile collision suffix', async () => {
  const a = await createNote(db, OWNER, { title: 'Collide', body: '1' });
  const b = await createNote(db, OWNER, { title: 'Collide', body: '2' });
  assert.equal(a.path, 'Collide.md'); // n === 1 candidate (no suffix)
  assert.equal(b.path, 'Collide 2.md'); // collision → `Name 2.md` (the loop's n>1 arm)
});

test('updateNote with no title keeps the filename (wantName = current basename arm)', async () => {
  const note = await createNote(db, OWNER, { title: 'KeepName', body: 'v1' });
  const upd = await updateNote(db, OWNER, note.id, { body: 'v2 only body' });
  assert.equal(upd?.path, 'KeepName.md'); // newRel === oldRel → no rename
  assert.equal(upd?.body, 'v2 only body');
});

test('updateNote: missing / tombstoned note → null', async () => {
  assert.equal(await updateNote(db, OWNER, 'nope-id', { title: 'x' }), null);
});

test('resolveNoteName + reconcileFileLinks: title match, filename match, dangling, self', async () => {
  // target whose TITLE differs from its on-disk basename to exercise both match arms
  const target = await createNote(db, OWNER, { title: 'Target Topic', body: 'root' });

  // self-link is skipped (id === noteId arm) and an unknown name is dangling (null arm)
  await reconcileFileLinks(
    db,
    OWNER,
    target.id,
    extractLinks('see [[Target Topic]] and [[Nonexistent]]'),
  );
  let edges = await db
    .selectFrom('note_links')
    .selectAll()
    .where('origin_note_id', '=', target.id)
    .execute();
  assert.equal(edges.length, 0); // self skipped, unknown dangling → no edges

  // a source note that links to the target by name → resolves (title-match arm)
  const src = await createNote(db, OWNER, { title: 'Source', body: 'see [[Target Topic]]' });
  edges = await db
    .selectFrom('note_links')
    .selectAll()
    .where('origin_note_id', '=', src.id)
    .where('target_id', '=', target.id)
    .execute();
  assert.equal(edges.length, 1);

  // filename-match arm: link by the on-disk basename ("Target Topic")
  await reconcileFileLinks(db, OWNER, src.id, extractLinks('jump [[Target Topic]]'));
  const byFile = await db
    .selectFrom('note_links')
    .selectAll()
    .where('origin_note_id', '=', src.id)
    .execute();
  assert.equal(byFile.length, 1);
});
