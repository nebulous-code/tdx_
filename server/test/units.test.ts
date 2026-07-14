// units.test.ts — direct branch-coverage unit tests for the pure-ish modules:
//   src/rec.ts                 (recurrence parsing/formatting helpers)
//   src/services/recurrence.ts (completeTask spawn — exercised over an in-mem DB)
//   src/services/markdown.ts   (frontmatter/wikilink parsing — fully pure)
//   src/db.ts                  (openDatabase / applyMigrations branches)
// No process spawning; every sqlite handle is closed; temp dirs are removed.

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { applyMigrations, openDatabase } from '../src/db.js';
import { Rec } from '../src/rec.js';
import {
  extractLinks,
  injectFrontmatterId,
  parseNote,
  serializeNote,
} from '../src/services/markdown.js';
import { completeTask } from '../src/services/recurrence.js';
import { freezeClock } from './support/clock.js';

// Pin the clock (2026-06-18, TZ=UTC) so the date-defaulting branches in Rec /
// completeTask are deterministic. Imports hoist; this runs before any test body.
freezeClock();

// ---------------------------------------------------------------------------
// Rec — every rule type plus the empty/invalid edges (parse/stringify/summary/
// compact each have a per-type switch; hit them all).
// ---------------------------------------------------------------------------

test('Rec.parse: null / empty -> null', () => {
  assert.equal(Rec.parse(null), null);
  assert.equal(Rec.parse(undefined), null);
  assert.equal(Rec.parse(''), null);
});

test('Rec.parse: daily forms', () => {
  assert.deepEqual(Rec.parse('daily'), { type: 'daily', interval: 1 });
  assert.deepEqual(Rec.parse('every day'), { type: 'daily', interval: 1 });
  assert.deepEqual(Rec.parse('every 3 days'), { type: 'daily', interval: 3 });
  assert.deepEqual(Rec.parse('every 1 day'), { type: 'daily', interval: 1 });
});

test('Rec.parse: weekly forms', () => {
  assert.deepEqual(Rec.parse('weekly on mon,wed,fri'), {
    type: 'weekly',
    interval: 1,
    days: [1, 3, 5],
  });
  assert.deepEqual(Rec.parse('every 2 weeks on tue'), {
    type: 'weekly',
    interval: 2,
    days: [2],
  });
  assert.deepEqual(Rec.parse('every 2 weeks'), { type: 'weekly', interval: 2, days: null });
  // weekly with NO valid day names -> invalid (mkWeekly empty branch)
  assert.deepEqual(Rec.parse('weekly on zzz'), { type: 'invalid', raw: 'weekly on zzz' });
});

test('Rec.parse: monthly-day forms (incl. clamp)', () => {
  assert.deepEqual(Rec.parse('monthly on day 15'), {
    type: 'monthly-day',
    interval: 1,
    day: 15,
  });
  assert.deepEqual(Rec.parse('every 3 months on day 99'), {
    type: 'monthly-day',
    interval: 3,
    day: 31, // clamped
  });
  assert.deepEqual(Rec.parse('every 4 months'), { type: 'monthly-day', interval: 4, day: null });
});

test('Rec.parse: monthly-weekday forms (incl. last)', () => {
  assert.deepEqual(Rec.parse('monthly on 2nd tue'), {
    type: 'monthly-weekday',
    interval: 1,
    ord: 2,
    weekday: 2,
  });
  assert.deepEqual(Rec.parse('every 2 months on last fri'), {
    type: 'monthly-weekday',
    interval: 2,
    ord: -1,
    weekday: 5,
  });
});

test('Rec.parse: unrecognized -> invalid', () => {
  assert.deepEqual(Rec.parse('gibberish'), { type: 'invalid', raw: 'gibberish' });
});

