// vault-git.test.ts — the git-based vault backup. Exercises the DB-free core
// (commitVault) for the snapshot/skip/restore round trip, and snapshotVault against a
// real in-memory DB for the enabled-gate + status recording. Uses real `git` (present
// in dev + CI), temp dirs mkdtemp'd and cleaned in `after`, mirroring backup-extra.test.

import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { openDatabase } from '../src/db.js';
import { commitVault, createVaultGit, snapshotVault } from '../src/vault-git.js';
import type { Sqlite } from '../src/db.js';

const committer = { name: 'alice', email: 'alice@tdx.local' };
const tmpDirs: string[] = [];

function mkTmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

function git(gitDir: string, args: string[]): string {
  return execFileSync('git', args, { env: { ...process.env, GIT_DIR: gitDir } }).toString();
}
function countCommits(gitDir: string): number {
  try {
    return Number(git(gitDir, ['rev-list', '--count', 'HEAD']).trim());
  } catch {
    return 0; // no commits yet → `rev-list HEAD` errors
  }
}

after(() => {
  // node runs each test file in its own process, so VAULT_DIR set below can't leak
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

test('commitVault: empty vault makes no commit', async () => {
  const vaultDir = mkTmp('tdx-vault-');
  const gitDir = path.join(mkTmp('tdx-git-'), 'vault.git');
  const res = await commitVault({ vaultDir, gitDir, committer, reason: 'test', now: 't0' });
  assert.equal(res.committed, false);
  assert.equal(countCommits(gitDir), 0);
});

test('commitVault: add → skip-if-clean → modify, plus restore round trip', async () => {
  const vaultDir = mkTmp('tdx-vault-');
  const gitDir = path.join(mkTmp('tdx-git-'), 'vault.git');
  const owner = 'owner1';
  fs.mkdirSync(path.join(vaultDir, owner), { recursive: true });
  const note = path.join(vaultDir, owner, 'n.md');

  fs.writeFileSync(note, 'v1\n');
  let res = await commitVault({ vaultDir, gitDir, committer, reason: 'save', now: 't1' });
  assert.equal(res.committed, true);
  assert.equal(countCommits(gitDir), 1);

  // no change → skipped, still one commit
  res = await commitVault({ vaultDir, gitDir, committer, reason: 'save', now: 't2' });
  assert.equal(res.committed, false);
  assert.equal(countCommits(gitDir), 1);

  // modify → second commit
  fs.writeFileSync(note, 'v2\n');
  res = await commitVault({ vaultDir, gitDir, committer, reason: 'save', now: 't3' });
  assert.equal(res.committed, true);
  assert.equal(countCommits(gitDir), 2);

  // restore round trip: the previous version is recoverable from history
  assert.equal(git(gitDir, ['show', `HEAD~1:${owner}/n.md`]), 'v1\n');

  // the vault stays clean — the git dir is separate, no .git inside it
  assert.equal(fs.existsSync(path.join(vaultDir, '.git')), false);
});

test('commitVault: editor/OS cruft is ignored', async () => {
  const vaultDir = mkTmp('tdx-vault-');
  const gitDir = path.join(mkTmp('tdx-git-'), 'vault.git');
  fs.mkdirSync(path.join(vaultDir, 'owner1', '.obsidian'), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, 'owner1', '.obsidian', 'workspace.json'), '{}');
  fs.writeFileSync(path.join(vaultDir, 'owner1', 'real.md'), 'hi\n');

  const res = await commitVault({ vaultDir, gitDir, committer, reason: 'test', now: 't' });
  assert.equal(res.committed, true);
  const tracked = git(gitDir, ['ls-files']);
  assert.ok(tracked.includes('owner1/real.md'));
  assert.ok(!tracked.includes('.obsidian'));
});

test('commitVault: size threshold unstages an over-size file (Feature C)', async () => {
  const vaultDir = mkTmp('tdx-vault-');
  const gitDir = path.join(mkTmp('tdx-git-'), 'vault.git');
  fs.mkdirSync(path.join(vaultDir, 'owner1'), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, 'owner1', 'small.md'), 'hi\n'); // 3 bytes
  fs.writeFileSync(path.join(vaultDir, 'owner1', 'big.md'), 'x'.repeat(100)); // 100 bytes
  const res = await commitVault({
    vaultDir, gitDir, committer, reason: 'test', now: 't', ignoreRules: { globs: [], maxBytes: 10 },
  });
  assert.equal(res.committed, true);
  const tracked = git(gitDir, ['ls-files']);
  assert.ok(tracked.includes('owner1/small.md'));
  assert.ok(!tracked.includes('owner1/big.md')); // over the 10-byte cap → never committed
});

