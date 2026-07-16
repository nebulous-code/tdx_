import assert from 'node:assert';
import { test } from 'node:test';

// registerAuth THROWS without a session secret, and this is the one test that calls buildApp
// directly instead of going through test/support/app.ts (which sets this for every other
// suite). It used to pass anyway — but only because `dotenv/config` picked up a developer's
// local server/.env, which is gitignored and does not exist in CI. A test that passes only on
// the machine that has an untracked file isn't a test, so set it here and stay hermetic.
// Must run BEFORE ../src/app.js is imported: that module has an import-time `dotenv/config`.
process.env.SESSION_SECRET ||= 'test-secret-please-change';

const { buildApp } = await import('../src/app.js');

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
