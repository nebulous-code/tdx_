import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { createUser } from '../src/seed.js';
import { buildTestApp, createAndLogin, login } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let cookie: string;
let vault: string;

const j = (method: string, url: string, payload?: object, c = cookie) =>
  app.inject({
    method: method as 'GET',
    url,
    headers: { cookie: c },
    ...(payload ? { payload } : {}),
  });
const onDisk = (rel: string) => fs.readFileSync(path.join(vault, rel), 'utf8');

before(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'tdx-vault-'));
  process.env.VAULT_DIR = vault;
  ctx = await buildTestApp();
  app = ctx.app;
  ({ cookie } = await createAndLogin(app, ctx.db));
});
after(async () => {
  await app.close();
  fs.rmSync(vault, { recursive: true, force: true });
});

test('create writes a real .md with a frontmatter id; read returns the body', async () => {
  const res = await j('POST', '/api/notes', {
    title: 'Meeting Notes',
    body: 'discuss the roadmap',
  });
  assert.equal(res.statusCode, 201);
  const note = res.json();
  assert.ok(note.id);
  assert.equal(note.path, 'Meeting Notes.md'); // filename IS the title (Obsidian model)
  assert.equal(note.title, 'Meeting Notes');
  assert.equal(note.body, 'discuss the roadmap');

  // the file carries only the managed id — title lives in the filename, not frontmatter
  const raw = onDisk(note.path);
  assert.match(raw, new RegExp(`id: ${note.id}`));
  assert.ok(!/\ntitle:/.test(raw));
  assert.match(raw, /discuss the roadmap/);

  const got = await j('GET', `/api/notes/${note.id}`);
  assert.equal(got.statusCode, 200);
  assert.equal(got.json().body, 'discuss the roadmap');
});

test('the title is sanitized into a safe filename; collisions get a numeric suffix', async () => {
  const a = (await j('POST', '/api/notes', { title: 'Q3: Plan/Notes', body: 'x' })).json();
  assert.equal(a.path, 'Q3 PlanNotes.md'); // ':' and '/' stripped
  const b1 = (await j('POST', '/api/notes', { title: 'Dupe', body: '1' })).json();
  const b2 = (await j('POST', '/api/notes', { title: 'Dupe', body: '2' })).json();
  assert.equal(b1.path, 'Dupe.md');
  assert.equal(b2.path, 'Dupe 2.md'); // Obsidian-style disambiguation
});

test('editing the title renames the file on disk (id preserved)', async () => {
  const note = (await j('POST', '/api/notes', { title: 'Draft', body: 'v1' })).json();
  assert.equal(note.path, 'Draft.md');
  const upd = await j('PUT', `/api/notes/${note.id}`, { title: 'Final', body: 'v2 content' });
  assert.equal(upd.statusCode, 200);
  assert.equal(upd.json().title, 'Final');
  assert.equal(upd.json().path, 'Final.md'); // renamed on disk
  assert.equal(upd.json().body, 'v2 content');

  assert.ok(!fs.existsSync(path.join(vault, 'Draft.md'))); // old filename gone
  const raw = onDisk('Final.md');
  assert.match(raw, new RegExp(`id: ${note.id}`)); // same identity across the rename
  assert.match(raw, /v2 content/);

  const list = await j('GET', '/api/notes');
  assert.ok(
    list.json().some((n: { id: string; title: string }) => n.id === note.id && n.title === 'Final'),
  );
});

test('FTS search matches body words (porter stemming)', async () => {
  await j('POST', '/api/notes', { title: 'Garden', body: 'the quick brown foxes jumped' });
  const hits = await j('GET', '/api/notes/search?q=fox'); // fox* matches foxes
  assert.equal(hits.statusCode, 200);
  assert.ok(hits.json().some((h: { title: string }) => h.title === 'Garden'));
});