test('Rec.stringify: every type + null/invalid', () => {
  assert.equal(Rec.stringify(null), '');
  assert.equal(Rec.stringify({ type: 'invalid', raw: 'x' }), '');
  assert.equal(Rec.stringify({ type: 'daily', interval: 1 }), 'daily');
  assert.equal(Rec.stringify({ type: 'daily', interval: 5 }), 'every 5 days');
  assert.equal(Rec.stringify({ type: 'weekly', interval: 1, days: [1, 3] }), 'weekly on mon,wed');
  assert.equal(Rec.stringify({ type: 'weekly', interval: 1, days: null }), 'weekly on mon');
  assert.equal(Rec.stringify({ type: 'weekly', interval: 2, days: [4] }), 'every 2 weeks on thu');
  assert.equal(Rec.stringify({ type: 'weekly', interval: 2, days: null }), 'every 2 weeks');
  assert.equal(Rec.stringify({ type: 'monthly-day', interval: 1, day: 9 }), 'monthly on day 9');
  assert.equal(Rec.stringify({ type: 'monthly-day', interval: 1, day: null }), 'monthly on day 1');
  assert.equal(
    Rec.stringify({ type: 'monthly-day', interval: 3, day: 12 }),
    'every 3 months on day 12',
  );
  assert.equal(
    Rec.stringify({ type: 'monthly-weekday', interval: 1, ord: 1, weekday: 1 }),
    'monthly on 1st mon',
  );
  assert.equal(
    Rec.stringify({ type: 'monthly-weekday', interval: 2, ord: -1, weekday: 5 }),
    'every 2 months on last fri',
  );
});

test('Rec.summary: every type + null/invalid', () => {
  assert.equal(Rec.summary(null), '');
  assert.equal(Rec.summary({ type: 'invalid', raw: 'x' }), 'invalid pattern');
  assert.equal(Rec.summary('daily'), 'Every day');
  assert.equal(Rec.summary('every 3 days'), 'Every 3 days');
  assert.equal(Rec.summary('weekly on mon,wed'), 'Weekly on Monday, Wednesday');
  assert.equal(Rec.summary({ type: 'weekly', interval: 1, days: null }), 'Weekly on —');
  assert.equal(Rec.summary('every 2 weeks on fri'), 'Every 2 weeks on Friday');
  assert.equal(Rec.summary('every 2 weeks'), 'Every 2 weeks');
  assert.equal(Rec.summary('monthly on day 3'), 'Monthly on the 3rd');
  assert.equal(Rec.summary('every 4 months'), 'Every 4 months'); // monthly-day, day null
  assert.equal(Rec.summary('every 2 months on day 21'), 'Every 2 months on the 21st');
  assert.equal(Rec.summary('monthly on last sun'), 'Monthly on the last Sunday');
  assert.equal(Rec.summary('every 3 months on 2nd mon'), 'Every 3 months on the 2nd Monday');
});

test('Rec.compact: every type + null/invalid', () => {
  assert.equal(Rec.compact(null), '');
  assert.equal(Rec.compact({ type: 'invalid', raw: 'x' }), '');
  assert.equal(Rec.compact('daily'), 'daily');
  assert.equal(Rec.compact('every 4 days'), '4d');
  assert.equal(Rec.compact('weekly on mon,wed'), 'Mo·We');
  assert.equal(Rec.compact({ type: 'weekly', interval: 1, days: null }), '—');
  assert.equal(Rec.compact('every 2 weeks on fri'), 'Fr/2w');
  assert.equal(Rec.compact('monthly on day 5'), 'day 5');
  assert.equal(Rec.compact('every 4 months'), '4mo'); // day null
  assert.equal(Rec.compact('every 2 months on day 7'), 'day 7/2mo');
  assert.equal(Rec.compact('monthly on last sun'), 'last Su');
  assert.equal(Rec.compact('every 3 months on 1st mon'), '1st Mo/3mo');
});

