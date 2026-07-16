// openapi.test.ts — guards the API docs: every route stays documented, the auth schemes
// and metadata are present, and the committed docs/openapi.json can't silently drift.

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { buildSpec } from '../scripts/export-openapi.js';

type Op = { summary?: string; tags?: string[]; responses?: Record<string, unknown> };
const METHODS = ['get', 'post', 'put', 'delete', 'patch'];

test('openapi: every operation carries summary + tags + responses', async () => {
  const spec = await buildSpec();
  const missing: string[] = [];
  for (const [p, methods] of Object.entries(spec.paths as Record<string, Record<string, Op>>)) {
    for (const [m, op] of Object.entries(methods)) {
      if (!METHODS.includes(m)) continue;
      const ok = op.summary && op.tags?.length && op.responses && Object.keys(op.responses).length;
      if (!ok) missing.push(`${m.toUpperCase()} ${p}`);
    }
  }
  assert.deepEqual(missing, [], `undocumented operations: ${missing.join('; ')}`);
});

test('openapi: security schemes + metadata are present', async () => {
  const spec = await buildSpec();
  assert.ok(spec.components?.securitySchemes?.cookieAuth, 'cookieAuth scheme');
  assert.ok(spec.components?.securitySchemes?.bearerAuth, 'bearerAuth scheme');
  assert.equal(spec.info.version, '1.0.0');
  assert.notEqual(spec.info.description, 'D1 backend'); // the stale placeholder is gone
  assert.ok((spec.tags || []).length >= 10, 'a tag per resource');
});

test('openapi: committed docs/openapi.json is in sync (else run `npm run export:openapi`)', async () => {
  const spec = await buildSpec();
  const file = path.resolve(process.cwd(), '..', 'docs', 'openapi.json');
  const committed = fs.readFileSync(file, 'utf8');
  const live = `${JSON.stringify(spec, null, 2)}\n`;
  assert.equal(
    live,
    committed,
    'docs/openapi.json is stale — run `npm run export:openapi` and commit',
  );
});