test('delete tombstones: gone from get / list / search, file removed', async () => {
  const note = (
    await j('POST', '/api/notes', { title: 'Ephemeral', body: 'unique-token-xyz' })
  ).json();
  assert.equal((await j('DELETE', `/api/notes/${note.id}`)).statusCode, 204);
  assert.equal((await j('GET', `/api/notes/${note.id}`)).statusCode, 404);
  assert.ok(!(await j('GET', '/api/notes')).json().some((n: { id: string }) => n.id === note.id));
  assert.equal((await j('GET', '/api/notes/search?q=unique-token-xyz')).json().length, 0);
  assert.ok(!fs.existsSync(path.join(vault, note.path)));
});

test('notes are owner-only: another user gets 404', async () => {
  const note = (await j('POST', '/api/notes', { title: 'Private', body: 'secret' })).json();
  await createUser(
    ctx.db,
    { username: 'bob', email: 'bob@x.com', password: 'B0b!secret' },
    { isAdmin: false },
  );
  const bob = await login(app, 'bob', 'B0b!secret');
  assert.equal((await j('GET', `/api/notes/${note.id}`, undefined, bob)).statusCode, 404);
  assert.equal((await j('PUT', `/api/notes/${note.id}`, { title: 'hax' }, bob)).statusCode, 404);
});

// ---- increment 2: vault scan / external edits ------------------------------

test('sync indexes an externally-created file and writes back a frontmatter id', async () => {
  fs.writeFileSync(path.join(vault, 'external.md'), '# Hand Written\n\nfrom nvim with zebraword');
  const res = await j('POST', '/api/notes/sync');
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().updated >= 1);

  const raw = fs.readFileSync(path.join(vault, 'external.md'), 'utf8');
  assert.match(raw, /^---\nid: [0-9a-f-]{36}\n/); // id written back, rest preserved
  assert.match(raw, /from nvim with zebraword/);

  // title comes from the filename ('external'), not the '# Hand Written' heading
  const hits = await j('GET', '/api/notes/search?q=zebraword');
  assert.ok(hits.json().some((h: { id: string; title: string }) => h.title === 'external'));
});

test('a rename on disk keeps the note id (so its links would survive)', async () => {
  const note = (await j('POST', '/api/notes', { title: 'Movable', body: 'stays put' })).json();
  fs.renameSync(path.join(vault, note.path), path.join(vault, 'moved-note.md'));
  assert.equal((await j('POST', '/api/notes/sync')).statusCode, 200);

  const got = await j('GET', `/api/notes/${note.id}`); // same id
  assert.equal(got.statusCode, 200);
  assert.equal(got.json().path, 'moved-note.md'); // new path
  assert.equal(got.json().body, 'stays put');
});

test('an external edit is reindexed (FTS reflects the new content)', async () => {
  const note = (
    await j('POST', '/api/notes', { title: 'Editable', body: 'original alphaword' })
  ).json();
  const p = path.join(vault, note.path);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('original alphaword', 'updated betaword'));
  await j('POST', '/api/notes/sync');

  assert.ok(
    (await j('GET', '/api/notes/search?q=betaword'))
      .json()
      .some((h: { id: string }) => h.id === note.id),
  );
  assert.equal(
    (await j('GET', '/api/notes/search?q=alphaword'))
      .json()
      .some((h: { id: string }) => h.id === note.id),
    false, // stale word no longer indexed
  );
});

test('removing a file on disk + sync tombstones the note', async () => {
  const note = (await j('POST', '/api/notes', { title: 'Doomed', body: 'goodbye' })).json();
  fs.unlinkSync(path.join(vault, note.path));
  const sum = await j('POST', '/api/notes/sync');
  assert.ok(sum.json().tombstoned >= 1);
  assert.equal((await j('GET', `/api/notes/${note.id}`)).statusCode, 404);
  assert.ok(!(await j('GET', '/api/notes')).json().some((n: { id: string }) => n.id === note.id));
});

