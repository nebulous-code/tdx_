// tokens-extra.test.ts — branch-coverage top-up for PAT (personal access token)
// creation/listing/revocation (src/routes/tokens.ts) and the Bearer/scope auth
// branches it exercises in src/plugins/auth.ts + src/auth.ts / src/tokens.ts.
// These cases are intentionally disjoint from test/tokens.test.ts.

import assert from 'node:assert';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { hasScope } from '../src/auth.js';
import type { ResolvedPrincipal, SessionUser } from '../src/auth.js';
import { createToken, resolveBearer } from '../src/tokens.js';
import { buildTestApp, createAndLogin } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let cookie: string; // alice (admin)
let aliceId: string;

let bobCookie: string; // bob (non-admin)
let bobId: string;

before(async () => {
  ctx = await buildTestApp();
  app = ctx.app;
  const alice = await createAndLogin(app, ctx.db);
  cookie = alice.cookie;
  aliceId = alice.user.id;

  const bob = await createAndLogin(
    app,
    ctx.db,
    { username: 'bob', email: 'bob@example.com', password: 'B0b!secret' },
    { isAdmin: false },
  );
  bobCookie = bob.cookie;
  bobId = bob.user.id;
});
after(async () => {
  await app.close();
});

// ---- POST /api/auth/tokens : payload branches --------------------------------

test('create token: missing name → 400 (name required)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/tokens',
    headers: { cookie },
    payload: {},
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().field, 'name');
});

test('create token: whitespace-only name → 400 (trims to empty)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/tokens',
    headers: { cookie },
    payload: { name: '   ' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, 'name is required');
});

test('create token: no scopes → defaults to ["*"] (full)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/tokens',
    headers: { cookie },
    payload: { name: 'default-scope' },
  });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.json().scopes, ['*']);
});

test('create token: empty scopes array → defaults to ["*"]', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/tokens',
    headers: { cookie },
    payload: { name: 'empty-scopes', scopes: [] },
  });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.json().scopes, ['*']);
});

test('create token: non-array scopes → defaults to ["*"]', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/tokens',
    headers: { cookie },
    payload: { name: 'bad-scopes', scopes: 'tasks:read' },
  });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.json().scopes, ['*']);
});

test('create token: scopes coerced to strings; multiple scopes preserved', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/tokens',
    headers: { cookie },
    payload: { name: 'multi', scopes: ['tasks:read', 'tasks:write', 42] },
  });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.json().scopes, ['tasks:read', 'tasks:write', '42']);
});

// ---- write-scoped PAT can mint + revoke; admin scope on admin route ----------

test('write-scoped PAT can mint another token (write scope satisfied)', async () => {
  const create = await app.inject({
    method: 'POST',
    url: '/api/auth/tokens',
    headers: { cookie },
    payload: { name: 'writer', scopes: ['tasks:write'] },
  });
  const writer = create.json().token as string;

  const minted = await app.inject({
    method: 'POST',
    url: '/api/auth/tokens',
    headers: { authorization: `Bearer ${writer}` },
    payload: { name: 'minted-by-pat', scopes: ['tasks:read'] },
  });
  assert.equal(minted.statusCode, 201);
  assert.deepEqual(minted.json().scopes, ['tasks:read']);
});

test('admin-scoped PAT (admin user) reaches an admin-only route', async () => {
  const create = await app.inject({
    method: 'POST',
    url: '/api/auth/tokens',
    headers: { cookie },
    payload: { name: 'admin-pat', scopes: ['*'] },
  });
  const adminPat = create.json().token as string;

  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: { authorization: `Bearer ${adminPat}` },
    payload: {
      username: 'carol',
      email: 'carol@example.com',
      password: 'C4rol!secret',
      isAdmin: false,
    },
  });
  assert.equal(res.statusCode, 201, res.body);
});

test('non-admin user PAT is forbidden on an admin-only route (403)', async () => {
  const create = await app.inject({
    method: 'POST',
    url: '/api/auth/tokens',
    headers: { cookie: bobCookie },
    payload: { name: 'bob-pat', scopes: ['*'] },
  });
  const bobPat = create.json().token as string;

  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: { authorization: `Bearer ${bobPat}` },
    payload: { username: 'x', email: 'x@example.com', password: 'X1!xxxxx' },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error, 'forbidden');
});

test('admin route without any credential → 401', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/admin/users', payload: {} });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, 'unauthorized');
});

// ---- DELETE /api/auth/tokens/:id : 404 + owner isolation ---------------------

