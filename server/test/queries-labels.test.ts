import assert from 'node:assert';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { createLabel, getLabel, mergeLabels, updateLabel } from '../src/services/labels.js';
import { createSavedQuery, getSavedQuery, updateSavedQuery } from '../src/services/savedQueries.js';
import { buildTestApp, createAndLogin } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let cookie: string;
let bobCookie: string;
let aliceId: string;
let bobId: string;

const j = (method: string, url: string, payload?: object, c: string = cookie) =>
  app.inject({
    method: method as 'GET',
    url,
    headers: { cookie: c },
    ...(payload ? { payload } : {}),
  });

before(async () => {
  ctx = await buildTestApp();
  app = ctx.app;
  const alice = await createAndLogin(app, ctx.db);
  cookie = alice.cookie;
  aliceId = alice.user.id;
  const bob = await createAndLogin(
    app,
    ctx.db,
    { username: 'bob', email: 'bob@example.com', password: 'Sup3r!secret' },
    { isAdmin: false },
  );
  bobCookie = bob.cookie;
  bobId = bob.user.id;
});
after(async () => {
  await app.close();
});

// ---------- saved queries: create defaults vs provided ----------

test('saved-query create applies defaults when optionals omitted', async () => {
  const sv = (await j('POST', '/api/saved-queries', { name: 'defaults', query: 'a:1' })).json();
  assert.equal(sv.glyph, '◆'); // glyph ?? '◆'
  assert.equal(sv.color, null); // color ?? null
  assert.equal(sv.pinned, false); // pinned ? 1 : 0 (falsy)
  assert.equal(sv.system, false);
  assert.ok(typeof sv.position === 'number');
});

test('saved-query create honors all provided optionals incl. explicit id', async () => {
  const sv = (
    await j('POST', '/api/saved-queries', {
      id: 'sq-custom-1',
      name: 'provided',
      query: 'b:2',
      glyph: '★',
      color: '#abc',
      pinned: true,
      position: 42,
    })
  ).json();
  assert.equal(sv.id, 'sq-custom-1'); // input.id ?? newId()
  assert.equal(sv.glyph, '★');
  assert.equal(sv.color, '#abc');
  assert.equal(sv.pinned, true);
  assert.equal(sv.position, 42);
});

test('saved-query position derives from max existing position', async () => {
  // create directly so we control owner & assert the max() branch (no explicit position)
  const a = await createSavedQuery(ctx.db, aliceId, {
    name: 'm1',
    query: 'x',
    position: 100,
  });
  const b = await createSavedQuery(ctx.db, aliceId, { name: 'm2', query: 'y' });
  assert.equal(a.position, 100);
  assert.equal(b.position, 101); // Number(m?.m ?? 0) + 1
});

test('saved-query position falls back to 1 when owner has none (max() is null)', async () => {
  // every seeded user starts with 6 system saved queries; clear them so the
  // owner truly has zero → max('position') returns null → Number(m?.m ?? 0) + 1 === 1.
  const owner = (
    await createAndLogin(
      ctx.app,
      ctx.db,
      { username: 'carol', email: 'carol@example.com', password: 'Sup3r!secret' },
      { isAdmin: false },
    )
  ).user.id;
  await ctx.db.deleteFrom('saved_queries').where('owner_id', '=', owner).execute();
  const sv = await createSavedQuery(ctx.db, owner, { name: 'first', query: 'z' });
  assert.equal(sv.position, 1);
});

// ---------- saved queries: update partial / empty / pinned toggle ----------

test('saved-query update with a single field leaves others intact', async () => {
  const sv = (
    await j('POST', '/api/saved-queries', {
      name: 'orig',
      query: 'q',
      glyph: '◆',
      pinned: true,
    })
  ).json();
  const upd = (await j('PUT', `/api/saved-queries/${sv.id}`, { query: 'q2' })).json();
  assert.equal(upd.query, 'q2');
  assert.equal(upd.name, 'orig'); // untouched
  assert.equal(upd.pinned, true); // untouched
});

test('saved-query update can unpin (pinned false branch)', async () => {
  const sv = (
    await j('POST', '/api/saved-queries', { name: 'tog', query: 'q', pinned: true })
  ).json();
  const upd = (await j('PUT', `/api/saved-queries/${sv.id}`, { pinned: false })).json();
  assert.equal(upd.pinned, false); // pinned ? 1 : 0 (false branch)
});

