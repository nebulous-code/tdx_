// query-links-extra.test.ts — branch-coverage booster for the predicate engine
// (src/query.ts) and the entity-link service (src/services/links.ts). The query
// half is pure unit tests against the frozen clock (2026-06-18, a Thursday); the
// links half drives the HTTP routes + service directly over an in-memory DB.
//
// NOTE: src/query.ts is parity-locked with frontend/js/query.js — these tests are
// ADDITIVE and never modify src.

import assert from 'node:assert';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { type Ctx, Q, type Task } from '../src/query.js';
import { createUser } from '../src/seed.js';
import { createLink, deleteLink, getLinksFor } from '../src/services/links.js';
import { buildTestApp, createAndLogin, login } from './support/app.js';
import { freezeClock } from './support/clock.js';

// Imports hoist; freeze before any test body runs so the engine's lazy clock read
// sees the 2026-06-18 baseline (Thursday).
freezeClock();

// ---------------------------------------------------------------------------
// query.ts — pure predicate-evaluation branches
// ---------------------------------------------------------------------------

// 2026-06-18 is "today". Build dated helpers relative to it.
const TODAY = '2026-06-18';
const TOMORROW = '2026-06-19';
const YESTERDAY = '2026-06-17';
const IN_3 = '2026-06-21';
const IN_10 = '2026-06-28';
const IN_40 = '2026-07-28';

function task(overrides: Partial<Task> = {}): Task {
  return { id: 't', title: '', notes: '', labels: [], ...overrides };
}

const emptyCtx: Ctx = { tasks: [], projects: [], labels: [], weekStart: 1 };

// helper: evaluate one query string against one task
const ev = (q: string, t: Task, ctx: Ctx = emptyCtx) => Q.evaluate(t, q, ctx);

test('empty / blank / null query matches everything', () => {
  assert.equal(ev('', task()), true);
  assert.equal(ev('   ', task()), true);
  assert.equal(Q.evaluate(task(), Q.parse(null), emptyCtx), true);
  assert.equal(Q.evaluate(task(), Q.parse(undefined), emptyCtx), true);
  // parse of a blank string yields ok with no terms
  assert.deepEqual(Q.parse(''), { terms: [], ok: true });
});

test('text term matches title or notes; quoted phrase keeps spaces', () => {
  assert.equal(ev('hello', task({ title: 'Hello World' })), true);
  assert.equal(ev('world', task({ notes: 'big WORLD' })), true);
  assert.equal(ev('missing', task({ title: 'a', notes: 'b' })), false);
  // quoted phrase: token keeps the inner space, matches substring
  assert.equal(ev('"hello world"', task({ title: 'say Hello World now' })), true);
  assert.equal(ev('"hello world"', task({ title: 'helloworld' })), false);
  // empty-title/notes fall through the (|| '') guards
  assert.equal(ev('x', task({ title: undefined, notes: undefined })), false);
});

test('negation flips the result and only applies to field:value tokens', () => {
  assert.equal(ev('-status:done', task({ done: true })), false);
  assert.equal(ev('-status:done', task({ done: false })), true);
  // a leading dash on a bare text token is NOT negation (no colon) → literal text
  assert.equal(ev('-foo', task({ title: '-foo bar' })), true);
  assert.equal(ev('-foo', task({ title: 'foo bar' })), false);
});

test('status: every value branch', () => {
  assert.equal(ev('status:done', task({ done: true })), true);
  assert.equal(ev('status:done', task({ done: false })), false);
  assert.equal(ev('status:open', task({ done: false })), true);
  assert.equal(ev('status:open', task({ done: true })), false);
  assert.equal(ev('status:overdue', task({ due: YESTERDAY })), true);
  assert.equal(ev('status:overdue', task({ due: YESTERDAY, done: true })), false);
  assert.equal(ev('status:overdue', task({ due: null })), false); // d === null branch
  assert.equal(ev('status:today', task({ due: TODAY })), true);
  assert.equal(ev('status:today', task({ due: TODAY, done: true })), false);
  assert.equal(ev('status:today', task({ due: TOMORROW })), false);
  // unrecognized status value → res stays false
  assert.equal(ev('status:bogus', task({ done: true })), false);
});

