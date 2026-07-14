import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, createAndLogin } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let cookie: string;
let vault: string;

const j = (method: string, url: string, payload?: object) =>
  app.inject({
    method: method as 'GET',
    url,
    headers: { cookie },
    ...(payload ? { payload } : {}),
  });
const query = (q: string, extra: object = {}) =>
  j('POST', '/api/query', { query: q, ...extra }).then((r) => r.json());

type Item = { type: string; id: string; title: string };

before(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'tdx-uq-'));
  process.env.VAULT_DIR = vault;
  ctx = await buildTestApp();
  app = ctx.app;
  ({ cookie } = await createAndLogin(app, ctx.db));
  // one of each type, sharing the word "alpha" in two of them
  await j('POST', '/api/tasks', { title: 'alpha task' });
  await j('POST', '/api/events', { title: 'alpha meeting', startAt: '2026-07-15' });
  await j('POST', '/api/notes', { title: 'Beta', body: 'note about gamma' });
});
after(async () => {
  await app.close();
  fs.rmSync(vault, { recursive: true, force: true });
});

test('default (no type:) returns ALL item types', async () => {
  const res = await query('');
  const kinds = new Set(res.items.map((i: Item) => i.type));
  assert.ok(kinds.has('task') && kinds.has('event') && kinds.has('note'));
  assert.ok(res.items.some((i: Item) => i.title === 'alpha task'));
});

test('explicit empty type: returns nothing (never falls back to tasks)', async () => {
  const res = await query('type:');
  assert.equal(res.items.length, 0);
});

test('type: selects each entity type (tagged)', async () => {
  const ev = await query('type:event');
  assert.equal(ev.items.length, 1);
  assert.equal(ev.items[0].type, 'event');
  assert.equal(ev.items[0].title, 'alpha meeting');
  assert.equal(ev.items[0].startAt, '2026-07-15'); // full entity fields carried through

  const nt = await query('type:note');
  assert.equal(nt.items.length, 1);
  assert.equal(nt.items[0].type, 'note');
  assert.equal(nt.items[0].title, 'Beta');
});

test('type:task,event,note returns all three, each tagged', async () => {
  const res = await query('type:task,event,note');
  const kinds = res.items.map((i: Item) => i.type).sort();
  assert.deepEqual([...new Set(kinds)].sort(), ['event', 'note', 'task']);
  assert.equal(res.total, res.items.length);
});

test('free-text runs through the same engine across types', async () => {
  // "alpha" is in the task + event titles, not the note
  const res = await query('type:task,event,note alpha');
  const kinds = new Set(res.items.map((i: Item) => i.type));
  assert.ok(kinds.has('task') && kinds.has('event'));
  assert.ok(!kinds.has('note'));
  // body text matches notes too
  const g = await query('type:note gamma');
  assert.equal(g.items.length, 1);
});

test('date predicates apply to events via their start date', async () => {
  assert.equal((await query('type:event due:set')).items.length, 1); // event has a start date
  assert.equal((await query('type:event due:none')).items.length, 0);
  assert.equal((await query('type:note due:none')).items.length, 1); // a note has no due → matches none
});

test('task-only predicates exclude events/notes (project:/label:)', async () => {
  // events/notes have no project, so a project filter yields no non-task hits
  const res = await query('type:task,event,note project:nonexistent');
  assert.equal(res.items.length, 0);
});

test('-type: excludes that type', async () => {
  // negating a type drops it from the result set
  const noNotes = await query('type:task,event,note -type:note');
  assert.ok(noNotes.items.every((i: Item) => i.type !== 'note'));
  assert.ok(noNotes.items.some((i: Item) => i.type === 'task'));
  // exclude-only (no positive type:) defaults to "everything but the excluded type"
  const allButNote = await query('-type:note');
  const kinds = new Set(allButNote.items.map((i: Item) => i.type));
  assert.ok(kinds.has('task') && kinds.has('event') && !kinds.has('note'));
});

test('unknown type token errors (400) instead of silently hiding it', async () => {
  const r = await j('POST', '/api/query', { query: 'type:even' });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /unknown type token: even/);
});

test('a past event reads as done (complete), not overdue', async () => {
  await j('POST', '/api/events', { title: 'past standup', startAt: '2020-01-01' });
  const done = await query('type:event status:done');
  assert.ok(done.items.some((i: Item) => i.title === 'past standup'));
  const overdue = await query('type:event status:overdue');
  assert.ok(!overdue.items.some((i: Item) => i.title === 'past standup'));
});

