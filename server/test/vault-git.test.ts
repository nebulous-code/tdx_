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
import { commitVault, snapshotVault } from '../src/vault-git.js';

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