test('Rec.ordSuffix covers st/nd/rd/th + teens', () => {
  assert.equal(Rec.ordSuffix(1), 'st');
  assert.equal(Rec.ordSuffix(2), 'nd');
  assert.equal(Rec.ordSuffix(3), 'rd');
  assert.equal(Rec.ordSuffix(4), 'th');
  assert.equal(Rec.ordSuffix(11), 'th');
  assert.equal(Rec.ordSuffix(21), 'st');
});

test('Rec.matches / next / nextOccurrences edges', () => {
  // invalid / null -> no occurrences
  assert.deepEqual(Rec.nextOccurrences(null), []);
  assert.deepEqual(Rec.nextOccurrences('gibberish'), []);

  // daily, inclusive vs exclusive
  const incl = Rec.nextOccurrences('daily', { from: '2026-06-18', inclusive: true, count: 2 });
  assert.deepEqual(incl.map(Rec.ymd), ['2026-06-18', '2026-06-19']);
  const excl = Rec.nextOccurrences('daily', { from: '2026-06-18', count: 2 });
  assert.deepEqual(excl.map(Rec.ymd), ['2026-06-19', '2026-06-20']);

  // next single occurrence
  assert.equal(Rec.ymd(Rec.next('daily', '2026-06-18') as Date), '2026-06-19');

  // matches: date before anchor -> false
  assert.equal(
    Rec.matches(
      Rec.parseYMD('2026-06-10') as Date,
      Rec.parse('daily') as NonNullable<ReturnType<typeof Rec.parse>>,
      Rec.parseYMD('2026-06-18') as Date,
    ),
    false,
  );
  // weekly match where the day-of-week is excluded -> false
  assert.equal(
    Rec.matches(
      Rec.parseYMD('2026-06-18') as Date, // Thursday
      Rec.parse('weekly on mon') as NonNullable<ReturnType<typeof Rec.parse>>,
      Rec.parseYMD('2026-06-15') as Date,
    ),
    false,
  );
  // monthly-weekday "last" branch
  const lastFri = Rec.nextOccurrences('monthly on last fri', {
    from: '2026-06-01',
    anchor: '2026-06-01',
    inclusive: true,
    count: 1,
  });
  assert.equal(Rec.ymd(lastFri[0]), '2026-06-26');
});

// ---------------------------------------------------------------------------
// markdown.ts — frontmatter parse/serialize/inject + wikilink extraction.
// ---------------------------------------------------------------------------

test('parseNote: no frontmatter', () => {
  const r = parseNote('just a body\nline two');
  assert.equal(r.id, null);
  assert.deepEqual(r.frontmatter, {});
  assert.equal(r.body, 'just a body\nline two');
});

test('parseNote: frontmatter with id + extra keys, quoting variants', () => {
  const raw = [
    '---',
    'id: abc123',
    'title: "Has: a colon"',
    "alias: 'single quoted'",
    'plain: value',
    'noColonLineIsSkipped',
    ': empty-key-skipped',
    '---',
    '',
    'body text',
  ].join('\n');
  const r = parseNote(raw);
  assert.equal(r.id, 'abc123'); // id pulled out
  assert.equal(r.frontmatter.title, 'Has: a colon'); // double-quote unquoted
  assert.equal(r.frontmatter.alias, 'single quoted'); // single-quote unquoted
  assert.equal(r.frontmatter.plain, 'value'); // not quoted -> verbatim
  assert.ok(!('id' in r.frontmatter)); // id is removed from frontmatter map
  assert.equal(r.body, 'body text');
});

test('parseNote: frontmatter without an id', () => {
  const r = parseNote('---\ncolor: red\n---\nhello');
  assert.equal(r.id, null);
  assert.deepEqual(r.frontmatter, { color: 'red' });
  assert.equal(r.body, 'hello');
});

test('serializeNote: no frontmatter + leading-newline body trim', () => {
  const out = serializeNote({ id: 'x1', body: '\n\nhello world' });
  assert.equal(out, '---\nid: x1\n---\n\nhello world');
});

