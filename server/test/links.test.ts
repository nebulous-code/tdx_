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

// create a task / event and return its id
const mkTask = (title: string) =>
  j('POST', '/api/tasks', { title }).then((r) => r.json().id as string);
const mkEvent = (title: string) =>
  j('POST', '/api/events', { title, startAt: '2026-07-10' }).then((r) => r.json().id as string);

before(async () => {
  ctx = await buildTestApp();
  app = ctx.app;
  ({ cookie } = await createAndLogin(app, ctx.db));
});
after(async () => {
  await app.close();
});

test('link is canonical + idempotent regardless of create order', async () => {
  const taskId = await mkTask('prep agenda');
  const eventId = await mkEvent('planning meeting');

  // create from the event side
  const a = await j('POST', '/api/links', {
    aType: 'event',
    aId: eventId,
    bType: 'task',
    bId: taskId,
  });
  assert.equal(a.statusCode, 201);
  assert.equal(a.json().rel, 'event-task');
  assert.deepEqual(a.json().other, { type: 'task', id: taskId, title: 'prep agenda' });

  // create again from the task side (swapped) → same canonical edge, same id
  const b = await j('POST', '/api/links', {
    aType: 'task',
    aId: taskId,
    bType: 'event',
    bId: eventId,
  });
  assert.equal(b.statusCode, 201);
  assert.equal(b.json().id, a.json().id, 'idempotent: same edge id');
  // presented from a=task's POV now, so `other` is the event
  assert.deepEqual(b.json().other, { type: 'event', id: eventId, title: 'planning meeting' });

  // exactly one edge exists, visible from both sides
  const fromEvent = await j('GET', `/api/links?type=event&id=${eventId}`);
  const fromTask = await j('GET', `/api/links?type=task&id=${taskId}`);
  assert.equal(fromEvent.json().length, 1);
  assert.equal(fromTask.json().length, 1);
  assert.equal(fromEvent.json()[0].other.type, 'task');
  assert.equal(fromTask.json()[0].other.type, 'event');
});

test('unsupported pairs are rejected (400)', async () => {
  const t1 = await mkTask('a');
  const t2 = await mkTask('b');
  // task-task is outside the taxonomy
  const res = await j('POST', '/api/links', { aType: 'task', aId: t1, bType: 'task', bId: t2 });
  assert.equal(res.statusCode, 400);
});

test('links to an archived endpoint are hidden on read', async () => {
  const taskId = await mkTask('soon archived');
  const eventId = await mkEvent('keeps going');
  await j('POST', '/api/links', { aType: 'event', aId: eventId, bType: 'task', bId: taskId });
  assert.equal((await j('GET', `/api/links?type=event&id=${eventId}`)).json().length, 1);

  // archive the task → the edge drops out of the event's list (but isn't deleted)
  await j('DELETE', `/api/tasks/${taskId}`);
  assert.equal((await j('GET', `/api/links?type=event&id=${eventId}`)).json().length, 0);
});

test('delete removes the edge from both sides', async () => {
  const taskId = await mkTask('linked');
  const eventId = await mkEvent('linked too');
  const link = (
    await j('POST', '/api/links', { aType: 'event', aId: eventId, bType: 'task', bId: taskId })
  ).json();

  assert.equal((await j('DELETE', `/api/links/${link.id}`)).statusCode, 204);
  assert.equal((await j('GET', `/api/links?type=event&id=${eventId}`)).json().length, 0);
  assert.equal((await j('GET', `/api/links?type=task&id=${taskId}`)).json().length, 0);
});

test("cannot link or list another user's entities", async () => {
  const taskId = await mkTask('alice task');
  const eventId = await mkEvent('alice event');
  await createUser(
    ctx.db,
    { username: 'bob', email: 'bob@x.com', password: 'B0b!secret' },
    { isAdmin: false },
  );
  const bob = await login(app, 'bob', 'B0b!secret');

  // bob owns neither endpoint → 404 on create
  assert.equal(
    (
      await j(
        'POST',
        '/api/links',
        { aType: 'event', aId: eventId, bType: 'task', bId: taskId },
        bob,
      )
    ).statusCode,
    404,
  );
  // and 404 listing alice's entity's links
  assert.equal(
    (await j('GET', `/api/links?type=task&id=${taskId}`, undefined, bob)).statusCode,
    404,
  );
});