test('due: keyword value branches', () => {
  assert.equal(ev('due:none', task({ due: null })), true);
  assert.equal(ev('due:none', task({ due: TODAY })), false);
  assert.equal(ev('due:set', task({ due: TODAY })), true);
  assert.equal(ev('due:set', task({ due: null })), false);
  assert.equal(ev('due:today', task({ due: TODAY })), true);
  assert.equal(ev('due:today', task({ due: TOMORROW })), false);
  assert.equal(ev('due:tomorrow', task({ due: TOMORROW })), true);
  assert.equal(ev('due:tomorrow', task({ due: TODAY })), false);
  assert.equal(ev('due:overdue', task({ due: YESTERDAY })), true);
  assert.equal(ev('due:overdue', task({ due: null })), false);
  assert.equal(ev('due:overdue', task({ due: TOMORROW })), false);
  assert.equal(ev('due:week', task({ due: IN_3 })), true);
  assert.equal(ev('due:week', task({ due: IN_10 })), false);
  assert.equal(ev('due:week', task({ due: YESTERDAY })), false); // d < 0
  assert.equal(ev('due:week', task({ due: null })), false);
  assert.equal(ev('due:month', task({ due: IN_10 })), true);
  assert.equal(ev('due:month', task({ due: IN_40 })), false);
  assert.equal(ev('due:month', task({ due: YESTERDAY })), false);
  assert.equal(ev('due:month', task({ due: null })), false);
});

test('due: comparison operators (< > <= >= =)', () => {
  // IN_3 is +3 days, IN_10 is +10
  assert.equal(ev('due:<7d', task({ due: IN_3 })), true);
  assert.equal(ev('due:<7d', task({ due: IN_10 })), false);
  assert.equal(ev('due:>7d', task({ due: IN_10 })), true);
  assert.equal(ev('due:>7d', task({ due: IN_3 })), false);
  assert.equal(ev('due:<=3d', task({ due: IN_3 })), true);
  assert.equal(ev('due:<=3d', task({ due: IN_10 })), false);
  assert.equal(ev('due:>=10d', task({ due: IN_10 })), true);
  assert.equal(ev('due:>=10d', task({ due: IN_3 })), false);
  assert.equal(ev('due:=0d', task({ due: TODAY })), true);
  assert.equal(ev('due:=0d', task({ due: TOMORROW })), false);
  // negative offset comparison
  assert.equal(ev('due:<0d', task({ due: YESTERDAY })), true);
  assert.equal(ev('due:=-1d', task({ due: YESTERDAY })), true);
  // cmpDate with a null delta → false
  assert.equal(ev('due:<7d', task({ due: null })), false);
  // malformed comparison op (no match) → false
  assert.equal(ev('due:garbage', task({ due: TODAY })), false);
});

test('due: weekday-window (single + multi), incl. past-the-window → next week', () => {
  // weekStart Monday (1). Today is Thursday 2026-06-18 (getDay 4 = 'r').
  // due:r → Thursday this cycle == today.
  assert.equal(ev('due:r', task({ due: TODAY }), { weekStart: 1 }), true);
  // due:f → Friday this week (2026-06-19), still ahead, no roll.
  assert.equal(ev('due:f', task({ due: TOMORROW }), { weekStart: 1 }), true);
  // due:mwf → Mon/Wed/Fri; the latest (Fri 06-19) is >= today, so this week's set.
  assert.equal(ev('due:mwf', task({ due: TOMORROW }), { weekStart: 1 }), true);
  assert.equal(ev('due:mwf', task({ due: '2026-06-15' }), { weekStart: 1 }), true); // Monday
  // due:mw → Mon(06-15)/Wed(06-17) both BEFORE today(Thu 06-18) → roll to next week.
  // next week's Monday is 06-22, Wednesday 06-24.
  assert.equal(ev('due:mw', task({ due: '2026-06-22' }), { weekStart: 1 }), true);
  assert.equal(ev('due:mw', task({ due: '2026-06-24' }), { weekStart: 1 }), true);
  assert.equal(ev('due:mw', task({ due: '2026-06-15' }), { weekStart: 1 }), false); // this-week date no longer in window
  // weekday window requires a due date; missing due → false (the !!task.due guard)
  assert.equal(ev('due:r', task({ due: null }), { weekStart: 1 }), false);
  // default weekStart (ctx.weekStart undefined → Monday) still resolves
  assert.equal(ev('due:r', task({ due: TODAY }), { tasks: [] }), true);
  // weekStart Sunday (0) variant exercises the (d - weekStart + 7) % 7 with 0
  assert.equal(ev('due:u', task({ due: '2026-06-21' }), { weekStart: 0 }), true); // Sunday 06-21
  // Letters given out of date order ('wm' → Wed then Mon) so the dueWindow reduce
  // comparator sees a candidate where a > b (keeps a), covering the other ternary arm.
  assert.equal(ev('due:wm', task({ due: '2026-06-22' }), { weekStart: 1 }), true); // rolls to next Mon
});