test('delete unknown token id → 404', async () => {
  const res = await app.inject({
    method: 'DELETE',
    url: '/api/auth/tokens/does-not-exist',
    headers: { cookie },
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, 'token not found');
});

test('deleting an already-revoked token → 404 (revoked_at filter)', async () => {
  await app.inject({
    method: 'POST',
    url: '/api/auth/tokens',
    headers: { cookie },
    payload: { name: 'double-revoke' },
  });
  const list = await app.inject({ method: 'GET', url: '/api/auth/tokens', headers: { cookie } });
  const id = list.json().find((t: { name: string; id: string }) => t.name === 'double-revoke').id;

  const first = await app.inject({
    method: 'DELETE',
    url: `/api/auth/tokens/${id}`,
    headers: { cookie },
  });
  assert.equal(first.statusCode, 204);

  const second = await app.inject({
    method: 'DELETE',
    url: `/api/auth/tokens/${id}`,
    headers: { cookie },
  });
  assert.equal(second.statusCode, 404);
});

test('owner isolation: bob cannot see or revoke alice tokens', async () => {
  const create = await app.inject({
    method: 'POST',
    url: '/api/auth/tokens',
    headers: { cookie },
    payload: { name: 'alice-secret' },
  });
  assert.equal(create.statusCode, 201);
  const aliceList = await app.inject({
    method: 'GET',
    url: '/api/auth/tokens',
    headers: { cookie },
  });
  const aliceTokId = aliceList
    .json()
    .find((t: { name: string; id: string }) => t.name === 'alice-secret').id;

  // bob's listing never includes alice's token
  const bobList = await app.inject({
    method: 'GET',
    url: '/api/auth/tokens',
    headers: { cookie: bobCookie },
  });
  assert.equal(bobList.statusCode, 200);
  assert.ok(!bobList.json().some((t: { id: string }) => t.id === aliceTokId));

  // bob revoking alice's token id → 404 (scoped by user_id, no cross-tenant write)
  const del = await app.inject({
    method: 'DELETE',
    url: `/api/auth/tokens/${aliceTokId}`,
    headers: { cookie: bobCookie },
  });
  assert.equal(del.statusCode, 404);

  // alice's token still authenticates (was not revoked by bob)
  const stillWorks = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { authorization: `Bearer ${create.json().token}` },
  });
  assert.equal(stillWorks.statusCode, 200);
});

// ---- Bearer resolution branches (plugins/auth.ts + tokens.ts) ----------------

test('malformed/unknown Bearer token → 401', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { authorization: 'Bearer tdx_pat_not-a-real-token' },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, 'unauthorized');
});

test('empty Bearer value → 401', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { authorization: 'Bearer ' },
  });
  assert.equal(res.statusCode, 401);
});

test('non-Bearer Authorization header falls through to (missing) cookie → 401', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { authorization: 'Basic dXNlcjpwYXNz' },
  });
  assert.equal(res.statusCode, 401);
});

test('garbage/tampered session cookie → 401 (unsign invalid)', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie: 'tdx_session=not-a-valid-signed-cookie' },
  });
  assert.equal(res.statusCode, 401);
});

// ---- direct resolveBearer branches (internal, route can't reach all arms) ----

test('resolveBearer("") returns null (empty-token guard)', async () => {
  assert.equal(await resolveBearer(ctx.db, ''), null);
});

test('resolveBearer of a valid token returns a non-full scoped principal', async () => {
  const { token } = await createToken(ctx.db, aliceId, 'direct', ['tasks:read', 'tasks:write']);
  const principal = await resolveBearer(ctx.db, token);
  assert.ok(principal);
  assert.equal(principal?.full, false);
  assert.equal(principal?.user.id, aliceId);
  assert.deepEqual(principal?.scopes, ['tasks:read', 'tasks:write']);
});

test('resolveBearer of a revoked token returns null', async () => {
  const { id, token } = await createToken(ctx.db, aliceId, 'will-revoke', ['*']);
  await ctx.db
    .updateTable('api_tokens')
    .set({ revoked_at: new Date().toISOString() })
    .where('id', '=', id)
    .execute();
  assert.equal(await resolveBearer(ctx.db, token), null);
});

test('resolveBearer with corrupt scopes JSON yields empty scopes (parse fallback)', async () => {
  const { id, token } = await createToken(ctx.db, aliceId, 'corrupt-scopes', ['tasks:read']);
  // Force the scopes column to invalid JSON so parseScopes hits its catch arm.
  await ctx.db
    .updateTable('api_tokens')
    .set({ scopes: 'not-json{' })
    .where('id', '=', id)
    .execute();
  const principal = await resolveBearer(ctx.db, token);
  assert.ok(principal);
  assert.deepEqual(principal?.scopes, []);
});

test('resolveBearer for a token whose user is gone returns null', async () => {
  // Create a transient user, mint a token, delete the user, then resolve.
  const { createUser } = await import('../src/seed.js');
  const ghost = await createUser(
    ctx.db,
    { username: 'ghost', email: 'ghost@example.com', password: 'Gh0st!secret' },
    { isAdmin: false },
  );
  const { token } = await createToken(ctx.db, ghost.id, 'orphan', ['*']);
  await ctx.db.deleteFrom('users').where('id', '=', ghost.id).execute();
  assert.equal(await resolveBearer(ctx.db, token), null);
});

// ---- hasScope branch matrix (pure) ------------------------------------------

test('hasScope: covers full, "*", bare action, domain-scoped, and miss', () => {
  const user = { id: bobId } as unknown as SessionUser;
  const p = (scopes: string[], full = false): ResolvedPrincipal => ({ user, scopes, full });

  // full session implies every scope (short-circuits before scope list)
  assert.equal(hasScope(p([], true), 'write'), true);
  // wildcard
  assert.equal(hasScope(p(['*']), 'write'), true);
  // bare action
  assert.equal(hasScope(p(['write']), 'write'), true);
  // domain-scoped suffix
  assert.equal(hasScope(p(['tasks:write']), 'write'), true);
  // read-only PAT lacks write
  assert.equal(hasScope(p(['tasks:read']), 'write'), false);
  // read-only PAT has read
  assert.equal(hasScope(p(['tasks:read']), 'read'), true);
  // empty, non-full → no scope
  assert.equal(hasScope(p([]), 'read'), false);
});
