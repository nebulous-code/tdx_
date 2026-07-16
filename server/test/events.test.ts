import assert from 'node:assert';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { createUser } from '../src/seed.js';
import { buildTestApp, createAndLogin, login } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let cookie: string;

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
  ({ cookie } = await createAndLogin(app, ctx.db));
});
after(async () => {
  await app.close();
});

test('event create / read / update / delete', async () => {
  const created = await j('POST', '/api/events', { title: 'standup', startAt: '2026-07-10T09:00' });
  assert.equal(created.statusCode, 201);
  const ev = created.json();
  assert.equal(ev.title, 'standup');
  assert.equal(ev.allDay, false);
  assert.ok(created.headers.etag);

  assert.equal((await j('GET', `/api/events/${ev.id}`)).statusCode, 200);

  const upd = await j('PUT', `/api/events/${ev.id}`, { title: 'team standup', location: 'room 2' });
  assert.equal(upd.statusCode, 200);
  assert.equal(upd.json().title, 'team standup');
  assert.equal(upd.json().location, 'room 2');

  const del = await j('DELETE', `/api/events/${ev.id}`);
  assert.equal(del.statusCode, 204);
  // archived → drops out of the range read
  const range = await j('GET', '/api/events?from=2026-07-01&to=2026-07-31');
  assert.ok(!range.json().occurrences.some((o: { id: string }) => o.id === ev.id));
});

test('range read expands recurring events and includes one-offs', async () => {
  const mk = (body: object) => j('POST', '/api/events', body).then((r) => r.json());
  const timed = await mk({ title: 'timed', startAt: '2026-07-10T14:00' });
  const allDay = await mk({ title: 'holiday', startAt: '2026-07-15', allDay: true });
  const weekly = await mk({
    title: 'gym',
    startAt: '2026-07-06',
    recurrence: 'weekly on mon,wed,fri',
  });
  const outside = await mk({ title: 'later', startAt: '2026-08-20' });

  const res = await j('GET', '/api/events?from=2026-07-01&to=2026-07-31');
  assert.equal(res.statusCode, 200);
  const occ = res.json().occurrences as { id: string; date: string }[];

  // one-offs land on their date
  assert.deepEqual(
    occ.filter((o) => o.id === timed.id).map((o) => o.date),
    ['2026-07-10'],
  );
  assert.deepEqual(
    occ.filter((o) => o.id === allDay.id).map((o) => o.date),
    ['2026-07-15'],
  );
  // out-of-window one-off excluded
  assert.equal(occ.filter((o) => o.id === outside.id).length, 0);
  // weekly expanded onto every Mon/Wed/Fri in July from the start date
  assert.deepEqual(
    occ.filter((o) => o.id === weekly.id).map((o) => o.date),
    [
      '2026-07-06',
      '2026-07-08',
      '2026-07-10',
      '2026-07-13',
      '2026-07-15',
      '2026-07-17',
      '2026-07-20',
      '2026-07-22',
      '2026-07-24',
      '2026-07-27',
      '2026-07-29',
      '2026-07-31',
    ],
  );
});

test('If-Match: stale → 412, correct → 200', async () => {
  const ev = (await j('POST', '/api/events', { title: 'guarded', startAt: '2026-07-01' })).json();
  const stale = await app.inject({
    method: 'PUT',
    url: `/api/events/${ev.id}`,
    headers: { cookie, 'if-match': '"1999-01-01T00:00:00.000Z"' },
    payload: { title: 'x' },
  });
  assert.equal(stale.statusCode, 412);
  assert.equal(stale.json().current.id, ev.id);

  const ok = await app.inject({
    method: 'PUT',
    url: `/api/events/${ev.id}`,
    headers: { cookie, 'if-match': `"${ev.updatedAt}"` },
    payload: { title: 'ok' },
  });
  assert.equal(ok.statusCode, 200);
});

test('events are owner-only: another user gets 404', async () => {
  const ev = (await j('POST', '/api/events', { title: 'mine', startAt: '2026-07-02' })).json();
  await createUser(
    ctx.db,
    { username: 'bob', email: 'bob@x.com', password: 'B0b!secret' },
    { isAdmin: false },
  );
  const bob = await login(app, 'bob', 'B0b!secret');
  assert.equal((await j('GET', `/api/events/${ev.id}`, undefined, bob)).statusCode, 404);
  assert.equal((await j('PUT', `/api/events/${ev.id}`, { title: 'hax' }, bob)).statusCode, 404);
});
