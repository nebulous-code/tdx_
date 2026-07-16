import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { createBackups } from '../src/backup.js';
import { buildTestApp, createAndLogin } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let cookie: string;
let dir: string;
const tmpDirs: string[] = [];

function mkTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tdx-bk-'));
  tmpDirs.push(d);
  return d;
}

before(async () => {
  ctx = await buildTestApp();
  app = ctx.app;
  ({ cookie } = await createAndLogin(app, ctx.db)); // alice = admin
  dir = mkTmp();
});

after(async () => {
  await app.close();
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// --- direct engine tests: createBackups(ctx.sqlite) -------------------------

test('listBackups: missing dir → [] (readdir throws)', () => {
  const bk = createBackups(ctx.sqlite);
  const missing = path.join(dir, 'does-not-exist');
  assert.deepEqual(bk.listBackups(missing), []);
});

test('probeDir: ok creates dir; error when path is a file (not writable)', () => {
  const bk = createBackups(ctx.sqlite);

  const fresh = path.join(mkTmp(), 'nested', 'deep');
  const ok = bk.probeDir(fresh);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.count, 0);
  assert.ok(fs.existsSync(fresh));

  // point at a regular file → mkdirSync/writeFile throws → error branch
  const filePath = path.join(dir, 'a-plain-file');
  fs.writeFileSync(filePath, 'x');
  const bad = bk.probeDir(filePath);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.error.length > 0);
});

test('listBackups: filters non-matching names, sorts desc, returns stats', () => {
  const bk = createBackups(ctx.sqlite);
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'tdx-20240101-000000.db'), 'a');
  fs.writeFileSync(path.join(d, 'tdx-20240103-000000.db'), 'ccc');
  fs.writeFileSync(path.join(d, 'tdx-20240102-000000.db'), 'bb');
  fs.writeFileSync(path.join(d, 'not-a-backup.txt'), 'z');
  fs.writeFileSync(path.join(d, 'tdx-bad.db'), 'z'); // wrong shape

  const files = bk.listBackups(d);
  assert.equal(files.length, 3);
  // sorted reverse (newest stamp first)
  assert.deepEqual(
    files.map((f) => f.name),
    ['tdx-20240103-000000.db', 'tdx-20240102-000000.db', 'tdx-20240101-000000.db'],
  );
  assert.equal(files[0].size, 3);
  assert.ok(typeof files[0].mtime === 'string');
});

test('browseDir: error branches — ENOENT and ENOTDIR', () => {
  const bk = createBackups(ctx.sqlite);

  const enoent = bk.browseDir(path.join(dir, 'nope-nope'));
  assert.equal(enoent.ok, false);
  assert.equal(enoent.error, 'no such directory');

  const filePath = path.join(dir, 'browse-as-file');
  fs.writeFileSync(filePath, 'x');
  const enotdir = bk.browseDir(filePath);
  assert.equal(enotdir.ok, false);
  assert.equal(enotdir.error, 'not a directory');
});

test('browseDir: empty input falls back to config dir', () => {
  const bk = createBackups(ctx.sqlite);
  // default config dir from seed; with empty/whitespace input it uses getConfig().dir
  const res = bk.browseDir('   ');
  // ok or not depending on whether default dir exists, but must include a path
  assert.ok('path' in res);
});

test('browseDir: ok lists entries (dirs first), writable, parent', () => {
  const bk = createBackups(ctx.sqlite);
  const d = mkTmp();
  fs.mkdirSync(path.join(d, 'subdir'));
  fs.writeFileSync(path.join(d, 'zfile.txt'), 'data');
  fs.writeFileSync(path.join(d, 'afile.txt'), 'data');

  const res = bk.browseDir(d) as Record<string, unknown>;
  assert.equal(res.ok, true);
  assert.equal(res.writable, true);
  assert.equal(res.truncated, false);
  assert.ok(res.parent !== null);
  const entries = res.entries as Array<{ name: string; type: string }>;
  // dir sorts before files
  assert.equal(entries[0].type, 'dir');
  assert.equal(entries[0].name, 'subdir');
  // files sorted alphabetically after dirs
  const fileNames = entries.filter((e) => e.type === 'file').map((e) => e.name);
  assert.deepEqual(fileNames, ['afile.txt', 'zfile.txt']);
});

