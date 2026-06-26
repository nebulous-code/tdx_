import assert from 'node:assert';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';

// buildApp is normally exercised with an injected in-memory DB (see test/support/app.ts).
// This covers the OTHER arm of the handle ternary — opening its own DB from dbPath — and
// the serveFrontend:false branch, which the injected-DB harness never hits.
test('buildApp opens its own DB (no injected handle) and can skip static serving', async () => {
  const app = await buildApp({ dbPath: ':memory:', serveFrontend: false, logger: false });
  await app.ready();

  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().status, 'ok');

  // serveFrontend:false → no static wildcard, so an unknown non-API path 404s
  const miss = await app.inject({ method: 'GET', url: '/not-a-route' });
  assert.equal(miss.statusCode, 404);

  await app.close();
});
