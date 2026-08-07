// vault-git.ts — a git-based backup of the notes vault (docs/VAULT_BACKUP.md) plus the
// version-control layer on top of it (docs/VAULT_VERSION_CONTROL.md).
//
// Note *content* lives as .md files (+ binaries) under VAULT_DIR, one subdir per
// owner; the DB is only a rebuildable shadow. This snapshots that directory into a
// SEPARATE git dir (<backup_config.dir>/vault.git) so the history survives the vault
// dir being lost and no `.git` is ever placed inside the vault. It's "git as a
// snapshot log": linear, append-only, one branch.
//
// Two triggers, both gated by backup_config.enabled (one switch, both-or-nothing with
// the DB backup): the scheduled DB backup calls snapshotVault() from runBackup(), and
// a debounced commit-on-save fires from the mutating notes routes. Runs are serialized
// by a module-level mutex so the two can't race the same repo. Failures are recorded to
// the vault_last_* columns and never thrown.
//
// On top of that substrate, `createVaultGit` exposes read/restore/purge helpers to the
// notes routes: `history`/`versionText`/`lastLiveRef` (browse), `restore` orchestration
// lives in services/notes.ts, and `purgePath` (permanent delete — history rewrite) with
// `pause`/`resume` so the debounced commit loop can't race the rewrite.
//
// Single-repo-over-the-whole-vault is correct for a single user; per-owner commit
// attribution when notes sharing ships is a deferred seam — docs/AUTH_AND_SHARING.md §12.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { BackupConfigTable, Sqlite } from './db.js';
import { vaultBase } from './vault.js';

const execFileP = promisify(execFile);

// editor/OS cruft we never want in the snapshot. Written to <gitDir>/info/exclude —
// repo-local, so no .gitignore lands in the user's vault. User globs (Feature C) are
// appended to this fixed base.
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
export interface VaultVersion {
  ref: string;
  timestamp: string; // ISO (git author date)
  message: string;
}
// Configurable backup ignore (Feature C): user globs appended to IGNORE, plus a size
// threshold enforced at staging time (info/exclude can't express file size).
export interface IgnoreRules {
  globs: string[];
  maxBytes: number | null;
}

// ---- ignore rules --------------------------------------------------------
// Defensive read: the column arrives with migration 013, so tolerate its absence.
function readIgnoreRules(sqlite: Sqlite): IgnoreRules {
  try {
    const row = sqlite.prepare('SELECT vault_ignore_rules FROM backup_config WHERE id = 1').get() as
      | { vault_ignore_rules?: string | null }
      | undefined;
    if (row?.vault_ignore_rules) {
      const r = JSON.parse(row.vault_ignore_rules);
      return {
        globs: Array.isArray(r.globs)
          ? r.globs.filter((g: unknown): g is string => typeof g === 'string' && g.trim().length > 0)
          : [],
        maxBytes: typeof r.maxBytes === 'number' && r.maxBytes > 0 ? r.maxBytes : null,
      };
    }
  } catch {
    /* column missing (pre-013) or malformed JSON → defaults */
  }
  return { globs: [], maxBytes: null };
}

// Repo-local ignore = fixed cruft + user globs. `commitVault` seeds it only at init, so
// a rules change must actively rewrite it (see VaultGit.writeExclude).
export function writeExcludeFile(gitDir: string, rules: IgnoreRules): void {
  fs.mkdirSync(path.join(gitDir, 'info'), { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'info', 'exclude'), `${[...IGNORE, ...rules.globs].join('\n')}\n`);
}

// ---- git plumbing --------------------------------------------------------
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

