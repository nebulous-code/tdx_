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

async function createToken(name: string, scopes?: string[]): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/tokens',
    headers: { cookie },
    payload: scopes ? { name, scopes } : { name },
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json();
  assert.ok(body.token.startsWith('tdx_pat_'));
  return body.token as string;
}

test('create a PAT; it authenticates a read; list omits the hash', async () => {
  const token = await createToken('cli');
  const me = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().username, 'alice');

  const list = await app.inject({ method: 'GET', url: '/api/auth/tokens', headers: { cookie } });
  assert.equal(list.statusCode, 200);
  const tokens = list.json();
  assert.ok(tokens.some((t: { name: string }) => t.name === 'cli'));
  assert.ok(!('token_hash' in tokens[0]) && !('token' in tokens[0]));
});

test('read-only PAT: can read, but is blocked from a write (403)', async () => {
  const ro = await createToken('readonly-agent', ['tasks:read']);
  // read works
  const read = await app.inject({
    method: 'GET',
    url: '/api/auth/tokens',
    headers: { authorization: `Bearer ${ro}` },
  });
  assert.equal(read.statusCode, 200);
  // write (minting another token) is rejected for the read-only scope
  const write = await app.inject({
    method: 'POST',
    url: '/api/auth/tokens',
    headers: { authorization: `Bearer ${ro}` },
    payload: { name: 'should-fail' },
  });
  assert.equal(write.statusCode, 403);
  assert.equal(write.json().error, 'insufficient scope');
});

test('revoked PAT no longer authenticates', async () => {
  const token = await createToken('temp');
  const list = await app.inject({ method: 'GET', url: '/api/auth/tokens', headers: { cookie } });
  const id = list.json().find((t: { name: string; id: string }) => t.name === 'temp').id;

  const del = await app.inject({
    method: 'DELETE',
    url: `/api/auth/tokens/${id}`,
    headers: { cookie },
  });
  assert.equal(del.statusCode, 204);

  const me = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(me.statusCode, 401);
});
