import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import {
  archiveCalendar,
  ensureDefaultCalendars,
  updateCalendar,
} from '../src/services/calendars.js';
import { updateFolder } from '../src/services/folders.js';
import { buildTestApp, createAndLogin } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let cookie: string;
let bob: string;
let vault: string;
let ownerId: string;

const j = (method: string, url: string, payload?: object, c = cookie) =>
  app.inject({
    method: method as 'GET',
    url,
    headers: { cookie: c },
    ...(payload ? { payload } : {}),
  });
const vp = (rel: string) => path.join(vault, ownerId, rel);

before(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'tdx-cf-'));
  process.env.VAULT_DIR = vault;
  ctx = await buildTestApp();
  app = ctx.app;
  const li = await createAndLogin(app, ctx.db);
  cookie = li.cookie;
  ownerId = li.user.id;
  bob = (
    await createAndLogin(
      app,
      ctx.db,
      { username: 'bob', email: 'bob@example.com', password: 'Sup3r!secret' },
      { isAdmin: false },
    )
  ).cookie;
});
after(async () => {
  await app.close();
  fs.rmSync(vault, { recursive: true, force: true });
});

// ---- calendars -------------------------------------------------------------

test('calendar CRUD + defaults + owner isolation', async () => {
  const c = await j('POST', '/api/calendars', { name: 'Work' });
  assert.equal(c.statusCode, 201);
  const cal = c.json();
  assert.equal(cal.name, 'Work');
  assert.equal(cal.color, '#ffb000'); // default
  assert.ok(c.headers.etag);

  const got = await j('GET', `/api/calendars/${cal.id}`);
  assert.equal(got.statusCode, 200);

  const upd = await j('PUT', `/api/calendars/${cal.id}`, { name: 'Work!', color: '#3fd7d7' });
  assert.equal(upd.json().name, 'Work!');
  assert.equal(upd.json().color, '#3fd7d7');

  // bob can't see or edit alice's calendar
  assert.equal((await j('GET', `/api/calendars/${cal.id}`, undefined, bob)).statusCode, 404);
});

test('archiving a calendar archives its events', async () => {
  const cal = (await j('POST', '/api/calendars', { name: 'Trips' })).json();
  const ev = (
    await j('POST', '/api/events', { title: 'flight', startAt: '2026-07-01', calendarId: cal.id })
  ).json();
  assert.equal(ev.calendarId, cal.id);

  const del = await j('DELETE', `/api/calendars/${cal.id}`);
  assert.equal(del.statusCode, 204);
  // the event is gone from the calendar range read (archived)
  const range = (await j('GET', '/api/events?from=2026-06-01&to=2026-08-01')).json();
  assert.ok(!range.occurrences.some((o: { id: string }) => o.id === ev.id));
});

test('event carries calendarId + labels round-trip', async () => {
  const cal = (await j('POST', '/api/calendars', { name: 'Cal' })).json();
  const label = (await j('POST', '/api/labels', { name: 'travel' })).json();
  const ev = (
    await j('POST', '/api/events', {
      title: 'trip',
      startAt: '2026-09-01',
      calendarId: cal.id,
      labels: [label.id],
    })
  ).json();
  assert.equal(ev.calendarId, cal.id);
  assert.deepEqual(ev.labels, [label.id]);
  const got = (await j('GET', `/api/events/${ev.id}`)).json();
  assert.deepEqual(got.labels, [label.id]);
});

test('updateEvent can change calendar + labels', async () => {
  const cal1 = (await j('POST', '/api/calendars', { name: 'One' })).json();
  const cal2 = (await j('POST', '/api/calendars', { name: 'Two' })).json();
  const l1 = (await j('POST', '/api/labels', { name: 'l1' })).json();
  const l2 = (await j('POST', '/api/labels', { name: 'l2' })).json();
  const ev = (
    await j('POST', '/api/events', {
      title: 'm',
      startAt: '2026-10-01',
      calendarId: cal1.id,
      labels: [l1.id],
    })
  ).json();
  const upd = await j('PUT', `/api/events/${ev.id}`, { calendarId: cal2.id, labels: [l2.id] });
  assert.equal(upd.statusCode, 200);
  assert.equal(upd.json().calendarId, cal2.id);
  assert.deepEqual(upd.json().labels, [l2.id]);
});