test('recurring event matches a date predicate via its occurrences, deduped with a count', async () => {
  // a daily series that started in the past — it has an occurrence every day, so it falls in
  // any 7-day window even though its START date does not.
  await j('POST', '/api/events', {
    title: 'daily ritual',
    startAt: '2026-06-01',
    recurrence: 'daily',
  });
  const wk = await query('type:event due:week');
  const ritual = wk.items.filter((i: Item) => i.title === 'daily ritual');
  assert.equal(ritual.length, 1); // ONE row per series, not one per occurrence
  // due:week = today..today+7 inclusive → 8 daily occurrences
  assert.equal((ritual[0] as { count: number }).count, 8);
  assert.ok((ritual[0] as { date: string }).date); // dated to the soonest matching occurrence
});

test('created: spans all types (just-created items match created:today)', async () => {
  const res = await query('type:task,event,note created:today');
  const kinds = new Set(res.items.map((i: Item) => i.type));
  // the seeded task/event/note were all created during this test run → all match created:today
  assert.ok(kinds.has('task') && kinds.has('event') && kinds.has('note'));
});

test('note due: maps to the review date', async () => {
  // review/due are LOCAL calendar dates (date-only), so use local today (not UTC slice)
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  const today = `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
  await j('POST', '/api/notes', { title: 'ReviewMe', reviewAt: today });
  const due = await query('type:note due:today');
  assert.ok(due.items.some((i: Item) => i.title === 'ReviewMe'));
  // a note without a review date is invisible to due:set
  const set = await query('type:note due:set');
  assert.ok(set.items.some((i: Item) => i.title === 'ReviewMe'));
  assert.ok(!set.items.some((i: Item) => i.title === 'Beta'));
});

// ---------------------------------------------------------------------------
// folder: — the vault's base directory as a named folder (n.16). These are the FIRST tests of
// the folder: join key; it had no coverage. The user's notes_root_name defaults to 'inbox'.
// ---------------------------------------------------------------------------

const setRootName = (name: string) =>
  j('PUT', '/api/auth/account', { notes_root_name: name }).then((r) => r.statusCode);

test('folder: bare token means UNFILED — root notes, never foldered ones', async () => {
  const f = await j('POST', '/api/folders', { name: 'Work' }).then((r) => r.json());
  await j('POST', '/api/notes', { title: 'Filed', folderId: f.id });

  const root = await query('type:note folder:');
  assert.ok(root.items.some((i: Item) => i.title === 'Beta')); // created at the vault root
  assert.ok(!root.items.some((i: Item) => i.title === 'Filed'));
  // and the named folder still resolves normally
  const work = await query('type:note folder:work');
  assert.ok(work.items.some((i: Item) => i.title === 'Filed'));
  assert.ok(!work.items.some((i: Item) => i.title === 'Beta'));
});

test('folder:<base name> is an ALIAS for the root notes', async () => {
  assert.equal(await setRootName('inbox'), 200);
  const res = await query('type:note folder:inbox');
  assert.ok(res.items.some((i: Item) => i.title === 'Beta'));
  assert.ok(!res.items.some((i: Item) => i.title === 'Filed'));
});

test('folder:<base name> finds nothing when the base directory is unnamed (hidden)', async () => {
  assert.equal(await setRootName(''), 200);
  const named = await query('type:note folder:inbox');
  assert.equal(named.items.length, 0); // no name → no alias → today's pre-feature behavior
  // the bare token is unaffected: it's rename-proof, and it never depended on the name
  const bare = await query('type:note folder:');
  assert.ok(bare.items.some((i: Item) => i.title === 'Beta'));
  assert.equal(await setRootName('inbox'), 200);
});

// The collision the save-time validation cannot prevent: the folder appears LATER (a dir dropped
// in the vault, then synced). Data beats label — the alias switches off and `folder:inbox` means
// the real ./inbox directory. A suffixed alias could not fix this: catNameMatch is substring-based,
// so anything containing "inbox" would match `folder:inbox` anyway.
test('a real folder with the base name WINS — the alias switches off', async () => {
  const f = await j('POST', '/api/folders', { name: 'inbox' }).then((r) => r.json());
  await j('POST', '/api/notes', { title: 'InTheRealInbox', folderId: f.id });

  const res = await query('type:note folder:inbox');
  assert.ok(res.items.some((i: Item) => i.title === 'InTheRealInbox'));
  assert.ok(!res.items.some((i: Item) => i.title === 'Beta')); // the root note is NOT claimed

  // root notes are still reachable — the bare token never goes ambiguous
  const bare = await query('type:note folder:');
  assert.ok(bare.items.some((i: Item) => i.title === 'Beta'));
  assert.ok(!bare.items.some((i: Item) => i.title === 'InTheRealInbox'));
});