test('reminder: value branches incl. comparisons', () => {
  assert.equal(ev('reminder:none', task({ reminder: null })), true);
  assert.equal(ev('reminder:none', task({ reminder: TODAY })), false);
  assert.equal(ev('reminder:set', task({ reminder: TODAY })), true);
  assert.equal(ev('reminder:set', task({ reminder: null })), false);
  assert.equal(ev('reminder:today', task({ reminder: `${TODAY}T09:00` })), true);
  assert.equal(ev('reminder:today', task({ reminder: TOMORROW })), false);
  assert.equal(ev('reminder:overdue', task({ reminder: YESTERDAY })), true);
  assert.equal(ev('reminder:overdue', task({ reminder: null })), false);
  assert.equal(ev('reminder:overdue', task({ reminder: TOMORROW })), false);
  // comparison op path on reminder
  assert.equal(ev('reminder:<7d', task({ reminder: IN_3 })), true);
  assert.equal(ev('reminder:<7d', task({ reminder: IN_10 })), false);
  assert.equal(ev('reminder:<7d', task({ reminder: null })), false); // null delta
  assert.equal(ev('reminder:bogus', task({ reminder: TODAY })), false);
});

test('recurring: true / false branches', () => {
  assert.equal(ev('recurring:true', task({ recurrence: 'daily' })), true);
  assert.equal(ev('recurring:true', task({ recurrence: null })), false);
  assert.equal(ev('recurring:false', task({ recurrence: null })), true);
  assert.equal(ev('recurring:false', task({ recurrence: 'daily' })), false);
});

test('is: variants', () => {
  assert.equal(ev('is:subtask', task({ parentId: 'p' })), true);
  assert.equal(ev('is:subtask', task({ parentId: null })), false);
  assert.equal(ev('is:task', task({ parentId: null })), true);
  assert.equal(ev('is:task', task({ parentId: 'p' })), false);
  assert.equal(ev('is:recurring', task({ recurrence: 'daily' })), true);
  assert.equal(ev('is:recurring', task({ recurrence: null })), false);
  assert.equal(ev('is:done', task({ done: true })), true);
  assert.equal(ev('is:done', task({ done: false })), false);
  assert.equal(ev('is:open', task({ done: false })), true);
  assert.equal(ev('is:open', task({ done: true })), false);
  assert.equal(ev('is:bogus', task({ done: true })), false); // unmatched value
});

test('has: variants (incl. subtasks lookup over ctx.tasks)', () => {
  const parent = task({ id: 'P' });
  const child = task({ id: 'C', parentId: 'P' });
  const ctx: Ctx = { tasks: [parent, child], projects: [], labels: [] };
  assert.equal(ev('has:subtasks', parent, ctx), true);
  assert.equal(ev('has:subtasks', child, ctx), false);
  // has:subtasks with no ctx.tasks (the (ctx.tasks || []) guard)
  assert.equal(Q.evaluate(parent, 'has:subtasks', { projects: [] }), false);
  assert.equal(ev('has:label', task({ labels: ['l1'] })), true);
  assert.equal(ev('has:label', task({ labels: [] })), false);
  assert.equal(ev('has:no-labels', task({ labels: [] })), true);
  assert.equal(ev('has:no-labels', task({ labels: ['l1'] })), false);
  assert.equal(ev('has:due', task({ due: TODAY })), true);
  assert.equal(ev('has:due', task({ due: null })), false);
  assert.equal(ev('has:bogus', task({ due: TODAY })), false);
});