// ---- folders + vault sync --------------------------------------------------

test('folder create makes a dir + marker; a note in it gets folder_id + nested path', async () => {
  const f = await j('POST', '/api/folders', { name: 'Recipes', glyph: '▸', color: '#46d369' });
  assert.equal(f.statusCode, 201);
  const folder = f.json();
  assert.equal(folder.path, 'Recipes');
  // dir + marker exist on disk
  assert.ok(fs.existsSync(vp('Recipes')));
  const marker = JSON.parse(fs.readFileSync(vp('Recipes/.tdx-folder.json'), 'utf8'));
  assert.equal(marker.id, folder.id);

  const note = (
    await j('POST', '/api/notes', { title: 'Soup', body: 'boil', folderId: folder.id })
  ).json();
  assert.equal(note.folderId, folder.id);
  assert.equal(note.path, 'Recipes/Soup.md');
  assert.ok(fs.existsSync(vp('Recipes/Soup.md')));
});

test('folder rename moves the dir + re-paths its notes', async () => {
  const folder = (await j('POST', '/api/folders', { name: 'Old' })).json();
  const note = (await j('POST', '/api/notes', { title: 'N', folderId: folder.id })).json();
  assert.equal(note.path, 'Old/N.md');

  const upd = await j('PUT', `/api/folders/${folder.id}`, { name: 'New' });
  assert.equal(upd.json().path, 'New');
  assert.ok(fs.existsSync(vp('New/N.md')));
  assert.ok(!fs.existsSync(vp('Old')));
  // the note row's path followed the move
  const got = (await j('GET', `/api/notes/${note.id}`)).json();
  assert.equal(got.path, 'New/N.md');
});

test('delete folder: 409 when non-empty, 204 when empty', async () => {
  const folder = (await j('POST', '/api/folders', { name: 'Holder' })).json();
  const note = (await j('POST', '/api/notes', { title: 'inside', folderId: folder.id })).json();
  assert.equal((await j('DELETE', `/api/folders/${folder.id}`)).statusCode, 409);
  // move the note out (to root), then the folder deletes
  await j('PUT', `/api/notes/${note.id}`, { folderId: null });
  assert.equal((await j('DELETE', `/api/folders/${folder.id}`)).statusCode, 204);
  assert.ok(!fs.existsSync(vp('Holder')));
});

test('scan reconciles an externally-created dir into a folder entity', async () => {
  fs.mkdirSync(vp('External'), { recursive: true });
  fs.writeFileSync(vp('External/dropped.md'), '# dropped\n');
  const sync = await j('POST', '/api/notes/sync', { mode: 'full' });
  assert.equal(sync.statusCode, 200);
  const folders = (await j('GET', '/api/bootstrap')).json().folders;
  const ext = folders.find((f: { path: string }) => f.path === 'External');
  assert.ok(ext, 'External folder entity was created');
  // a marker was written back into the bare dir
  assert.ok(fs.existsSync(vp('External/.tdx-folder.json')));
});

// ---- note review date + labels ---------------------------------------------

test('note review date round-trips through frontmatter', async () => {
  const note = (await j('POST', '/api/notes', { title: 'Study', reviewAt: '2026-07-15' })).json();
  assert.equal(note.reviewAt, '2026-07-15');
  // the .md frontmatter carries review:
  assert.match(fs.readFileSync(vp('Study.md'), 'utf8'), /review:\s*2026-07-15/);
  const got = (await j('GET', `/api/notes/${note.id}`)).json();
  assert.equal(got.reviewAt, '2026-07-15');
  // clearing it removes review from frontmatter
  await j('PUT', `/api/notes/${note.id}`, { reviewAt: null });
  assert.equal((await j('GET', `/api/notes/${note.id}`)).json().reviewAt, null);
});

test('note labels via API', async () => {
  const label = (await j('POST', '/api/labels', { name: 'reading' })).json();
  const note = (await j('POST', '/api/notes', { title: 'Book', labels: [label.id] })).json();
  assert.deepEqual(note.labels, [label.id]);
});

// ---- edge / error branches -------------------------------------------------

