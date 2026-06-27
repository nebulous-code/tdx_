import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { resolveReadable } from '../src/services/readableIds.js';
import { buildTestApp, createAndLogin } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let cookie: string;
let aliceId: string;
let bob: string;
let bobId: string;
let vault: string;

const j = (method: string, url: string, payload?: object, c = cookie) =>
  app.inject({
    method: method as 'GET',
    url,
    headers: { cookie: c },
    ...(payload ? { payload } : {}),
  });

before(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'tdx-rid-'));
  process.env.VAULT_DIR = vault;
  ctx = await buildTestApp();
  app = ctx.app;
  const a = await createAndLogin(app, ctx.db);
  cookie = a.cookie;
  aliceId = a.user.id;
  const b = await createAndLogin(
    app,
    ctx.db,
    { username: 'bob', email: 'bob@example.com', password: 'Sup3r!secret' },
    { isAdmin: false },
  );
  bob = b.cookie;
  bobId = b.user.id;
});
after(async () => {
  await app.close();
  fs.rmSync(vault, { recursive: true, force: true });
});

test('each entity type gets a prefixed readable id', async () => {
  const task = (await j('POST', '/api/tasks', { title: 'T' })).json();
  assert.match(task.readableId, /^t_\d{4,}$/);
  const proj = (await j('POST', '/api/projects', { name: 'P' })).json();
  assert.match(proj.readableId, /^p_\d{4,}$/);
  const cal = (await j('POST', '/api/calendars', { name: 'C' })).json();
  assert.match(cal.readableId, /^c_\d{4,}$/);
  const folder = (await j('POST', '/api/folders', { name: 'F' })).json();
  assert.match(folder.readableId, /^f_\d{4,}$/);
  const ev = (await j('POST', '/api/events', { title: 'E', startAt: '2026-07-01' })).json();
  assert.match(ev.readableId, /^e_\d{4,}$/);
  const note = (await j('POST', '/api/notes', { title: 'N' })).json();
  assert.match(note.readableId, /^n_\d{4,}$/);
});

test('readable ids are monotonic per type and independent per user', async () => {
  // alice already created a project (p_0001 = inbox) at signup, then 'P' above.
  const a1 = (await j('POST', '/api/calendars', { name: 'A1' })).json();
  const a2 = (await j('POST', '/api/calendars', { name: 'A2' })).json();
  const n1 = Number(a1.readableId.split('_')[1]);
  const n2 = Number(a2.readableId.split('_')[1]);
  assert.equal(n2, n1 + 1); // monotonic
  // bob's first calendar starts its own sequence (a default 'Calendar' may exist → just check prefix)
  const bcal = (await j('POST', '/api/calendars', { name: 'B' }, bob)).json();
  assert.match(bcal.readableId, /^c_\d{4,}$/);
});

test('resolveReadable: own bare id, cross-user prefixed, unknown → null', async () => {
  const task = (await j('POST', '/api/tasks', { title: 'Resolve me' })).json();
  // own bare id resolves to the uuid
  const own = await resolveReadable(ctx.db, aliceId, task.readableId);
  assert.equal(own?.id, task.id);
  assert.equal(own?.kind, 'task');
  // bob references alice's task by username prefix
  const cross = await resolveReadable(ctx.db, bobId, `alice_${task.readableId}`);
  assert.equal(cross?.id, task.id);
  assert.equal(cross?.ownerId, aliceId);
  // unknown id and unknown user both → null (no enumeration)
  assert.equal(await resolveReadable(ctx.db, aliceId, 't_9999'), null);
  assert.equal(await resolveReadable(ctx.db, bobId, 'ghost_t_0001'), null);
  assert.equal(await resolveReadable(ctx.db, aliceId, 'not-an-id'), null);
});

test('a [[t_0001]] wikilink in a note resolves to a content link on the task', async () => {
  const task = (await j('POST', '/api/tasks', { title: 'Linked task' })).json();
  await j('POST', '/api/notes', { title: 'Refers', body: `jump to [[${task.readableId}]]` });
  const links = await j('GET', `/api/links?type=task&id=${task.id}`);
  assert.equal(links.statusCode, 200);
  // the note shows up as a (content-derived) link on the task
  assert.ok(JSON.stringify(links.json()).includes('Refers'));
});