test('incremental sync skips unchanged files (no-op second pass)', async () => {
  await j('POST', '/api/notes/sync'); // settle everything
  const again = await j('POST', '/api/notes/sync');
  assert.equal(again.json().updated, 0);
  assert.equal(again.json().tombstoned, 0);
});

// ---- increment 3: content-derived links (wikilinks → the graph) ------------

type Link = { id: string; rel: string; other: { type: string; id: string; title: string } };
const links = (type: string, id: string) =>
  j('GET', `/api/links?type=${type}&id=${id}`).then((r) => r.json() as Link[]);

test('a [[task:id]] in a note materializes a content edge on that task', async () => {
  const task = (await j('POST', '/api/tasks', { title: 'linked task' })).json();
  const note = (
    await j('POST', '/api/notes', { title: 'Refs', body: `see [[task:${task.id}]] for details` })
  ).json();
  // shows on the task (far side = the note)…
  assert.ok(
    (await links('task', task.id)).some((l) => l.other.type === 'note' && l.other.id === note.id),
  );
  // …and on the note (far side = the task)
  const noteSide = await links('note', note.id);
  assert.ok(noteSide.some((l) => l.other.type === 'task' && l.other.id === task.id));
  assert.equal(noteSide.find((l) => l.other.id === task.id)?.rel, 'note-task');
});

test('a [[event:id]] in a note materializes a content edge on that event', async () => {
  const ev = (await j('POST', '/api/events', { title: 'launch', startAt: '2026-07-01' })).json();
  const note = (
    await j('POST', '/api/notes', { title: 'Plan', body: `prep for [[event:${ev.id}]]` })
  ).json();
  assert.ok((await links('event', ev.id)).some((l) => l.other.id === note.id));
});

test('a [[Note Name]] wikilink shows on both notes (note↔note)', async () => {
  const target = (await j('POST', '/api/notes', { title: 'Alpha Topic', body: 'root' })).json();
  const src = (
    await j('POST', '/api/notes', { title: 'Index', body: 'see [[Alpha Topic]]' })
  ).json();
  assert.ok((await links('note', src.id)).some((l) => l.other.id === target.id));
  assert.ok((await links('note', target.id)).some((l) => l.other.id === src.id));
});

test('removing a wikilink from the body drops the content edge', async () => {
  const task = (await j('POST', '/api/tasks', { title: 'temp link' })).json();
  const note = (
    await j('POST', '/api/notes', { title: 'Mutable refs', body: `[[task:${task.id}]]` })
  ).json();
  assert.ok((await links('task', task.id)).some((l) => l.other.id === note.id));
  await j('PUT', `/api/notes/${note.id}`, { body: 'no more links here' });
  assert.equal(
    (await links('task', task.id)).some((l) => l.other.id === note.id),
    false,
  );
});

test('a dangling [[Name]] resolves on a later full scan once the target exists', async () => {
  const src = (
    await j('POST', '/api/notes', { title: 'Early', body: 'points at [[Late Note]]' })
  ).json();
  assert.equal((await links('note', src.id)).length, 0); // dangling — no edge yet
  const target = (await j('POST', '/api/notes', { title: 'Late Note', body: 'arrived' })).json();
  await j('POST', '/api/notes/sync?mode=full'); // re-resolves Early's wikilink
  assert.ok((await links('note', src.id)).some((l) => l.other.id === target.id));
});

test('the API can still app-link a note to a task (note-task rel)', async () => {
  const task = (await j('POST', '/api/tasks', { title: 'app linked' })).json();
  const note = (await j('POST', '/api/notes', { title: 'AppLink', body: 'no wikilinks' })).json();
  const res = await j('POST', '/api/links', {
    aType: 'note',
    aId: note.id,
    bType: 'task',
    bId: task.id,
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().rel, 'note-task');
  assert.ok((await links('note', note.id)).some((l) => l.other.id === task.id));
});