test('calendar 404 (missing) + 412 (stale If-Match)', async () => {
  assert.equal((await j('GET', '/api/calendars/nope')).statusCode, 404);
  assert.equal((await j('PUT', '/api/calendars/nope', { name: 'x' })).statusCode, 404);
  const cal = (await j('POST', '/api/calendars', { name: 'C' })).json();
  const stale = await app.inject({
    method: 'PUT',
    url: `/api/calendars/${cal.id}`,
    headers: { cookie, 'if-match': '"bogus"' },
    payload: { name: 'y' },
  });
  assert.equal(stale.statusCode, 412);
});

test('archiveCalendar on a missing id is a no-op (service guard)', async () => {
  await assert.doesNotReject(archiveCalendar(ctx.db, ownerId, 'no-such-cal'));
});

test('ensureDefaultCalendars mints a default + assigns orphan events', async () => {
  // bob has no calendar yet; give him an event with no calendar
  const ev = (
    await j('POST', '/api/events', { title: 'orphan', startAt: '2026-05-01' }, bob)
  ).json();
  assert.equal(ev.calendarId, null);
  await ensureDefaultCalendars(ctx.db);
  const got = (await j('GET', `/api/events/${ev.id}`, undefined, bob)).json();
  assert.ok(got.calendarId, 'orphan event was assigned a default calendar');
});

test('folder metadata-only update (no dir move)', async () => {
  const folder = (await j('POST', '/api/folders', { name: 'Styled' })).json();
  const upd = await j('PUT', `/api/folders/${folder.id}`, { color: '#3fd7d7', glyph: '◆' });
  assert.equal(upd.json().color, '#3fd7d7');
  assert.equal(upd.json().glyph, '◆');
  assert.equal(upd.json().path, 'Styled'); // unchanged
});

test('folder reparent moves it under the new parent', async () => {
  const parent = (await j('POST', '/api/folders', { name: 'Parent' })).json();
  const child = (await j('POST', '/api/folders', { name: 'Child' })).json();
  const moved = await j('PUT', `/api/folders/${child.id}`, { parentId: parent.id });
  assert.equal(moved.json().path, 'Parent/Child');
  assert.ok(fs.existsSync(vp('Parent/Child')));
});

test('folder 404 (missing) + 412 (stale If-Match)', async () => {
  assert.equal((await j('GET', '/api/folders/nope')).statusCode, 404);
  assert.equal((await j('DELETE', '/api/folders/nope')).statusCode, 404);
  const folder = (await j('POST', '/api/folders', { name: 'Concur' })).json();
  const stale = await app.inject({
    method: 'PUT',
    url: `/api/folders/${folder.id}`,
    headers: { cookie, 'if-match': '"bogus"' },
    payload: { name: 'z' },
  });
  assert.equal(stale.statusCode, 412);
});

test('reconcile reuses an existing marker id for an external dir', async () => {
  fs.mkdirSync(vp('Marked'), { recursive: true });
  fs.writeFileSync(
    vp('Marked/.tdx-folder.json'),
    JSON.stringify({ id: 'f-premade', color: '#46d369', glyph: '★' }),
  );
  fs.writeFileSync(vp('Marked/m.md'), '# m\n');
  await j('POST', '/api/notes/sync', { mode: 'full' });
  const folder = (await j('GET', '/api/folders/f-premade')).json();
  assert.equal(folder.path, 'Marked');
  assert.equal(folder.glyph, '★');
});

test('folder name collision suffixes the dir; junk names fall back', async () => {
  const a = (await j('POST', '/api/folders', { name: 'Dup' })).json();
  const b = (await j('POST', '/api/folders', { name: 'Dup' })).json();
  assert.equal(a.path, 'Dup');
  assert.equal(b.path, 'Dup 2');
  const junk = (await j('POST', '/api/folders', { name: '///' })).json();
  assert.equal(junk.path, 'untitled');
});

