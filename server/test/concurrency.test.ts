import assert from 'node:assert';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, createAndLogin } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let cookie: string;

before(async () => {
  ctx = await buildTestApp();
  app = ctx.app;
  ({ cookie } = await createAndLogin(app, ctx.db));
});
after(async () => {
  await app.close();
});

test('ETag / If-Match: stale → 412, correct → 200, absent → 200', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: { cookie },
    payload: { title: 'guarded' },
  });
  const task = created.json();
  const etag = created.headers.etag as string;
  assert.equal(etag, `"${task.updatedAt}"`);

  // stale precondition → 412 with the current entity
  const stale = await app.inject({
    method: 'PUT',
    url: `/api/tasks/${task.id}`,
    headers: { cookie, 'if-match': '"1999-01-01T00:00:00.000Z"' },
    payload: { title: 'x' },
  });
  assert.equal(stale.statusCode, 412);
  assert.equal(stale.json().error, 'stale');
  assert.equal(stale.json().current.id, task.id);

  // correct precondition → 200
  const ok = await app.inject({
    method: 'PUT',
    url: `/api/tasks/${task.id}`,
    headers: { cookie, 'if-match': etag },
    payload: { title: 'updated with etag' },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().title, 'updated with etag');

  // no precondition → allowed (pragmatic for single-user clients)
  const noMatch = await app.inject({
    method: 'PUT',
    url: `/api/tasks/${task.id}`,
    headers: { cookie },
    payload: { title: 'no etag needed' },
  });
  assert.equal(noMatch.statusCode, 200);
});