test('label: OR matching via comma, with ctx labels', () => {
  const ctx: Ctx = {
    tasks: [],
    projects: [],
    labels: [
      { id: 'l1', name: 'Work' },
      { id: 'l2', name: 'Home' },
      { id: 'l3', name: 'Errands' },
    ],
  };
  assert.equal(ev('label:work', task({ labels: ['l1'] }), ctx), true);
  assert.equal(ev('label:home,errands', task({ labels: ['l3'] }), ctx), true); // OR — matches one
  assert.equal(ev('label:home,errands', task({ labels: ['l1'] }), ctx), false);
  // label id not present in ctx.labels → find returns undefined → no match
  assert.equal(ev('label:work', task({ labels: ['unknown-id'] }), ctx), false);
  // task with no labels
  assert.equal(ev('label:work', task({ labels: [] }), ctx), false);
  // ctx.labels missing → (ctx.labels || []) guard
  assert.equal(Q.evaluate(task({ labels: ['l1'] }), 'label:work', { projects: [] }), false);
});

test('project: subtree/slug resolution', () => {
  const ctx: Ctx = {
    tasks: [],
    projects: [
      { id: 'p1', name: 'Big Project' },
      { id: 'p2', name: 'Side' },
    ],
    labels: [],
  };
  // match by id
  assert.equal(ev('project:p1', task({ projectId: 'p1' }), ctx), true);
  // match by slug of name (per-char underscore encoding)
  assert.equal(ev('project:big_project', task({ projectId: 'p1' }), ctx), true);
  // the old space-deleted form no longer matches
  assert.equal(ev('project:bigproject', task({ projectId: 'p1' }), ctx), false);
  // partial slug includes (word substring still works across the underscore)
  assert.equal(ev('project:big', task({ projectId: 'p1' }), ctx), true);
  // no project match
  assert.equal(ev('project:p1', task({ projectId: 'p2' }), ctx), false);
  // ctx.projects missing → (ctx.projects || []) guard, no match
  assert.equal(Q.evaluate(task({ projectId: 'p1' }), 'project:p1', { labels: [] }), false);
});

test('folder/calendar/category accept comma-lists (multi-value)', () => {
  const note = (cat: string) => task({ kind: 'note', category: cat });
  const event = (cat: string) => task({ kind: 'event', category: cat });
  // folder: matches a note in ANY listed folder
  assert.equal(ev('folder:inbox,grocery', note('Grocery')), true);
  assert.equal(ev('folder:inbox,grocery', note('Inbox')), true);
  assert.equal(ev('folder:inbox,grocery', note('Work')), false);
  assert.equal(ev('folder:grocery', note('Grocery')), true); // single value unaffected
  // calendar: same, events only
  assert.equal(ev('calendar:home,work', event('Work')), true);
  assert.equal(ev('calendar:home,work', note('Work')), false); // a note never matches calendar:
  // category: spans apps
  assert.equal(ev('category:grocery,home', note('Grocery')), true);
  assert.equal(ev('category:grocery,home', event('Home')), true);
  // empty list elements are safe (no spurious match)
  assert.equal(ev('folder:grocery,', note('Grocery')), true);
  assert.equal(ev('folder:,', note('Grocery')), false);
});

test('unknown field falls back to literal "field:value" text match', () => {
  assert.equal(ev('color:red', task({ title: 'paint color:red here' })), true);
  assert.equal(ev('color:red', task({ title: 'no match' })), false);
});