test('reconcile mints a fresh id when the marker is malformed', async () => {
  fs.mkdirSync(vp('Broken'), { recursive: true });
  fs.writeFileSync(vp('Broken/.tdx-folder.json'), '{ not valid json');
  fs.writeFileSync(vp('Broken/b.md'), '# b\n');
  await j('POST', '/api/notes/sync', { mode: 'full' });
  const folders = (await j('GET', '/api/bootstrap')).json().folders;
  const broken = folders.find((f: { path: string }) => f.path === 'Broken');
  assert.ok(broken && broken.id, 'a fresh folder id was minted');
  // a valid marker was written back
  const m = JSON.parse(fs.readFileSync(vp('Broken/.tdx-folder.json'), 'utf8'));
  assert.equal(m.id, broken.id);
});

test('updateCalendar / updateFolder return null for a missing id (service guard)', async () => {
  assert.equal(await updateCalendar(ctx.db, ownerId, 'no-cal', { name: 'x' }), null);
  assert.equal(await updateFolder(ctx.db, ownerId, 'no-folder', { name: 'x' }), null);
});

test('create folder nested under a parent', async () => {
  const parent = (await j('POST', '/api/folders', { name: 'Top' })).json();
  const child = (await j('POST', '/api/folders', { name: 'Sub', parentId: parent.id })).json();
  assert.equal(child.path, 'Top/Sub');
  assert.equal(child.parentId, parent.id);
  assert.ok(fs.existsSync(vp('Top/Sub')));
});

test('delete folder is blocked by a subfolder too (409)', async () => {
  const parent = (await j('POST', '/api/folders', { name: 'HasSub' })).json();
  await j('POST', '/api/folders', { name: 'Inner', parentId: parent.id });
  assert.equal((await j('DELETE', `/api/folders/${parent.id}`)).statusCode, 409);
});

test('folder metadata update with the same name is a no-op rename', async () => {
  const folder = (await j('POST', '/api/folders', { name: 'Same' })).json();
  const upd = await j('PUT', `/api/folders/${folder.id}`, { name: 'Same', color: '#ff5c5c' });
  assert.equal(upd.json().path, 'Same'); // unchanged (no dir move)
  assert.equal(upd.json().color, '#ff5c5c');
  assert.ok(fs.existsSync(vp('Same')));
});

// ---------------------------------------------------------------------------
// a.9 — the glyph picker is the SOURCE OF TRUTH. `glyph` used to be an unvalidated
// string, so the UI's list and the database never had to agree (that's how a ♥ nobody
// could select ended up on a seeded calendar). The REQUEST schemas now reject anything
// outside frontend/js/glyphs.js — see also test/glyphs.test.ts, which parity-locks the
// two lists so the server can't start refusing glyphs the picker still offers.
// ---------------------------------------------------------------------------

test('glyph lock: an off-list glyph is a 400 on every entity that has one', async () => {
  const calls: [string, string, object][] = [
    ['POST', '/api/calendars', { name: 'Nope', glyph: '♥' }],
    ['POST', '/api/folders', { name: 'Nope', glyph: '♥' }],
    ['POST', '/api/projects', { name: 'Nope', glyph: '♥' }],
    ['POST', '/api/saved-queries', { name: 'Nope', query: 'x', glyph: '♥' }],
  ];
  for (const [m, url, payload] of calls) {
    const res = await j(m, url, payload);
    assert.equal(res.statusCode, 400, `${url} accepted an off-list glyph`);
  }
  // ⌂ left the picker with a.9 too (the Inbox project moved to ❯)
  const oldInbox = await j('POST', '/api/projects', { name: 'Nope', glyph: '⌂' });
  assert.equal(oldInbox.statusCode, 400);
});

test('glyph lock: the glyphs the app itself ships are all accepted', async () => {
  // the whole point of growing the list to 40: every icon the app already shipped —
  // the system views' ☉ ○ ! and ▸, the folder default — must be selectable AND storable.
  const cal = await j('POST', '/api/calendars', { name: 'Sys', glyph: '☉' });
  assert.equal(cal.statusCode, 201);
  assert.equal(cal.json().glyph, '☉');

  const fol = await j('POST', '/api/folders', { name: 'SysFolder', glyph: '▸' });
  assert.equal(fol.statusCode, 201);
  assert.equal(fol.json().glyph, '▸');

  // and an update is guarded too, not just a create
  const bad = await j('PUT', `/api/calendars/${cal.json().id}`, { glyph: '♥' });
  assert.equal(bad.statusCode, 400);
});