test('commitVault: user ignore globs exclude matching files (Feature C)', async () => {
  const vaultDir = mkTmp('tdx-vault-');
  const gitDir = path.join(mkTmp('tdx-git-'), 'vault.git');
  fs.mkdirSync(path.join(vaultDir, 'owner1'), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, 'owner1', 'keep.md'), 'k\n');
  fs.writeFileSync(path.join(vaultDir, 'owner1', 'skip.pdf'), 'pdf');
  const res = await commitVault({
    vaultDir, gitDir, committer, reason: 'test', now: 't', ignoreRules: { globs: ['*.pdf'], maxBytes: null },
  });
  assert.equal(res.committed, true);
  const tracked = git(gitDir, ['ls-files']);
  assert.ok(tracked.includes('owner1/keep.md'));
  assert.ok(!tracked.includes('skip.pdf')); // excluded by the user glob in info/exclude
});

test('snapshotVault: commits and records ok status when backups are enabled', async () => {
  const vaultDir = mkTmp('tdx-vault-');
  const backupDir = mkTmp('tdx-backup-');
  process.env.VAULT_DIR = vaultDir;
  const { sqlite } = openDatabase(':memory:');
  sqlite.prepare('UPDATE backup_config SET enabled = 1, dir = ? WHERE id = 1').run(backupDir);
  fs.mkdirSync(path.join(vaultDir, 'owner1'), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, 'owner1', 'n.md'), 'hello\n');

  const res = await snapshotVault(sqlite, { reason: 'test' });
  assert.ok(res?.committed);

  const cfg = sqlite
    .prepare(
      'SELECT vault_last_status, vault_last_error, vault_last_run_at FROM backup_config WHERE id = 1',
    )
    .get() as {
    vault_last_status: string;
    vault_last_error: string | null;
    vault_last_run_at: string;
  };
  assert.equal(cfg.vault_last_status, 'ok');
  assert.equal(cfg.vault_last_error, null);
  assert.ok(cfg.vault_last_run_at);
  assert.ok(fs.existsSync(path.join(backupDir, 'vault.git', 'HEAD')));
  sqlite.close();
});

test('snapshotVault: no-op when backups are disabled', async () => {
  const { sqlite } = openDatabase(':memory:'); // enabled defaults to 0
  const res = await snapshotVault(sqlite, { reason: 'test' });
  assert.equal(res, null);
  const cfg = sqlite.prepare('SELECT vault_last_status FROM backup_config WHERE id = 1').get() as {
    vault_last_status: string | null;
  };
  assert.equal(cfg.vault_last_status, null); // nothing recorded when gated off
  sqlite.close();
});

// ---- version-control helpers (docs/VAULT_VERSION_CONTROL.md) ----------------
// Set up an enabled backup over a fresh vault + a createVaultGit handle.
function setupRepo(): { sqlite: Sqlite; vaultDir: string; vg: ReturnType<typeof createVaultGit> } {
  const vaultDir = mkTmp('tdx-vault-');
  const backupDir = mkTmp('tdx-backup-');
  process.env.VAULT_DIR = vaultDir;
  const { sqlite } = openDatabase(':memory:');
  sqlite.prepare('UPDATE backup_config SET enabled = 1, dir = ? WHERE id = 1').run(backupDir);
  fs.mkdirSync(path.join(vaultDir, 'owner1'), { recursive: true });
  return { sqlite, vaultDir, vg: createVaultGit(sqlite) };
}

test('vaultGit.history + versionText: versions across an edit', async () => {
  const { sqlite, vaultDir, vg } = setupRepo();
  const note = path.join(vaultDir, 'owner1', 'n.md');
  fs.writeFileSync(note, 'v1\n');
  await snapshotVault(sqlite, { reason: 'save' });
  fs.writeFileSync(note, 'v2\n');
  await snapshotVault(sqlite, { reason: 'save' });

  const hist = await vg.history('owner1', 'n.md');
  assert.equal(hist.length, 2);
  assert.match(hist[0].ref, /^[0-9a-f]{40}$/);
  assert.ok(hist[0].timestamp);
  assert.equal(await vg.versionText('owner1', 'n.md', hist[1].ref), 'v1\n'); // older
  assert.equal(await vg.versionText('owner1', 'n.md', hist[0].ref), 'v2\n'); // newer
  sqlite.close();
});