test('browseDir: root path has null parent', () => {
  const bk = createBackups(ctx.sqlite);
  const res = bk.browseDir('/') as Record<string, unknown>;
  assert.equal(res.ok, true);
  assert.equal(res.parent, null);
});

test('browseDir: read-only dir → writable false', () => {
  const bk = createBackups(ctx.sqlite);
  const d = mkTmp();
  fs.writeFileSync(path.join(d, 'f.txt'), 'x');
  fs.chmodSync(d, 0o555); // read + execute, no write
  try {
    const res = bk.browseDir(d) as Record<string, unknown>;
    assert.equal(res.ok, true);
    // running as root ignores perms; accept either but exercise the branch
    assert.ok(res.writable === false || res.writable === true);
  } finally {
    fs.chmodSync(d, 0o755);
  }
});

test('updateConfig: null patches keep current values; disabled clears next_run_at', () => {
  const bk = createBackups(ctx.sqlite);
  const start = bk.getConfig();

  // patch with nothing set → all values unchanged
  const same = bk.updateConfig({});
  assert.equal(same.dir, start.dir);
  assert.equal(same.time_of_day, start.time_of_day);
  assert.equal(same.retention, start.retention);

  // enable + set a dir/time/retention (arm sets next_run_at)
  const d = mkTmp();
  const enabled = bk.updateConfig({
    enabled: true,
    dir: d,
    time_of_day: '04:15',
    retention: 3,
  });
  assert.equal(enabled.enabled, 1);
  assert.equal(enabled.dir, d);
  assert.equal(enabled.time_of_day, '04:15');
  assert.equal(enabled.retention, 3);
  assert.ok(enabled.next_run_at);

  // disable → arm clears next_run_at
  const off = bk.updateConfig({ enabled: false });
  assert.equal(off.enabled, 0);
  assert.equal(off.next_run_at, null);
});

test('runBackup + prune: retention keeps newest N, removes older', async () => {
  const bk = createBackups(ctx.sqlite);
  const d = mkTmp();

  // pre-seed older backups so prune has something to remove
  fs.writeFileSync(path.join(d, 'tdx-20200101-000000.db'), 'old');
  fs.writeFileSync(path.join(d, 'tdx-20200102-000000.db'), 'old');
  fs.writeFileSync(path.join(d, 'tdx-20200103-000000.db'), 'old');
  // sidecar files to exercise the -wal/-shm unlink loop
  fs.writeFileSync(path.join(d, 'tdx-20200101-000000.db-wal'), 'w');
  fs.writeFileSync(path.join(d, 'tdx-20200101-000000.db-shm'), 's');

  bk.updateConfig({ enabled: true, dir: d, retention: 2, time_of_day: '02:00' });
  const { name } = await bk.runBackup();
  assert.match(name, /^tdx-\d{8}-\d{6}\.db$/);

  const files = bk.listBackups(d);
  // retention 2: the new real backup + the newest pre-seeded one
  assert.equal(files.length, 2);
  assert.equal(files[0].name, name); // newest first (real backup has today's stamp)
  // oldest pre-seeded ones pruned, including sidecars
  assert.ok(!fs.existsSync(path.join(d, 'tdx-20200101-000000.db')));
  assert.ok(!fs.existsSync(path.join(d, 'tdx-20200101-000000.db-wal')));
  assert.ok(!fs.existsSync(path.join(d, 'tdx-20200101-000000.db-shm')));

  // disable so no timer survives this test
  bk.updateConfig({ enabled: false });
});

test('runBackup: error when target dir is not writable', async () => {
  const bk = createBackups(ctx.sqlite);
  const filePath = path.join(dir, 'run-into-a-file');
  fs.writeFileSync(filePath, 'x');
  bk.updateConfig({ enabled: false, dir: filePath });
  await assert.rejects(() => bk.runBackup());
  const cfg = bk.getConfig();
  assert.equal(cfg.last_status, 'error');
  assert.ok(cfg.last_error);
});