test('serializeNote: extra frontmatter incl. a value needing quoting', () => {
  const out = serializeNote({
    id: 'x2',
    body: 'b',
    frontmatter: { plain: 'simple', tricky: 'a: b', q: 'say "hi"' },
  });
  assert.ok(out.includes('id: x2'));
  assert.ok(out.includes('plain: simple')); // unquoted scalar
  assert.ok(out.includes('tricky: "a: b"')); // colon forces quoting
  assert.ok(out.includes('q: "say \\"hi\\""')); // inner quotes escaped
});

test('injectFrontmatterId: present vs absent', () => {
  // absent -> prepend a new block
  assert.equal(injectFrontmatterId('body only', 'newid'), '---\nid: newid\n---\n\nbody only');
  // present -> insert id after the opening fence, body preserved
  assert.equal(
    injectFrontmatterId('---\ntitle: T\n---\nbody', 'newid'),
    '---\nid: newid\ntitle: T\n---\nbody',
  );
});

test('extractLinks: typed, aliased, wiki, heading, alias, dedupe', () => {
  const body = [
    'see [[task:t1]] and [[event:e1|My Event]]',
    'plus [[Note Name]] and [[Other#heading]] and [[Aliased|shown]]',
    'dup [[task:t1]] [[task:t2]]',
    'empty after strip [[#only-heading]]',
  ].join('\n');
  const r = extractLinks(body);
  // t1 deduped; [[task:...]] is captured as a typed task link, never a note.
  assert.deepEqual(r.tasks.sort(), ['t1', 't2']);
  assert.deepEqual(r.events, ['e1']);
  assert.deepEqual(r.notes.sort(), ['Aliased', 'Note Name', 'Other'].sort());
  // the typed wikilinks are removed by the `continue` branch, not stored as notes
  assert.ok(!r.notes.some((n) => n.startsWith('task:') || n.startsWith('event:')));
});

test('extractLinks: no links -> empty arrays', () => {
  const r = extractLinks('plain text, no links here');
  assert.deepEqual(r, { tasks: [], events: [], notes: [], readables: [] });
});

test('extractLinks: readable-id wikilinks go to the readables bucket', () => {
  const r = extractLinks('see [[t_0001]] and [[alice_n_0002]] but [[Plain Note]]');
  assert.deepEqual(r.readables.sort(), ['alice_n_0002', 't_0001'].sort());
  assert.deepEqual(r.notes, ['Plain Note']);
});

// ---------------------------------------------------------------------------
// db.ts — openDatabase for both ':memory:' and a real temp file, and the
// applyMigrations idempotency (second run applies nothing).
// ---------------------------------------------------------------------------

test('openDatabase: in-memory opens + migrates + closes', () => {
  const { db, sqlite } = openDatabase(':memory:');
  try {
    // schema_migrations exists and has rows from the applied migrations
    const rows = sqlite.prepare('SELECT version FROM schema_migrations').all();
    assert.ok(rows.length > 0);
    // a core table from 001_init exists
    const t = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'")
      .get();
    assert.ok(t);
    assert.ok(db); // kysely instance returned
  } finally {
    sqlite.close();
  }
});