test('multiple terms are AND-combined; run() filters the corpus', () => {
  const ctx: Ctx = {
    tasks: [
      task({ id: 'a', title: 'alpha', done: false, due: TODAY }),
      task({ id: 'b', title: 'beta', done: true, due: TODAY }),
      task({ id: 'c', title: 'alpha two', done: false, due: null }),
    ],
    projects: [],
    labels: [],
  };
  const ids = Q.run('alpha status:open', ctx).map((t) => t.id);
  assert.deepEqual(ids, ['a', 'c']);
  // run with an already-parsed query object + run with no tasks in ctx
  const parsed = Q.parse('status:open');
  assert.deepEqual(
    Q.run(parsed, ctx).map((t) => t.id),
    ['a', 'c'],
  );
  assert.deepEqual(Q.run('alpha', { projects: [], labels: [] }), []);
});

test('parse: negation only when colon present; quoted token round-trips via build', () => {
  // "-plain" stays a text term (no colon) — not negated
  const p1 = Q.parse('-plain');
  assert.deepEqual(p1.terms, [{ field: 'text', value: '-plain', neg: false }]);
  // "-status:done" → negated field term
  const p2 = Q.parse('-status:done');
  assert.deepEqual(p2.terms, [{ field: 'status', value: 'done', neg: true }]);
  // quoted text term with spaces builds back with quotes
  const p3 = Q.parse('"hello world"');
  assert.equal(Q.build(p3.terms), '"hello world"');
  // field term builds back as field:value, negation preserved
  assert.equal(Q.build(Q.parse('-due:today').terms), '-due:today');
  // a quoted token that itself contains a colon is treated as text (not a field)
  const p4 = Q.parse('"a:b"');
  assert.deepEqual(p4.terms, [{ field: 'text', value: 'a:b', neg: false }]);
  // termToString directly for a plain (no-space) text term
  assert.equal(Q.termToString({ field: 'text', value: 'plain', neg: false }), 'plain');
});

test('dueDelta + slug helpers', () => {
  assert.equal(Q.dueDelta(task({ due: TODAY })), 0);
  assert.equal(Q.dueDelta(task({ due: TOMORROW })), 1);
  assert.equal(Q.dueDelta(task({ due: YESTERDAY })), -1);
  assert.equal(Q.dueDelta(task({ due: null })), null);
  assert.equal(Q.slug('My Project!'), 'my_project'); // per-char underscore, edges trimmed
  assert.equal(Q.slug('Inbox (base)'), 'inbox__base');
  assert.equal(Q.slug('a-b-c'), 'a_b_c');
  assert.equal(Q.slug(null), '');
  assert.equal(Q.slug(undefined), '');
});

test('tokenize splits on whitespace and respects quotes', () => {
  assert.deepEqual(Q.tokenize('a b'), ['a', 'b']);
  assert.deepEqual(Q.tokenize('"hi there" x'), ['"hi there"', 'x']);
  assert.deepEqual(Q.tokenize(''), []);
});

// ---------------------------------------------------------------------------
// links.ts — service + route branches (need a DB + entities)
// ---------------------------------------------------------------------------

let appCtx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let cookie: string;
let ownerId: string;

const j = (method: string, url: string, payload?: object, c = cookie) =>
  app.inject({
    method: method as 'GET',
    url,
    headers: { cookie: c },
    ...(payload ? { payload } : {}),
  });

const mkTask = (title: string) =>
  j('POST', '/api/tasks', { title }).then((r) => r.json().id as string);
const mkEvent = (title: string) =>
  j('POST', '/api/events', { title, startAt: '2026-07-10' }).then((r) => r.json().id as string);

before(async () => {
  appCtx = await buildTestApp();
  app = appCtx.app;
  const li = await createAndLogin(app, appCtx.db);
  cookie = li.cookie;
  ownerId = li.user.id;
});
after(async () => {
  await app.close();
});

// directly insert a note row (bypassing the filesystem note service) so we can
// drive the content-link branches of getLinksFor deterministically.
async function insertNote(id: string, title: string, tombstoned = 0): Promise<void> {
  const now = new Date().toISOString();
  await appCtx.db
    .insertInto('notes')
    .values({
      id,
      owner_id: ownerId,
      path: `${id}.md`,
      title,
      mtime: now,
      frontmatter: null,
      tombstoned,
      created_at: now,
      updated_at: now,
    })
    .execute();
}

