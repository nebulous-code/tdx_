import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_VIEWS, ensureDefaultSavedQueries } from '../src/services/savedQueries.js';
import { buildTestApp, createAndLogin } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let ownerId: string;

before(async () => {
  process.env.VAULT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tdx-sqd-'));
  ctx = await buildTestApp();
  app = ctx.app;
  ownerId = (await createAndLogin(app, ctx.db)).user.id;
});
after(async () => {
  await ctx.app.close();
});

const viewsLike = (owner: string, marker: string) =>
  ctx.db
    .selectFrom('saved_queries')
    .select(['name', 'position'])
    .where('owner_id', '=', owner)
    .where('query', 'like', `%${marker}%`)
    .execute();
const countAll = async (owner: string) =>
  (await ctx.db.selectFrom('saved_queries').select('id').where('owner_id', '=', owner).execute())
    .length;

test('a freshly-seeded user already has every default view', async () => {
  assert.equal(await countAll(ownerId), DEFAULT_VIEWS.length);
});

test('ensureDefaultSavedQueries backfills missing event/note views, appended + idempotent', async () => {
  // simulate a legacy account: strip its event + note views, leave the task views
  await ctx.db
    .deleteFrom('saved_queries')
    .where('owner_id', '=', ownerId)
    .where((eb) => eb.or([eb('query', 'like', '%type:event%'), eb('query', 'like', '%type:note%')]))
    .execute();
  assert.equal((await viewsLike(ownerId, 'type:event')).length, 0);
  assert.equal((await viewsLike(ownerId, 'type:note')).length, 0);

  await ensureDefaultSavedQueries(ctx.db);
  const ev = await viewsLike(ownerId, 'type:event');
  const nt = await viewsLike(ownerId, 'type:note');
  assert.equal(ev.length, 3, 'the 3 event defaults were restored');
  assert.equal(nt.length, 4, 'the 4 note defaults were restored');

  // backfilled views are appended AFTER the surviving task views (no position collision)
  const taskMax = Math.max(...(await viewsLike(ownerId, 'type:task')).map((v) => v.position));
  const backfillMin = Math.min(...ev.concat(nt).map((v) => v.position));
  assert.ok(backfillMin > taskMax, 'event/note views were appended past the task views');

  // idempotent: running again adds nothing
  await ensureDefaultSavedQueries(ctx.db);
  assert.equal((await viewsLike(ownerId, 'type:event')).length, 3);
  assert.equal((await viewsLike(ownerId, 'type:note')).length, 4);
});

test('ensureDefaultSavedQueries skips a user who already has app views', async () => {
  const bob = (
    await createAndLogin(
      app,
      ctx.db,
      { username: 'bob', email: 'bob@example.com', password: 'Sup3r!secret' },
      { isAdmin: false },
    )
  ).user;
  const before = await countAll(bob.id); // freshly seeded → already has all defaults
  await ensureDefaultSavedQueries(ctx.db);
  assert.equal(
    await countAll(bob.id),
    before,
    'no duplicates for a user who already has the views',
  );
});