test('openDatabase: file path creates dirs; re-migrate is a no-op', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdx-units-'));
  const dbPath = path.join(dir, 'nested', 'sub', 'tdx.db'); // exercises mkdirSync recursive branch
  const first = openDatabase(dbPath);
  try {
    assert.ok(fs.existsSync(dbPath));
    // running migrations again applies nothing new (the `applied.has(file)` continue branch)
    const again = applyMigrations(first.sqlite);
    assert.deepEqual(again, []);
  } finally {
    first.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// services/recurrence.ts — completeTask spawn logic over an in-memory DB.
// Hits: task-missing return, recurrence true/false, nxt true/false,
// shiftReminder (null + present, with/without time), label-copy branch,
// and cloneSubtree recursion.
// ---------------------------------------------------------------------------

const recDb = openDatabase(':memory:');
after(() => recDb.sqlite.close());

let ownerSeq = 0;
async function seedOwner(): Promise<string> {
  const id = `owner-${++ownerSeq}`;
  const now = new Date().toISOString();
  await recDb.db
    .insertInto('users')
    .values({
      id,
      username: `u${ownerSeq}`,
      email: `u${ownerSeq}@example.com`,
      password_hash: 'x',
      theme: null,
      week_start: 1,
      sort_prefs: null,
      fib_sizing: 0,
      notes_root_name: 'inbox',
      is_admin: 0,
      created_at: now,
      updated_at: now,
    })
    .execute();
  return id;
}

async function insTask(owner: string, over: Record<string, unknown> = {}): Promise<string> {
  const id = `task-${owner}-${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();
  await recDb.db
    .insertInto('tasks')
    .values({
      id,
      owner_id: owner,
      creator_id: owner,
      assignee_id: null,
      project_id: null,
      parent_id: null,
      title: 't',
      done: 0,
      due: null,
      reminder: null,
      recurrence: null,
      notes: '',
      priority: 0,
      size: 0,
      position: 0,
      archived: 0,
      created_at: now,
      completed_at: null,
      updated_at: now,
      ...over,
    })
    .execute();
  return id;
}

test('completeTask: missing task -> null', async () => {
  const res = await completeTask(recDb.db, 'does-not-exist');
  assert.equal(res, null);
});

test('completeTask: non-recurring spawns nothing', async () => {
  const owner = await seedOwner();
  const id = await insTask(owner, { due: '2026-06-18' });
  const res = (await completeTask(recDb.db, id))!;
  assert.equal(res.task.done, true);
  assert.equal(res.created.length, 0);
});

test('completeTask: recurring with reminder + subtree + labels', async () => {
  const owner = await seedOwner();
  // a label to exercise the labs.length branch in cloneTask
  await recDb.db
    .insertInto('labels')
    .values({ id: `lab-${owner}`, owner_id: owner, name: 'L', pinned: 0 })
    .execute();

  const root = await insTask(owner, {
    title: 'root',
    recurrence: 'every 3 days',
    due: '2026-06-18',
    reminder: '2026-06-17T09:00', // reminder.length > 10 (has time) + day-gap branch
  });
  await recDb.db
    .insertInto('task_labels')
    .values({ task_id: root, label_id: `lab-${owner}` })
    .execute();

  // nested subtree: child + grandchild (cloneSubtree recursion)
  const child = await insTask(owner, { title: 'child', parent_id: root, position: 0 });
  await insTask(owner, { title: 'grandchild', parent_id: child, position: 0 });

  const res = (await completeTask(recDb.db, root))!;
  assert.equal(res.task.done, true);
  assert.equal(res.created.length, 3); // new root + child + grandchild

  const newRoot = res.created.find((c) => c.parentId === null)!;
  assert.equal(newRoot.title, 'root');
  assert.equal(newRoot.due, '2026-06-21'); // +3 days
  assert.equal(newRoot.reminder, '2026-06-20T09:00'); // gap (-1 day) + time preserved
  assert.equal(newRoot.done, false);
  // the copied label rode along
  assert.ok(newRoot.labels?.some((l) => l === `lab-${owner}`));
});

test('completeTask: recurring with no due falls back to today, reminder null', async () => {
  const owner = await seedOwner();
  // recurrence but NO due and NO reminder -> shiftReminder !reminder branch,
  // and Rec.next uses ymd(new Date()) fallback.
  const id = await insTask(owner, { title: 'noDue', recurrence: 'daily' });
  const res = (await completeTask(recDb.db, id))!;
  assert.equal(res.created.length, 1);
  assert.equal(res.created[0].reminder, null);
});