async function insertNoteLink(
  id: string,
  originNoteId: string,
  targetType: string,
  targetId: string,
  rel: string,
  createdAt: string,
): Promise<void> {
  await appCtx.db
    .insertInto('note_links')
    .values({
      id,
      owner_id: ownerId,
      origin_note_id: originNoteId,
      target_type: targetType,
      target_id: targetId,
      rel,
      created_at: createdAt,
    })
    .execute();
}

test('createLink canonicalizes all allowed rels + rejects same-type/self', async () => {
  const taskId = await mkTask('a task');
  const eventId = await mkEvent('an event');
  await insertNote('note-1', 'A Note');

  // event-task
  const l1 = await createLink(
    appCtx.db,
    ownerId,
    { type: 'task', id: taskId },
    { type: 'event', id: eventId },
  );
  assert.equal(l1.rel, 'event-task');
  assert.equal(l1.source, 'app');
  assert.deepEqual(l1.other, { type: 'event', id: eventId, title: 'an event' });

  // note-task (alphabetical → 'note-task')
  const l2 = await createLink(
    appCtx.db,
    ownerId,
    { type: 'task', id: taskId },
    { type: 'note', id: 'note-1' },
  );
  assert.equal(l2.rel, 'note-task');

  // event-note
  const l3 = await createLink(
    appCtx.db,
    ownerId,
    { type: 'note', id: 'note-1' },
    { type: 'event', id: eventId },
  );
  assert.equal(l3.rel, 'event-note');

  // note-note is outside the taxonomy → InvalidLink
  await insertNote('note-2', 'Second');
  await assert.rejects(
    createLink(appCtx.db, ownerId, { type: 'note', id: 'note-1' }, { type: 'note', id: 'note-2' }),
    /unsupported link: note-note/,
  );
  // self/same-type (task-task) likewise rejected
  await assert.rejects(
    createLink(appCtx.db, ownerId, { type: 'task', id: taskId }, { type: 'task', id: taskId }),
    /unsupported link: task-task/,
  );
});

test('createLink is idempotent (onConflict doNothing) — same edge id reused', async () => {
  const taskId = await mkTask('idem task');
  const eventId = await mkEvent('idem event');
  const a = await createLink(
    appCtx.db,
    ownerId,
    { type: 'event', id: eventId },
    { type: 'task', id: taskId },
  );
  // swap order → same canonical edge → same id
  const b = await createLink(
    appCtx.db,
    ownerId,
    { type: 'task', id: taskId },
    { type: 'event', id: eventId },
  );
  assert.equal(a.id, b.id);
  // presented from b=task's POV, other is the event
  assert.equal(b.other.type, 'event');
});

test('createLink with explicit data payload (data !== undefined branch)', async () => {
  const taskId = await mkTask('data task');
  const eventId = await mkEvent('data event');
  const l = await createLink(
    appCtx.db,
    ownerId,
    { type: 'event', id: eventId },
    { type: 'task', id: taskId },
    { note: 'meta' },
  );
  const row = await appCtx.db
    .selectFrom('links')
    .select('data')
    .where('id', '=', l.id)
    .executeTakeFirstOrThrow();
  assert.equal(row.data, JSON.stringify({ note: 'meta' }));
});

test('createLink resolves b title to "" when the far row is missing', async () => {
  // create the app row directly via the service with a bogus b id is impossible
  // (canonicalize is fine, but fetchRow returns undefined) — exercise bRow?.title ?? ''
  const taskId = await mkTask('orphan host');
  const l = await createLink(
    appCtx.db,
    ownerId,
    { type: 'task', id: taskId },
    { type: 'note', id: 'does-not-exist' },
  );
  assert.equal(l.other.title, '');
});

