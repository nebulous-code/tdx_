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
let dir: string;

before(async () => {
  ctx = await buildTestApp();
  app = ctx.app;
  ({ cookie } = await createAndLogin(app, ctx.db)); // alice = admin
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdx-backup-'));
});
after(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('config defaults; validation rejects bad dir/time/retention', async () => {
  const cfg = await app.inject({ method: 'GET', url: '/api/backups/config', headers: { cookie } });
  assert.equal(cfg.statusCode, 200);
  const body = cfg.json();
  assert.equal(body.enabled, false);
  assert.equal(body.time_of_day, '02:00');
  assert.equal(body.retention, 7);

  for (const [payload, where] of [
    [{ dir: 'relative/path' }, 'dir'],
    [{ time_of_day: '25:00' }, 'time'],
    [{ retention: 0 }, 'retention'],
  ] as const) {
    const r = await app.inject({
      method: 'PUT',
      url: '/api/backups/config',
      headers: { cookie },
      payload,
    });
    assert.equal(r.statusCode, 400, `expected 400 for bad ${where}`);
  }
});

test('configure + run a backup → a file lands and is listed', async () => {
  const put = await app.inject({
    method: 'PUT',
    url: '/api/backups/config',
    headers: { cookie },
    payload: { enabled: true, dir, time_of_day: '03:30', retention: 5 },
  });
  assert.equal(put.statusCode, 200);
  assert.equal(put.json().dir, dir);
  assert.equal(put.json().dirOk, true);

  const run = await app.inject({ method: 'POST', url: '/api/backups/run', headers: { cookie } });
  assert.equal(run.statusCode, 200);
  assert.match(run.json().name, /^tdx-\d{8}-\d{6}\.db$/);
  assert.ok(fs.existsSync(path.join(dir, run.json().name)));

  const list = await app.inject({ method: 'GET', url: '/api/backups', headers: { cookie } });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().files.length, 1);
  assert.equal(list.json().files[0].name, run.json().name);
});

test('browse lists the directory', async () => {
  const res = await app.inject({
    method: 'GET',
    url: `/api/backups/browse?path=${encodeURIComponent(dir)}`,
    headers: { cookie },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, true);
  assert.equal(res.json().writable, true);
});

test('admin-gated: non-admin → 403, unauthenticated → 401', async () => {
  await createUser(
    ctx.db,
    { username: 'bob', email: 'bob@x.com', password: 'B0b!secret' },
    { isAdmin: false },
  );
  const bob = await login(app, 'bob', 'B0b!secret');
  const forbidden = await app.inject({
    method: 'GET',
    url: '/api/backups/config',
    headers: { cookie: bob },
  });
  assert.equal(forbidden.statusCode, 403);
  const anon = await app.inject({ method: 'GET', url: '/api/backups/config' });
  assert.equal(anon.statusCode, 401);
});
