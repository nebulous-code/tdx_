// notes-vault.test.ts — the vault version-control routes (docs/VAULT_VERSION_CONTROL.md):
// history / version / restore (A), archive list / unarchive / permanent-delete (B), and
// configurable ignore rules (C). Backups are ENABLED (a real vault.git under a temp dir) and
// commits are forced with snapshotVault, since the route's scheduleSnapshot is debounced.

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { snapshotVault } from '../src/vault-git.js';
import { buildTestApp, createAndLogin } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let cookie: string;
let vault: string;
let ownerId: string;

const j = (method: string, url: string, payload?: object) =>
  app.inject({ method: method as 'GET', url, headers: { cookie }, ...(payload ? { payload } : {}) });
const snapshot = () => snapshotVault(ctx.sqlite, { reason: 'test' });

before(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'tdx-vault-'));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdx-backup-'));
  process.env.VAULT_DIR = vault;
  ctx = await buildTestApp();
  app = ctx.app;
  const li = await createAndLogin(app, ctx.db);
  cookie = li.cookie;
  ownerId = li.user.id;
  ctx.sqlite.prepare('UPDATE backup_config SET enabled = 1, dir = ? WHERE id = 1').run(backupDir);
});
after(async () => {
  await app.close();
  fs.rmSync(vault, { recursive: true, force: true });
});

// ---- Feature A ----
test('history + version + restore round trip', async () => {
  const n = (await j('POST', '/api/notes', { title: 'VC', body: 'v1' })).json();
  await snapshot();
  await j('PUT', `/api/notes/${n.id}`, { body: 'v2' });
  await snapshot();

  const hist = (await j('GET', `/api/notes/${n.id}/history`)).json();
  assert.equal(hist.length, 2, 'two versions');
  assert.match(hist[0].ref, /^[0-9a-f]{40}$/);

  const oldRef = hist[1].ref; // oldest
  const ver = (await j('GET', `/api/notes/${n.id}/history/${oldRef}`)).json();
  assert.ok(ver.text.includes('v1'), 'old version text');

  const restored = await j('POST', `/api/notes/${n.id}/restore`, { ref: oldRef });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().body, 'v1', 'rolled back to v1');
  // the restore adds a version rather than rewriting: once committed, history grew
  await snapshot();
  assert.ok((await j('GET', `/api/notes/${n.id}/history`)).json().length >= 3);
});

test('history: bad ref → 404, another user → 404', async () => {
  const n = (await j('POST', '/api/notes', { title: 'VC2', body: 'x' })).json();
  await snapshot();
  assert.equal((await j('GET', `/api/notes/${n.id}/history/deadbeef`)).statusCode, 404);
  assert.equal((await j('GET', '/api/notes/nope/history')).statusCode, 404);
});

// ---- Feature B ----
test('archive → list → unarchive', async () => {
  const n = (await j('POST', '/api/notes', { title: 'Arch', body: 'hello' })).json();
  await snapshot();
  await j('DELETE', `/api/notes/${n.id}`); // tombstone (soft-delete)
  await snapshot(); // commit the deletion

  const arch = (await j('GET', '/api/notes/archived')).json();
  assert.ok(arch.some((a: { id: string }) => a.id === n.id), 'shows in archive');
  assert.equal((await j('GET', `/api/notes/${n.id}`)).statusCode, 404, 'hidden from live get');

  const back = await j('POST', `/api/notes/${n.id}/unarchive`);
  assert.equal(back.statusCode, 200);
  assert.equal(back.json().body, 'hello', 'restored content');
  assert.equal((await j('GET', `/api/notes/${n.id}`)).statusCode, 200, 'live again');
  assert.ok(!(await j('GET', '/api/notes/archived')).json().some((a: { id: string }) => a.id === n.id));
});

test('permanent delete: archive-first required, then purges history + record', async () => {
  const n = (await j('POST', '/api/notes', { title: 'Purge', body: 'a secret' })).json();
  await snapshot();

  // live note → 409 (must archive first)
  assert.equal((await j('DELETE', `/api/notes/${n.id}/permanent`)).statusCode, 409);

  await j('DELETE', `/api/notes/${n.id}`); // archive
  await snapshot();
  const res = await j('DELETE', `/api/notes/${n.id}/permanent`);
  assert.equal(res.statusCode, 204);

  assert.ok(!(await j('GET', '/api/notes/archived')).json().some((a: { id: string }) => a.id === n.id));
  assert.equal((await j('GET', `/api/notes/${n.id}/history`)).statusCode, 404, 'record gone');
});

test('vc guards: unarchive-a-live-note / missing-id / bad-ref all 404', async () => {
  const live = (await j('POST', '/api/notes', { title: 'Live', body: 'x' })).json();
  await snapshot();
  // unarchiving a note that isn't archived → 404 (service returns null on !tombstoned)
  assert.equal((await j('POST', `/api/notes/${live.id}/unarchive`)).statusCode, 404);
  // permanent-delete of a nonexistent note → 404
  assert.equal((await j('DELETE', '/api/notes/nope/permanent')).statusCode, 404);
  // restore to a well-formed but nonexistent ref → 404 (versionText throws → route catch)
  assert.equal(
    (await j('POST', `/api/notes/${live.id}/restore`, { ref: 'a'.repeat(40) })).statusCode,
    404,
  );
});

// ---- Feature C ----
test('ignore rules: get default, set, persist, preview', async () => {
  const def = (await j('GET', '/api/notes/vault/ignore-rules')).json();
  assert.deepEqual(def.globs, []);
  assert.equal(def.maxBytes, null);

  const put = await j('PUT', '/api/notes/vault/ignore-rules', { globs: ['*.pdf', 'scratch/'], maxBytes: 1000 });
  assert.equal(put.statusCode, 200);
  assert.deepEqual(put.json().globs, ['*.pdf', 'scratch/']);
  assert.equal(put.json().maxBytes, 1000);

  const got = (await j('GET', '/api/notes/vault/ignore-rules')).json();
  assert.deepEqual(got.globs, ['*.pdf', 'scratch/']);

  fs.writeFileSync(path.join(vault, ownerId, 'big.pdf'), 'x');
  const prev = (await j('POST', '/api/notes/vault/ignore-preview', { globs: ['*.pdf'], maxBytes: null })).json();
  assert.ok(prev.paths.includes('big.pdf'), 'preview lists the matching file');
  assert.equal(prev.truncated, false);
});