test('getLinksFor merges app + content links, dedups, sorts by createdAt', async () => {
  const taskId = await mkTask('merge task');
  const eventId = await mkEvent('merge event');
  await insertNote('note-merge', 'Merge Note');

  // app link: task <-> event
  await createLink(
    appCtx.db,
    ownerId,
    { type: 'task', id: taskId },
    { type: 'event', id: eventId },
  );
  // content link: note "note-merge" → task (inbound to the task)
  await insertNoteLink('nl-1', 'note-merge', 'task', taskId, 'note-task', '2030-01-01T00:00:00Z');

  const fromTask = await getLinksFor(appCtx.db, ownerId, 'task', taskId);
  // two distinct far endpoints: event (app) + note (content)
  assert.equal(fromTask.length, 2);
  const sources = fromTask.map((l) => l.source);
  assert.ok(sources.includes('app'));
  assert.ok(sources.includes('content'));
  // sorted ascending by createdAt: app link (created "now" = 2026) before content (2030)
  assert.ok(fromTask[0].createdAt <= fromTask[1].createdAt);
});

test('getLinksFor dedups when the same far endpoint is linked twice', async () => {
  const taskId = await mkTask('dedup task');
  await insertNote('note-dedup', 'Dedup Note');
  // app link note<->task
  await createLink(
    appCtx.db,
    ownerId,
    { type: 'task', id: taskId },
    { type: 'note', id: 'note-dedup' },
  );
  // content link from the SAME note → same task (duplicate far endpoint)
  await insertNoteLink(
    'nl-dedup',
    'note-dedup',
    'task',
    taskId,
    'note-task',
    '2030-02-02T00:00:00Z',
  );
  const links = await getLinksFor(appCtx.db, ownerId, 'task', taskId);
  const noteLinks = links.filter((l) => l.other.id === 'note-dedup');
  assert.equal(noteLinks.length, 1); // deduped by far endpoint
});

test('getLinksFor on a note returns inbound + outbound content links', async () => {
  await insertNote('note-src', 'Source');
  const taskId = await mkTask('outbound target');
  await insertNote('note-dst', 'Dest');

  // outbound: note-src → task, and note-src → note-dst
  await insertNoteLink('out-1', 'note-src', 'task', taskId, 'note-task', '2030-03-01T00:00:00Z');
  await insertNoteLink(
    'out-2',
    'note-src',
    'note',
    'note-dst',
    'note-note',
    '2030-03-02T00:00:00Z',
  );
  // inbound: note-dst → note-src (something pointing AT note-src)
  await insertNoteLink('in-1', 'note-dst', 'note', 'note-src', 'note-note', '2030-03-03T00:00:00Z');

  const links = await getLinksFor(appCtx.db, ownerId, 'note', 'note-src');
  const ids = links.map((l) => l.other.id).sort();
  // far endpoints: the task (outbound) + note-dst (outbound, and dedup with inbound)
  assert.ok(ids.includes(taskId));
  assert.ok(ids.includes('note-dst'));
  // note-dst appears once despite being both an outbound target and inbound origin
  assert.equal(links.filter((l) => l.other.id === 'note-dst').length, 1);
});

test('getLinksFor hides tombstoned notes + archived task endpoints', async () => {
  const eventId = await mkEvent('host event');
  await insertNote('note-tomb', 'Tombstoned', 1); // tombstoned
  // app link event<->note(tombstoned) → hidden on read
  await createLink(
    appCtx.db,
    ownerId,
    { type: 'event', id: eventId },
    { type: 'note', id: 'note-tomb' },
  );
  let links = await getLinksFor(appCtx.db, ownerId, 'event', eventId);
  assert.equal(links.length, 0);

  // archived task endpoint also hidden
  const taskId = await mkTask('to archive');
  await createLink(
    appCtx.db,
    ownerId,
    { type: 'event', id: eventId },
    { type: 'task', id: taskId },
  );
  assert.equal((await getLinksFor(appCtx.db, ownerId, 'event', eventId)).length, 1);
  await appCtx.db.updateTable('tasks').set({ archived: 1 }).where('id', '=', taskId).execute();
  links = await getLinksFor(appCtx.db, ownerId, 'event', eventId);
  assert.equal(links.length, 0);
});