test('vaultGit.history: empty + enabled()=false when backups are off', async () => {
  const { sqlite } = openDatabase(':memory:');
  const vg = createVaultGit(sqlite);
  assert.deepEqual(await vg.history('owner1', 'n.md'), []);
  assert.equal(vg.enabled(), false);
  sqlite.close();
});

test('vaultGit: read/restore/purge guards are safe when backups are disabled', async () => {
  const { sqlite } = openDatabase(':memory:'); // enabled defaults to 0
  const vg = createVaultGit(sqlite);
  assert.equal(await vg.lastLiveRef('o', 'n.md'), null);
  await assert.rejects(() => vg.versionText('o', 'n.md', 'a'.repeat(40))); // throws → route 409/404
  await vg.purgePath('o', 'n.md'); // no-op, no throw
  vg.writeExclude(); // no-op
  sqlite.close();
});

test('snapshotVault: honors configured ignore rules (readIgnoreRules)', async () => {
  const vaultDir = mkTmp('tdx-vault-');
  const backupDir = mkTmp('tdx-backup-');
  process.env.VAULT_DIR = vaultDir;
  const { sqlite } = openDatabase(':memory:');
  sqlite
    .prepare('UPDATE backup_config SET enabled = 1, dir = ?, vault_ignore_rules = ? WHERE id = 1')
    .run(backupDir, JSON.stringify({ globs: ['*.pdf'], maxBytes: null }));
  fs.mkdirSync(path.join(vaultDir, 'owner1'), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, 'owner1', 'keep.md'), 'k\n');
  fs.writeFileSync(path.join(vaultDir, 'owner1', 'doc.pdf'), 'pdf');
  await snapshotVault(sqlite, { reason: 'save' });
  const tracked = git(path.join(backupDir, 'vault.git'), ['ls-files']);
  assert.ok(tracked.includes('owner1/keep.md'));
  assert.ok(!tracked.includes('doc.pdf')); // configured glob applied via info/exclude
  sqlite.close();
});

test('vaultGit.versionText: a bad ref is rejected', async () => {
  const { sqlite, vaultDir, vg } = setupRepo();
  fs.writeFileSync(path.join(vaultDir, 'owner1', 'n.md'), 'v1\n');
  await snapshotVault(sqlite, { reason: 'save' });
  await assert.rejects(() => vg.versionText('owner1', 'n.md', 'not-a-ref'));
  sqlite.close();
});

test('vaultGit.lastLiveRef: newest ref where the file still existed (skips the deletion)', async () => {
  const { sqlite, vaultDir, vg } = setupRepo();
  const note = path.join(vaultDir, 'owner1', 'n.md');
  fs.writeFileSync(note, 'live\n');
  await snapshotVault(sqlite, { reason: 'save' });
  fs.unlinkSync(note); // the newest commit touching the path is the deletion (path absent there)
  await snapshotVault(sqlite, { reason: 'delete' });

  const ref = await vg.lastLiveRef('owner1', 'n.md');
  assert.ok(ref);
  assert.equal(await vg.versionText('owner1', 'n.md', ref as string), 'live\n');
  sqlite.close();
});

test('vaultGit.purgePath: obliterates a path from all history, other notes survive', async () => {
  const { sqlite, vaultDir, vg } = setupRepo();
  const keep = path.join(vaultDir, 'owner1', 'keep.md');
  const secret = path.join(vaultDir, 'owner1', 'secret.md');
  fs.writeFileSync(keep, 'keeper\n');
  fs.writeFileSync(secret, 'SSN 123-45-6789\n');
  await snapshotVault(sqlite, { reason: 'save' });
  fs.writeFileSync(secret, 'SSN 123-45-6789 (edited)\n');
  await snapshotVault(sqlite, { reason: 'save' });
  assert.ok((await vg.history('owner1', 'secret.md')).length >= 2); // it's in history

  fs.unlinkSync(secret); // archived: file already removed from the vault before purge
  await vg.purgePath('owner1', 'secret.md');

  assert.deepEqual(await vg.history('owner1', 'secret.md'), []); // gone from every commit
  assert.ok((await vg.history('owner1', 'keep.md')).length >= 1); // the other note keeps its history
  assert.ok(fs.existsSync(keep));
  // the repo survived the rewrite — a fresh snapshot still commits
  fs.writeFileSync(path.join(vaultDir, 'owner1', 'after.md'), 'still working\n');
  const res = await snapshotVault(sqlite, { reason: 'save' });
  assert.ok(res?.committed);
  sqlite.close();
});