test('updateSavedQuery sets color to null when patch.color is null', async () => {
  // exercise the `if (patch.color !== undefined) set.color = patch.color` branch
  // with an explicit null, asserting the stored value directly.
  const sv = await createSavedQuery(ctx.db, aliceId, {
    name: 'colnull',
    query: 'q',
    color: '#fff',
  });
  const upd = await updateSavedQuery(ctx.db, sv.id, { color: null });
  assert.equal(upd?.color, null);
});

test('saved-query update can set every patch field', async () => {
  const sv = await createSavedQuery(ctx.db, aliceId, { name: 'all', query: 'q' });
  const upd = await updateSavedQuery(ctx.db, sv.id, {
    name: 'all2',
    query: 'q2',
    glyph: '★', // a.9: ♥ is no longer a legal glyph — the picker is the source of truth
    color: '#123',
    pinned: true,
    position: 7,
  });
  assert.equal(upd?.name, 'all2');
  assert.equal(upd?.query, 'q2');
  assert.equal(upd?.glyph, '★');
  assert.equal(upd?.color, '#123');
  assert.equal(upd?.pinned, true);
  assert.equal(upd?.position, 7);
});

test('saved-query update with empty patch is a no-op (skips the write)', async () => {
  const sv = await createSavedQuery(ctx.db, aliceId, { name: 'noop', query: 'q' });
  const upd = await updateSavedQuery(ctx.db, sv.id, {}); // Object.keys(set).length === 0
  assert.equal(upd?.name, 'noop');
});

test('updateSavedQuery on a missing id returns null', async () => {
  const upd = await updateSavedQuery(ctx.db, 'sq-does-not-exist', { name: 'x' });
  assert.equal(upd, null);
});

test('getSavedQuery returns null for a missing id', async () => {
  assert.equal(await getSavedQuery(ctx.db, 'nope'), null);
});

// ---------- saved queries: route access (404 missing / owner isolation) ----------

test('GET saved-query 404 for unknown id', async () => {
  const res = await j('GET', '/api/saved-queries/missing-sq');
  assert.equal(res.statusCode, 404);
});

test("saved-query owner isolation: bob cannot read/update/delete alice's", async () => {
  const sv = (await j('POST', '/api/saved-queries', { name: 'alice-only', query: 'q' })).json();
  assert.equal(
    (await j('GET', `/api/saved-queries/${sv.id}`, undefined, bobCookie)).statusCode,
    404,
  );
  assert.equal(
    (await j('PUT', `/api/saved-queries/${sv.id}`, { name: 'hax' }, bobCookie)).statusCode,
    404,
  );
  assert.equal(
    (await j('DELETE', `/api/saved-queries/${sv.id}`, undefined, bobCookie)).statusCode,
    404,
  );
});

test('DELETE saved-query 404 for unknown id', async () => {
  assert.equal((await j('DELETE', '/api/saved-queries/missing-sq')).statusCode, 404);
});

// ---------- labels: create defaults / pinned ----------

test('label create defaults pinned to false', async () => {
  const label = (await j('POST', '/api/labels', { name: 'plain' })).json();
  assert.equal(label.pinned, false); // pinned ? 1 : 0 (falsy)
});

test('label create honors explicit id and pinned', async () => {
  const label = (
    await j('POST', '/api/labels', { id: 'lbl-custom', name: 'p', pinned: true })
  ).json();
  assert.equal(label.id, 'lbl-custom'); // input.id ?? newId()
  assert.equal(label.pinned, true);
});

// ---------- labels: update partial / empty / name-only / pinned-only ----------

test('label update name-only leaves pinned intact', async () => {
  const label = await createLabel(ctx.db, aliceId, { name: 'n', pinned: true });
  const upd = await updateLabel(ctx.db, label.id, { name: 'n2' });
  assert.equal(upd?.name, 'n2');
  assert.equal(upd?.pinned, true);
});

test('label update pinned-only leaves name intact', async () => {
  const label = await createLabel(ctx.db, aliceId, { name: 'keep' });
  const upd = await updateLabel(ctx.db, label.id, { pinned: true });
  assert.equal(upd?.pinned, true);
  assert.equal(upd?.name, 'keep');
});