test('getLinksFor skips a far endpoint that no longer exists (missing row)', async () => {
  const eventId = await mkEvent('dangling host');
  // app edge to a non-existent note id → resolveEntity sees access 'none' → skipped
  await createLink(
    appCtx.db,
    ownerId,
    { type: 'event', id: eventId },
    { type: 'note', id: 'ghost-note' },
  );
  const links = await getLinksFor(appCtx.db, ownerId, 'event', eventId);
  assert.equal(links.length, 0);
});

test('getLinksFor re-checks access per far endpoint (owner isolation)', async () => {
  // Bob owns a note that an app edge (owned by alice) points at; alice can't see it.
  const eventId = await mkEvent('alice host');
  await createUser(
    appCtx.db,
    { username: 'carol', email: 'carol@x.com', password: 'C@rol!secret' },
    { isAdmin: false },
  );
  // make alice an app edge to a note whose row exists but belongs to carol
  const now = new Date().toISOString();
  const carol = await appCtx.db
    .selectFrom('users')
    .select('id')
    .where('username', '=', 'carol')
    .executeTakeFirstOrThrow();
  await appCtx.db
    .insertInto('notes')
    .values({
      id: 'carol-note',
      owner_id: carol.id,
      path: 'carol-note.md',
      title: 'Carol',
      mtime: now,
      frontmatter: null,
      tombstoned: 0,
      created_at: now,
      updated_at: now,
    })
    .execute();
  // alice asserts an edge event(alice) <-> note(carol's)
  await createLink(
    appCtx.db,
    ownerId,
    { type: 'event', id: eventId },
    { type: 'note', id: 'carol-note' },
  );
  // resolveEntity's accessLevel check returns 'none' for alice on carol's note → hidden
  const links = await getLinksFor(appCtx.db, ownerId, 'event', eventId);
  assert.equal(links.length, 0);
});

test('deleteLink removes the edge (owner-scoped)', async () => {
  const taskId = await mkTask('del task');
  const eventId = await mkEvent('del event');
  const l = await createLink(
    appCtx.db,
    ownerId,
    { type: 'event', id: eventId },
    { type: 'task', id: taskId },
  );
  assert.equal((await getLinksFor(appCtx.db, ownerId, 'event', eventId)).length, 1);
  await deleteLink(appCtx.db, ownerId, l.id);
  assert.equal((await getLinksFor(appCtx.db, ownerId, 'event', eventId)).length, 0);
  // deleting again (already gone) is a no-op
  await deleteLink(appCtx.db, ownerId, l.id);
});

test('route: unsupported pair → 400; missing endpoint → 404', async () => {
  const t1 = await mkTask('rt a');
  const t2 = await mkTask('rt b');
  const bad = await j('POST', '/api/links', {
    aType: 'task',
    aId: t1,
    bType: 'task',
    bId: t2,
  });
  assert.equal(bad.statusCode, 400);

  // far endpoint the caller can't see → denyAccess 404
  const t3 = await mkTask('rt c');
  const notFound = await j('POST', '/api/links', {
    aType: 'task',
    aId: t3,
    bType: 'event',
    bId: 'no-such-event',
  });
  assert.equal(notFound.statusCode, 404);
});

test("route: another user's entity links are not visible/creatable", async () => {
  const taskId = await mkTask('alice rt task');
  const eventId = await mkEvent('alice rt event');
  await createUser(
    appCtx.db,
    { username: 'dave', email: 'dave@x.com', password: 'D@ve!secret' },
    { isAdmin: false },
  );
  const dave = await login(app, 'dave', 'D@ve!secret');
  // dave owns neither endpoint → 404 on create
  const create = await j(
    'POST',
    '/api/links',
    { aType: 'event', aId: eventId, bType: 'task', bId: taskId },
    dave,
  );
  assert.equal(create.statusCode, 404);
  // and 404 listing alice's entity links
  const list = await j('GET', `/api/links?type=task&id=${taskId}`, undefined, dave);
  assert.equal(list.statusCode, 404);
});