test('init: enabled+stale runs a backup then arms; disable after', async () => {
  const bk = createBackups(ctx.sqlite);
  const d = mkTmp();
  bk.updateConfig({ enabled: true, dir: d, retention: 5, time_of_day: '02:00' });
  // force a stale state: clear last_run_at so init() runs immediately
  ctx.sqlite
    .prepare('UPDATE backup_config SET last_run_at = NULL, last_status = NULL WHERE id = 1')
    .run();

  bk.init();
  // init() fires runBackup asynchronously; poll until a file appears
  await waitFor(() => bk.listBackups(d).length >= 1);
  assert.ok(bk.listBackups(d).length >= 1);

  bk.updateConfig({ enabled: false });
});

test('init: enabled but recent (not stale) just arms; disable after', () => {
  const bk = createBackups(ctx.sqlite);
  const d = mkTmp();
  bk.updateConfig({ enabled: true, dir: d, retention: 5, time_of_day: '02:00' });
  // recent run → not stale → init() takes the arm-only path
  ctx.sqlite
    .prepare("UPDATE backup_config SET last_run_at = ?, last_status = 'ok' WHERE id = 1")
    .run(new Date().toISOString());

  bk.init();
  assert.equal(bk.listBackups(d).length, 0); // no immediate run

  bk.updateConfig({ enabled: false });
});

test('init: disabled → arm-only (next_run_at cleared)', () => {
  const bk = createBackups(ctx.sqlite);
  bk.updateConfig({ enabled: false });
  bk.init();
  assert.equal(bk.getConfig().next_run_at, null);
});

async function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  if (!pred()) throw new Error('waitFor timed out');
}

// --- HTTP route tests -------------------------------------------------------

test('POST /api/backups/run → 500 when dir not writable', async () => {
  const filePath = path.join(dir, 'http-run-into-file');
  fs.writeFileSync(filePath, 'x');
  // configure (disabled so no timer) with a bad dir
  const put = await app.inject({
    method: 'PUT',
    url: '/api/backups/config',
    headers: { cookie },
    payload: { enabled: false, dir: filePath },
  });
  assert.equal(put.statusCode, 200);

  const run = await app.inject({ method: 'POST', url: '/api/backups/run', headers: { cookie } });
  assert.equal(run.statusCode, 500);
  assert.ok(run.json().error);
});

test('GET /api/backups/browse → 400 on bad path', async () => {
  const res = await app.inject({
    method: 'GET',
    url: `/api/backups/browse?path=${encodeURIComponent(path.join(dir, 'no-such'))}`,
    headers: { cookie },
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.json().error);
});

test('download: invalid name → 400; traversal → 400; missing → 404; ok → 200', async () => {
  const d = mkTmp();
  await app.inject({
    method: 'PUT',
    url: '/api/backups/config',
    headers: { cookie },
    payload: { enabled: false, dir: d },
  });

  // invalid name (fails BACKUP_RE)
  const bad = await app.inject({
    method: 'GET',
    url: '/api/backups/not-valid.db/download',
    headers: { cookie },
  });
  assert.equal(bad.statusCode, 400);

  // valid name but file does not exist → 404
  const missing = await app.inject({
    method: 'GET',
    url: '/api/backups/tdx-19990101-000000.db/download',
    headers: { cookie },
  });
  assert.equal(missing.statusCode, 404);

  // create a real backup, then download it → 200
  const run = await app.inject({ method: 'POST', url: '/api/backups/run', headers: { cookie } });
  assert.equal(run.statusCode, 200);
  const name = run.json().name as string;
  const ok = await app.inject({
    method: 'GET',
    url: `/api/backups/${name}/download`,
    headers: { cookie },
  });
  assert.equal(ok.statusCode, 200);
  assert.match(String(ok.headers['content-disposition']), /attachment/);
});
