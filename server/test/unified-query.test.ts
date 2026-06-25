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

test('default (no type:) returns only tasks, tagged', async () => {
  const res = await query('');
  assert.ok(res.items.length >= 1);
  assert.ok(res.items.every((i: Item) => i.type === 'task'));
  assert.ok(res.items.some((i: Item) => i.title === 'alpha task'));
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