test('label update with empty patch is a no-op', async () => {
  const label = await createLabel(ctx.db, aliceId, { name: 'noop' });
  const upd = await updateLabel(ctx.db, label.id, {}); // Object.keys(set).length === 0
  assert.equal(upd?.name, 'noop');
});

test('getLabel returns null for a missing id', async () => {
  assert.equal(await getLabel(ctx.db, 'nope'), null);
});

// ---------- labels: route access (404 / owner isolation) ----------

test('GET label 404 for unknown id', async () => {
  assert.equal((await j('GET', '/api/labels/missing-label')).statusCode, 404);
});

test("label owner isolation: bob cannot touch alice's", async () => {
  const label = (await j('POST', '/api/labels', { name: 'alice-only' })).json();
  assert.equal((await j('GET', `/api/labels/${label.id}`, undefined, bobCookie)).statusCode, 404);
  assert.equal(
    (await j('PUT', `/api/labels/${label.id}`, { name: 'hax' }, bobCookie)).statusCode,
    404,
  );
  assert.equal(
    (await j('DELETE', `/api/labels/${label.id}`, undefined, bobCookie)).statusCode,
    404,
  );
});

// ---------- labels: merge edge cases ----------

test('merge into self is rejected (fromId === toId)', async () => {
  const label = (await j('POST', '/api/labels', { name: 'self' })).json();
  const res = await j('POST', '/api/labels/merge', { from: label.id, to: label.id });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { error: 'cannot merge those labels' });
});

test('merge 404 when the `from` label is unknown (denyAccess on from)', async () => {
  const to = (await j('POST', '/api/labels', { name: 'mt-to' })).json();
  const res = await j('POST', '/api/labels/merge', { from: 'no-such-from', to: to.id });
  assert.equal(res.statusCode, 404);
});

test('merge 404 when the `to` label is unknown (denyAccess on to)', async () => {
  const from = (await j('POST', '/api/labels', { name: 'mt-from' })).json();
  const res = await j('POST', '/api/labels/merge', { from: from.id, to: 'no-such-to' });
  assert.equal(res.statusCode, 404);
});

test('merge across owners is rejected at the service (both must belong to owner)', async () => {
  // alice owns `from`; pass a non-owner id as `to` so both.length !== 2
  const from = await createLabel(ctx.db, aliceId, { name: 'x-owner-from' });
  const foreign = await createLabel(ctx.db, bobId, { name: 'foreign' });
  const ok = await mergeLabels(ctx.db, aliceId, from.id, foreign.id);
  assert.equal(ok, false); // both.length !== 2
  // and the source label is left untouched since merge bailed
  assert.ok(await getLabel(ctx.db, from.id));
});

test('merge dedupes when the target already carries the label on a task', async () => {
  const a = (await j('POST', '/api/labels', { name: 'dd-a' })).json();
  const b = (await j('POST', '/api/labels', { name: 'dd-b' })).json();
  // task already has BOTH → merging a→b must dedupe (onConflict doNothing)
  const boot = await (
    await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { cookie } })
  ).json();
  const inboxId = boot.projects.find((p: { name: string }) => p.name === 'Inbox').id;
  const t = (
    await j('POST', '/api/tasks', {
      title: 'has both',
      projectId: inboxId,
      labels: [a.id, b.id],
    })
  ).json();

  const merge = await j('POST', '/api/labels/merge', { from: a.id, to: b.id });
  assert.equal(merge.statusCode, 200);
  assert.deepEqual(merge.json(), { ok: true });

  const got = await j('GET', `/api/tasks/${t.id}`);
  assert.deepEqual(got.json().labels, [b.id]); // deduped, single survivor
  assert.equal(await getLabel(ctx.db, a.id), null); // source dropped
});

test('merge re-points a task that only had the source label', async () => {
  const a = (await j('POST', '/api/labels', { name: 'rp-a' })).json();
  const b = (await j('POST', '/api/labels', { name: 'rp-b' })).json();
  const boot = await (
    await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { cookie } })
  ).json();
  const inboxId = boot.projects.find((p: { name: string }) => p.name === 'Inbox').id;
  const t = (
    await j('POST', '/api/tasks', { title: 'has a only', projectId: inboxId, labels: [a.id] })
  ).json();

  const ok = await mergeLabels(ctx.db, aliceId, a.id, b.id);
  assert.equal(ok, true);

  const got = await j('GET', `/api/tasks/${t.id}`);
  assert.deepEqual(got.json().labels, [b.id]);
});
