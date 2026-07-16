// Extra branch coverage for services/events.ts + routes/events.ts.
// Complements test/events.test.ts; targets the ?? defaults (both arms),
// the position fallback on a fresh owner, null lookups, every optional
// patch field, stale If-Match, archive, owner isolation, and the range
// read across one-off / recurring / invalid-recurrence / before-start.

import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import {
  archiveEvent,
  createEvent,
  eventsInRange,
  getEvent,
  updateEvent,
} from '../src/services/events.js';
import { buildTestApp, createAndLogin } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let cookie: string;
let aliceId: string;
let bobCookie: string;
let bobId: string;

const j = (method: string, url: string, payload?: object, c = cookie) =>
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

// ---- createEvent: both arms of every ?? default ---------------------------

test('createEvent uses defaults for omitted optional fields', async () => {
  // brand-new owner → max(position) is null → position fallback = 0 + 1 = 1
  const ev = await createEvent(ctx.db, bobId, {
    title: 'bare',
    startAt: '2026-09-01T10:00',
  });
  assert.equal(ev.assigneeId, null);
  assert.equal(ev.notes, '');
  assert.equal(ev.location, null);
  assert.equal(ev.allDay, false);
  assert.equal(ev.endAt, null);
  assert.equal(ev.recurrence, null);
  assert.equal(ev.reminder, null);
  assert.equal(ev.position, 1);

  // second create for the same owner → max() now 1 → fallback = 2
  const ev2 = await createEvent(ctx.db, bobId, { title: 'next', startAt: '2026-09-02T10:00' });
  assert.equal(ev2.position, 2);
});

test('createEvent stores all optional fields when supplied', async () => {
  const id = randomUUID();
  const ev = await createEvent(ctx.db, aliceId, {
    id,
    title: 'full',
    notes: 'detailed',
    location: 'room 5',
    allDay: true,
    startAt: '2026-09-10',
    endAt: '2026-09-11',
    recurrence: 'daily',
    reminder: '2026-09-10T08:00',
    assigneeId: aliceId,
    position: 42,
  });
  assert.equal(ev.id, id); // input.id arm of `input.id ?? newId()`
  assert.equal(ev.notes, 'detailed');
  assert.equal(ev.location, 'room 5');
  assert.equal(ev.allDay, true);
  assert.equal(ev.endAt, '2026-09-11');
  assert.equal(ev.recurrence, 'daily');
  assert.equal(ev.reminder, '2026-09-10T08:00');
  assert.equal(ev.assigneeId, aliceId);
  assert.equal(ev.position, 42); // explicit position arm
});

// ---- getEvent null --------------------------------------------------------

test('getEvent returns null for a missing id', async () => {
  assert.equal(await getEvent(ctx.db, aliceId, 'does-not-exist'), null);
});

// ---- updateEvent: missing, every patch field, stale ----------------------

test('updateEvent returns null when the row is missing', async () => {
  assert.equal(await updateEvent(ctx.db, aliceId, 'nope', { title: 'x' }), null);
});

test('updateEvent applies every optional patch field', async () => {
  const ev = await createEvent(ctx.db, aliceId, { title: 'patch me', startAt: '2026-09-20T09:00' });
  const out = await updateEvent(ctx.db, aliceId, ev.id, {
    title: 'patched',
    notes: 'new notes',
    location: 'somewhere',
    allDay: true,
    startAt: '2026-09-21T09:00',
    endAt: '2026-09-21T10:00',
    recurrence: 'weekly on mon',
    reminder: '2026-09-21T08:00',
    assigneeId: aliceId,
    position: 99,
  });
  assert.ok(out);
  assert.equal(out.title, 'patched');
  assert.equal(out.notes, 'new notes');
  assert.equal(out.location, 'somewhere');
  assert.equal(out.allDay, true);
  assert.equal(out.startAt, '2026-09-21T09:00');
  assert.equal(out.endAt, '2026-09-21T10:00');
  assert.equal(out.recurrence, 'weekly on mon');
  assert.equal(out.reminder, '2026-09-21T08:00');
  assert.equal(out.assigneeId, aliceId);
  assert.equal(out.position, 99);
});

test('updateEvent with allDay:false hits the falsy all_day arm', async () => {
  const ev = await createEvent(ctx.db, aliceId, {
    title: 'allday',
    startAt: '2026-09-22',
    allDay: true,
  });
  const out = await updateEvent(ctx.db, aliceId, ev.id, { allDay: false });
  assert.ok(out);
  assert.equal(out.allDay, false);
});

test('updateEvent throws PreconditionFailed on a stale If-Match', async () => {
  const ev = await createEvent(ctx.db, aliceId, { title: 'guard', startAt: '2026-09-25T09:00' });
  await assert.rejects(
    () => updateEvent(ctx.db, aliceId, ev.id, { title: 'x' }, '"1999-01-01T00:00:00.000Z"'),
    /stale/,
  );
  // correct If-Match succeeds
  const ok = await updateEvent(ctx.db, aliceId, ev.id, { title: 'ok' }, `"${ev.updatedAt}"`);
  assert.ok(ok);
  assert.equal(ok.title, 'ok');
});

// ---- archiveEvent ---------------------------------------------------------