// Run git against the repo alone (no work-tree) — for object/ref ops (filter, gc, reflog)
// that must not consult or touch the live vault. GIT_WORK_TREE is deliberately absent.
async function runGitBare(args: string[], gitDir: string, extraEnv: Record<string, string> = {}): Promise<string> {
  const gd = path.resolve(gitDir);
  const { stdout } = await execFileP('git', ['-c', 'core.bare=true', '-c', `safe.directory=${gd}`, ...args], {
    cwd: gd,
    env: { ...process.env, GIT_DIR: gd, ...extraEnv },
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
  ignoreRules?: IgnoreRules;
}): Promise<CommitResult> {
  const { vaultDir, gitDir, committer, reason, now } = opts;
  const rules = opts.ignoreRules ?? { globs: [], maxBytes: null };

  // 1. init once (a repo has a HEAD file). Seed the repo-local ignore at init.
  if (!fs.existsSync(path.join(gitDir, 'HEAD'))) {
    await runGit(['init', '--quiet'], gitDir, vaultDir);
    writeExcludeFile(gitDir, rules);
  }

  // 2. stage the whole tree
  await runGit(['add', '-A'], gitDir, vaultDir);

  // 3. size threshold (Feature C): unstage any file larger than maxBytes so it never
  //    enters history. Proactive only — retroactive removal is permanent-delete (purge).
  if (rules.maxBytes != null) {
    const staged = (await runGit(['diff', '--cached', '--name-only'], gitDir, vaultDir))
      .split('\n')
      .filter(Boolean);
    for (const rel of staged) {
      try {
        const st = fs.statSync(path.join(vaultDir, rel));
        if (st.isFile() && st.size > rules.maxBytes) await runGit(['reset', '-q', '--', rel], gitDir, vaultDir);
      } catch {
        /* file vanished between add and stat — nothing to unstage */
      }
    }
  }

  // 4. skip-if-clean
  const porcelain = await runGit(['status', '--porcelain'], gitDir, vaultDir);
  const changed = porcelain.split('\n').filter((l) => l.trim().length > 0).length;
  if (changed === 0) return { committed: false, changed: 0 };

  // 5. commit with an explicit identity (no persistent git config needed)
  const msg = `vault snapshot ${now} — ${changed} changed (${reason})`;
  await runGit(
    ['-c', `user.name=${committer.name}`, '-c', `user.email=${committer.email}`, 'commit', '--quiet', '-m', msg],
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

let chain: Promise<unknown> = Promise.resolve(); // module-level mutex serializing snapshots + purges

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
        ignoreRules: readIgnoreRules(sqlite),
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

// ---- permanent delete: obliterate one path from ALL history --------------
let _filterRepo: boolean | null = null; // cached availability probe
async function hasFilterRepo(): Promise<boolean> {
  if (_filterRepo !== null) return _filterRepo;
  try {
    await execFileP('git', ['filter-repo', '--version']);
    _filterRepo = true;
  } catch {
    _filterRepo = false;
  }
  return _filterRepo;
}

// Purge a single path from every commit + reclaim space. Prefers `git-filter-repo` (the
// intended tool, added to the image); falls back to the built-in `filter-branch`
// (deprecated + slow, but always present and locally testable) behind the same interface.
// Runs against the repo alone (no work-tree) so it never consults the live vault. Purge is
// by PATH — generic, so a future attachment path works with zero change.
async function purgeInRepo(gitDir: string, vaultDir: string, gitPath: string): Promise<void> {
  const gd = path.resolve(gitDir);
  const wt = path.resolve(vaultDir);
  // Flush any pending work-tree state into a commit first: filter-branch refuses to run on a
  // dirty tree, and this also commits the archived note's deletion before we purge its path.
  await runGit(['add', '-A'], gd, wt);
  if ((await runGit(['status', '--porcelain'], gd, wt)).trim().length > 0) {
    await runGit(
      ['-c', 'user.name=tdx', '-c', 'user.email=tdx@localhost', 'commit', '--quiet', '-m', 'pre-purge flush'],
      gd,
      wt,
    );
  }
  if (await hasFilterRepo()) {
    // filter-repo works on the object DB — GIT_DIR only, no work-tree; --force (not a fresh clone).
    await execFileP(
      'git',
      ['filter-repo', '--path', gitPath, '--invert-paths', '--force', '--replace-refs', 'delete-no-add'],
      { cwd: gd, env: { ...process.env, GIT_DIR: gd }, maxBuffer: 64 * 1024 * 1024 },
    );
  } else {
    // filter-branch must run from the work-tree toplevel; --index-filter rewrites the index only
    // (no checkout). `-d` puts its scratch dir in the OS tmp so it never litters the vault.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tdx-fb-'));
    try {
      await execFileP(
        'git',
        [
          '-c',
          `safe.directory=${wt}`,
          'filter-branch',
          '-d',
          path.join(tmp, 'rw'),
          '--force',
          '--prune-empty',
          '--index-filter',
          `git rm -q --cached --ignore-unmatch -- "${gitPath.replace(/"/g, '\\"')}"`,
          '--',
          '--all',
        ],
        {
          cwd: wt,
          env: { ...process.env, GIT_DIR: gd, GIT_WORK_TREE: wt, FILTER_BRANCH_SQUELCH_WARNING: '1' },
          maxBuffer: 64 * 1024 * 1024,
        },
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    // drop filter-branch's refs/original backup so gc can actually reclaim the objects
    try {
      const refs = (await runGitBare(['for-each-ref', '--format=%(refname)', 'refs/original/'], gd))
        .split('\n')
        .filter(Boolean);
      for (const ref of refs) await runGitBare(['update-ref', '-d', ref], gd);
    } catch {
      /* no backup refs */
    }
  }
  await runGitBare(['reflog', 'expire', '--all', '--expire=now'], gd).catch(() => {});
  await runGitBare(['gc', '--prune=now'], gd).catch(() => {});
}

export interface VaultGit {
  scheduleSnapshot(): void;
  pause(): void;
  resume(): void;
  enabled(): boolean;
  history(owner: string, relPath: string): Promise<VaultVersion[]>;
  versionText(owner: string, relPath: string, ref: string): Promise<string>;
  lastLiveRef(owner: string, relPath: string): Promise<string | null>;
  purgePath(owner: string, relPath: string): Promise<void>;
  writeExclude(): void;
}

// Decorated on the app. `scheduleSnapshot` is a debounced, fire-and-forget commit-on-save;
// the history/restore/purge helpers back the notes version-control routes. All no-op or
// return empty when backups are disabled / the repo doesn't exist yet, so callers never 500.
export function createVaultGit(sqlite: Sqlite): VaultGit {
  let timer: NodeJS.Timeout | null = null;
  let suspended = false;

  const repo = (): { gitDir: string; vaultDir: string } | null => {
    const cfg = sqlite.prepare('SELECT * FROM backup_config WHERE id = 1').get() as BackupConfigTable | undefined;
    if (!cfg || !cfg.enabled) return null;
    return { gitDir: path.join(cfg.dir, 'vault.git'), vaultDir: vaultBase() };
  };
  const ready = (r: { gitDir: string }): boolean => fs.existsSync(path.join(r.gitDir, 'HEAD'));

  const self: VaultGit = {
    scheduleSnapshot() {
      if (suspended) return; // paused for a history rewrite — don't queue a racing snapshot
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void snapshotVault(sqlite, { reason: 'save' });
      }, DEBOUNCE_MS);
      timer.unref();
    },
    pause() {
      suspended = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    resume() {
      suspended = false;
    },
    enabled() {
      return !!repo();
    },

    async history(owner, relPath) {
      const r = repo();
      if (!r || !ready(r)) return [];
      try {
        const out = await runGit(
          ['log', '--follow', '--format=%H%x1f%aI%x1f%s', '--', `${owner}/${relPath}`],
          r.gitDir,
          r.vaultDir,
        );
        return out
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [ref, timestamp, ...rest] = line.split('\x1f');
            return { ref, timestamp, message: rest.join('\x1f') };
          });
      } catch {
        return []; // path never committed / repo empty
      }
    },

    async versionText(owner, relPath, ref) {
      const r = repo();
      if (!r || !ready(r)) throw new Error('vault history unavailable');
      if (!/^[0-9a-fA-F]{7,40}$/.test(ref)) throw new Error('invalid ref');
      return runGit(['show', `${ref}:${owner}/${relPath}`], r.gitDir, r.vaultDir);
    },

    // The newest commit where the path still had content — for un-archiving a deleted note,
    // whose most-recent touching commit is the deletion itself (path absent there).
    async lastLiveRef(owner, relPath) {
      const r = repo();
      if (!r || !ready(r)) return null;
      const versions = await self.history(owner, relPath);
      for (const v of versions) {
        try {
          await runGit(['cat-file', '-e', `${v.ref}:${owner}/${relPath}`], r.gitDir, r.vaultDir);
          return v.ref;
        } catch {
          /* path absent at this ref (e.g. the delete commit) — keep walking back */
        }
      }
      return null;
    },

    async purgePath(owner, relPath) {
      const r = repo();
      if (!r || !ready(r)) return;
      self.pause(); // no debounced snapshot may run mid-rewrite
      const p = chain.then(() => purgeInRepo(r.gitDir, r.vaultDir, `${owner}/${relPath}`));
      chain = p.catch(() => undefined); // keep the mutex alive even if the purge throws
      try {
        await p; // propagate a failure to the caller (route → 500)
        writeExcludeFile(r.gitDir, readIgnoreRules(sqlite)); // filter-repo may reset repo-local state
      } finally {
        self.resume();
      }
    },

    writeExclude() {
      const r = repo();
      if (!r || !ready(r)) return;
      writeExcludeFile(r.gitDir, readIgnoreRules(sqlite));
    },
  };
  return self;
}
