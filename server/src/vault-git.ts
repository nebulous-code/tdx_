// vault-git.ts — a git-based backup of the notes vault (docs/VAULT_BACKUP.md).
//
// Note *content* lives as .md files (+ binaries) under VAULT_DIR, one subdir per
// owner; the DB is only a rebuildable shadow. This snapshots that directory into a
// SEPARATE git dir (<backup_config.dir>/vault.git) so the history survives the vault
// dir being lost and no `.git` is ever placed inside the vault. It's "git as a
// snapshot log": linear, append-only, one branch — no branches/merges/UI (those are
// docs/VAULT_VERSION_CONTROL.md).
//
// Two triggers, both gated by backup_config.enabled (one switch, both-or-nothing with
// the DB backup): the scheduled DB backup calls snapshotVault() from runBackup(), and
// a debounced commit-on-save fires from the mutating notes routes. Runs are serialized
// by a module-level mutex so the two can't race the same repo. Failures are recorded to
// the vault_last_* columns and never thrown.
//
// Single-repo-over-the-whole-vault is correct for a single user; per-owner commit
// attribution when notes sharing ships is a deferred seam — docs/AUTH_AND_SHARING.md §12.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { BackupConfigTable, Sqlite } from './db.js';
import { vaultBase } from './vault.js';

const execFileP = promisify(execFile);

// editor/OS cruft we never want in the snapshot. Written to <gitDir>/info/exclude —
// repo-local, so no .gitignore lands in the user's vault. Made user-configurable
// later (VAULT_VERSION_CONTROL.md Feature C).
const IGNORE = ['.obsidian/', '.DS_Store', '*.tmp', '*.swp', 'Thumbs.db'];

const DEBOUNCE_MS = 5000;

export interface Committer {
  name: string;
  email: string;
}
export interface CommitResult {
  committed: boolean;
  changed: number;
}

// Run git with a detached work-tree: GIT_DIR is the separate repo, GIT_WORK_TREE is
// the vault. `safe.directory` guards against git's dubious-ownership refusal when the
// bind-mounted vault is owned by a different uid than the server process.
async function runGit(args: string[], gitDir: string, workTree: string): Promise<string> {
  const gd = path.resolve(gitDir);
  const wt = path.resolve(workTree);
  const { stdout } = await execFileP('git', ['-c', `safe.directory=${wt}`, ...args], {
    cwd: wt,
    env: { ...process.env, GIT_DIR: gd, GIT_WORK_TREE: wt },
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

// The testable core — no DB. Ensures the repo exists, stages everything (adds, edits,
// deletes), and commits iff something changed. Returns {committed:false} on a clean tree.
export async function commitVault(opts: {
  vaultDir: string;
  gitDir: string;
  committer: Committer;
  reason: string;
  now: string; // ISO timestamp, injected so callers/tests control the commit message
}): Promise<CommitResult> {
  const { vaultDir, gitDir, committer, reason, now } = opts;

  // 1. init once (a repo has a HEAD file). Seed the repo-local ignore at init.
  if (!fs.existsSync(path.join(gitDir, 'HEAD'))) {
    await runGit(['init', '--quiet'], gitDir, vaultDir);
    fs.mkdirSync(path.join(gitDir, 'info'), { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'info', 'exclude'), `${IGNORE.join('\n')}\n`);
  }

  // 2. stage the whole tree
  await runGit(['add', '-A'], gitDir, vaultDir);

  // 3. skip-if-clean
  const porcelain = await runGit(['status', '--porcelain'], gitDir, vaultDir);
  const changed = porcelain.split('\n').filter((l) => l.trim().length > 0).length;
  if (changed === 0) return { committed: false, changed: 0 };

  // 4. commit with an explicit identity (no persistent git config needed)
  const msg = `vault snapshot ${now} — ${changed} changed (${reason})`;
  await runGit(
    [
      '-c',
      `user.name=${committer.name}`,
      '-c',
      `user.email=${committer.email}`,
      'commit',
      '--quiet',
      '-m',
      msg,
    ],
    gitDir,
    vaultDir,
  );
  return { committed: true, changed };
}

// Single-user MVP: attribute history to the sole user. Per-owner attribution when
// sharing ships is deferred (AUTH_AND_SHARING.md §12).
function resolveCommitter(sqlite: Sqlite): Committer {
  const rows = sqlite.prepare('SELECT username FROM users').all() as { username: string }[];
  if (rows.length === 1) return { name: rows[0].username, email: `${rows[0].username}@tdx.local` };
  return { name: 'tdx', email: 'tdx@localhost' };
}

function recordVault(sqlite: Sqlite, status: string, error: string | null, when: Date): void {
  sqlite
    .prepare(
      'UPDATE backup_config SET vault_last_status = ?, vault_last_error = ?, vault_last_run_at = ? WHERE id = 1',
    )
    .run(status, error, when.toISOString());
}

let chain: Promise<unknown> = Promise.resolve(); // module-level mutex serializing snapshots

// DB-aware entry point used by both triggers. No-op unless backups are enabled.
// Serialized against every other snapshot; records its own status; never throws.
export async function snapshotVault(
  sqlite: Sqlite,
  opts: { reason: string },
): Promise<CommitResult | null> {
  const run = chain.then(async (): Promise<CommitResult | null> => {
    const now = new Date();
    try {
      const cfg = sqlite.prepare('SELECT * FROM backup_config WHERE id = 1').get() as
        | BackupConfigTable
        | undefined;
      if (!cfg || !cfg.enabled) return null; // gated by the single backup switch
      const res = await commitVault({
        vaultDir: vaultBase(),
        gitDir: path.join(cfg.dir, 'vault.git'),
        committer: resolveCommitter(sqlite),
        reason: opts.reason,
        now: now.toISOString(),
      });
      recordVault(sqlite, 'ok', null, now);
      return res;
    } catch (e) {
      try {
        recordVault(sqlite, 'error', (e as Error).message, now);
      } catch {
        /* the DB may be gone (shutdown) — nothing more we can do */
      }
      return null;
    }
  });
  chain = run.catch(() => undefined); // keep the mutex alive even if a run rejected
  return run;
}

export interface VaultGit {
  scheduleSnapshot(): void;
}

// Decorated on the app. `scheduleSnapshot` is a debounced, fire-and-forget trigger for
// commit-on-save; cheap to call from every write route since snapshotVault no-ops when
// backups are disabled (which also keeps it inert in tests — enabled defaults to 0).
export function createVaultGit(sqlite: Sqlite): VaultGit {
  let timer: NodeJS.Timeout | null = null;
  return {
    scheduleSnapshot() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void snapshotVault(sqlite, { reason: 'save' });
      }, DEBOUNCE_MS);
      timer.unref();
    },
  };
}