test('archiveEvent hides the row from the range read but keeps GET id', async () => {
  const ev = await createEvent(ctx.db, aliceId, { title: 'doomed', startAt: '2026-10-05T09:00' });
  await archiveEvent(ctx.db, aliceId, ev.id);
  // still fetchable by id (QUIRK)
  assert.ok(await getEvent(ctx.db, aliceId, ev.id));
  // dropped from range read
  const occ = await eventsInRange(ctx.db, aliceId, '2026-10-01', '2026-10-31');
  assert.ok(!occ.some((o) => o.id === ev.id));
});

// ---- eventsInRange: one-off vs recurring vs invalid vs before-start -------

test('eventsInRange: one-off outside the window is excluded', async () => {
  const ev = await createEvent(ctx.db, aliceId, { title: 'far', startAt: '2026-12-25T09:00' });
  const occ = await eventsInRange(ctx.db, aliceId, '2026-11-01', '2026-11-30');
  assert.ok(!occ.some((o) => o.id === ev.id));
});

test('eventsInRange: invalid recurrence falls back to a single one-off occurrence', async () => {
  const ev = await createEvent(ctx.db, aliceId, {
    title: 'bogus rule',
    startAt: '2026-11-10T09:00',
    recurrence: 'gibberish nonsense',
  });
  const occ = await eventsInRange(ctx.db, aliceId, '2026-11-01', '2026-11-30');
  const mine = occ.filter((o) => o.id === ev.id);
  assert.deepEqual(
    mine.map((o) => o.date),
    ['2026-11-10'],
  );
});

test('eventsInRange: recurring series only expands on/after its start date', async () => {
  // series starts mid-window; days before the start must be skipped
  const ev = await createEvent(ctx.db, aliceId, {
    title: 'daily series',
    startAt: '2026-11-15T09:00',
    recurrence: 'daily',
  });
  const occ = await eventsInRange(ctx.db, aliceId, '2026-11-10', '2026-11-18');
  const dates = occ.filter((o) => o.id === ev.id).map((o) => o.date);
  // window opens 11-10 but the first occurrence is the start date 11-15
  assert.deepEqual(dates, ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18']);
});

test('eventsInRange: window entirely before the series start yields nothing', async () => {
  const ev = await createEvent(ctx.db, aliceId, {
    title: 'future series',
    startAt: '2027-03-01',
    recurrence: 'daily',
  });
  const occ = await eventsInRange(ctx.db, aliceId, '2027-01-01', '2027-01-31');
  assert.equal(occ.filter((o) => o.id === ev.id).length, 0);
});

// ---- route layer: create / range read / update / delete happy paths ------

test('route POST create returns 201 with etag, GET range + PUT + DELETE work', async () => {
  const created = await j('POST', '/api/events', {
    title: 'routed',
    startAt: '2026-08-05T09:00',
    recurrence: 'daily',
  });
  assert.equal(created.statusCode, 201);
  assert.ok(created.headers.etag);
  const ev = created.json();

  // GET range route (the calendar read) expands the daily series in-window
  const range = await j('GET', '/api/events?from=2026-08-04&to=2026-08-07');
  assert.equal(range.statusCode, 200);
  const dates = (range.json().occurrences as { id: string; date: string }[])
    .filter((o) => o.id === ev.id)
    .map((o) => o.date);
  assert.deepEqual(dates, ['2026-08-05', '2026-08-06', '2026-08-07']);

  // PUT success path through the route
  const upd = await j('PUT', `/api/events/${ev.id}`, { title: 'routed-2' });
  assert.equal(upd.statusCode, 200);
  assert.equal(upd.json().title, 'routed-2');
  assert.ok(upd.headers.etag);

  // DELETE success path through the route → 204
  assert.equal((await j('DELETE', `/api/events/${ev.id}`)).statusCode, 204);
});

// ---- route layer: 404 on missing + owner isolation -----------------------

test('GET missing event id → 404', async () => {
  assert.equal((await j('GET', '/api/events/missing-id')).statusCode, 404);
});

test('PUT missing event id → 404', async () => {
  assert.equal((await j('PUT', '/api/events/missing-id', { title: 'x' })).statusCode, 404);
});

test('route PUT 412 on stale If-Match returns current', async () => {
  const ev = (await j('POST', '/api/events', { title: 'r-guard', startAt: '2026-07-01' })).json();
  const stale = await app.inject({
    method: 'PUT',
    url: `/api/events/${ev.id}`,
    headers: { cookie, 'if-match': '"bogus"' },
    payload: { title: 'x' },
  });
  assert.equal(stale.statusCode, 412);
  assert.equal(stale.json().current.id, ev.id);
});

test('events are owner-only: a second user gets 404 on GET/PUT/DELETE', async () => {
  const ev = (await j('POST', '/api/events', { title: 'aliceonly', startAt: '2026-07-02' })).json();
  assert.equal((await j('GET', `/api/events/${ev.id}`, undefined, bobCookie)).statusCode, 404);
  assert.equal(
    (await j('PUT', `/api/events/${ev.id}`, { title: 'hax' }, bobCookie)).statusCode,
    404,
  );
  assert.equal((await j('DELETE', `/api/events/${ev.id}`, undefined, bobCookie)).statusCode, 404);
});
