// backup.ts — scheduled, consistent backups of the whole SQLite database.
// TypeScript port of backend/src/backup.js. Uses the raw better-sqlite3 handle:
// `sqlite.backup()` is an online backup (consistent mid-write, no WAL hazard).
// State lives in the single-row backup_config table (seeded in 001_init.sql).
// A factory holds the daily timer so the instance owns its scheduler.

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { BackupConfigTable, Sqlite } from './db.js';
import { snapshotVault } from './vault-git.js';

export const BACKUP_RE = /^tdx-\d{8}-\d{6}\.db$/; // tdx-YYYYMMDD-HHmmss.db
const STALE_MS = 25 * 60 * 60 * 1000; // missed-run threshold on boot (>25h)
const BROWSE_MAX = 500;

export interface BackupFile {
  name: string;
  size: number;
  mtime: string;
}
export interface ConfigPatch {
  enabled?: boolean;
  dir?: string;
  time_of_day?: string;
  retention?: number;
}
export interface Backups {
  getConfig(): BackupConfigTable;
  updateConfig(patch: ConfigPatch): BackupConfigTable;
  probeDir(dir: string): { ok: true; count: number } | { ok: false; error: string };
  browseDir(input?: string): Record<string, unknown>;
  listBackups(dir: string): BackupFile[];
  runBackup(): Promise<{ name: string }>;
  init(): void;
}

const pad = (n: number): string => String(n).padStart(2, '0');
// local timestamp (process TZ) so filenames sort chronologically
function stamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function createBackups(sqlite: Sqlite): Backups {
  let timer: NodeJS.Timeout | null = null;

  const getConfig = (): BackupConfigTable =>
    sqlite.prepare('SELECT * FROM backup_config WHERE id = 1').get() as BackupConfigTable;

  function recordRun(status: string, error: string | null, when?: Date): void {
    sqlite
      .prepare(
        'UPDATE backup_config SET last_run_at = ?, last_status = ?, last_error = ? WHERE id = 1',
      )
      .run((when || new Date()).toISOString(), status, error || null);
  }

  function listBackups(dir: string): BackupFile[] {
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    return names
      .filter((n) => BACKUP_RE.test(n))
      .sort()
      .reverse()
      .map((name) => {
        const st = fs.statSync(path.join(dir, name));
        return { name, size: st.size, mtime: st.mtime.toISOString() };
      });
  }

  function probeDir(dir: string): { ok: true; count: number } | { ok: false; error: string } {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.tdx-write-test');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return { ok: true, count: listBackups(dir).length };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  // Read-only filesystem browser for the UI's directory picker (admin-only).
  function browseDir(input?: string): Record<string, unknown> {
    const dir = path.resolve(
      input && String(input).trim() ? String(input).trim() : getConfig().dir,
    );
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      const msg =
        err.code === 'ENOENT'
          ? 'no such directory'
          : err.code === 'ENOTDIR'
            ? 'not a directory'
            : err.code === 'EACCES'
              ? 'permission denied'
              : err.message;
      return { ok: false, path: dir, error: msg };
    }
    const truncated = dirents.length > BROWSE_MAX;
    const entries = dirents
      .slice(0, BROWSE_MAX)
      .map((d) => {
        const full = path.join(dir, d.name);
        let type = d.isDirectory() ? 'dir' : 'file';
        let size: number | null = null;
        let mtime: string | null = null;
        try {
          const st = fs.statSync(full); // follows symlinks
          if (st.isDirectory()) type = 'dir';
          size = st.size;
          mtime = st.mtime.toISOString();
        } catch {
          /* unreadable entry — keep the dirent's type */
        }
        return { name: d.name, type, size, mtime };
      })
      .sort((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1,
      );

    let writable = false;
    try {
      fs.accessSync(dir, fs.constants.W_OK);
      writable = true;
    } catch {
      /* read-only */
    }
    const parent = path.dirname(dir);
    return {
      ok: true,
      path: dir,
      parent: parent === dir ? null : parent,
      writable,
      truncated,
      entries,
    };
  }

  function prune(dir: string, retention: number): void {
    const keep = Math.max(1, Number(retention) || 1);
    for (const f of listBackups(dir).slice(keep)) {
      for (const ext of ['', '-wal', '-shm']) {
        try {
          fs.unlinkSync(path.join(dir, f.name + ext));
        } catch {
          /* best effort */
        }
      }
    }
  }

  async function runBackup(): Promise<{ name: string }> {
    const cfg = getConfig();
    const probe = probeDir(cfg.dir);
    if (!probe.ok) {
      recordRun('error', `directory not writable: ${probe.error}`);
      throw new Error(probe.error);
    }
    const now = new Date();
    const name = `tdx-${stamp(now)}.db`;
    const dest = path.join(cfg.dir, name);
    try {
      await sqlite.backup(dest); // online backup — consistent mid-write
      // db.backup() inherits WAL mode; collapse the copy into a standalone file.
      const copy = new Database(dest);
      copy.pragma('wal_checkpoint(TRUNCATE)');
      copy.pragma('journal_mode = DELETE');
      copy.close();
      prune(cfg.dir, cfg.retention);
      // git-snapshot the notes vault alongside the DB backup. Self-contained: records
      // its own vault_last_* status and never throws, so it can't fail the DB backup.
      await snapshotVault(sqlite, { reason: 'scheduled' });
      recordRun('ok', null, now);
      return { name };
    } catch (e) {
      recordRun('error', (e as Error).message, now);
      throw e;
    }
  }

  // next local HH:MM strictly after `from`
  function nextFire(timeOfDay: string, from: Date): Date {
    const [hh, mm] = String(timeOfDay).split(':').map(Number);
    const at = new Date(from);
    at.setHours(hh || 0, mm || 0, 0, 0);
    if (at <= from) at.setDate(at.getDate() + 1);
    return at;
  }

  // (re)arm the single daily timer from current config
  function arm(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const cfg = getConfig();
    if (!cfg || !cfg.enabled) {
      sqlite.prepare('UPDATE backup_config SET next_run_at = NULL WHERE id = 1').run();
      return;
    }
    const at = nextFire(cfg.time_of_day, new Date());
    sqlite.prepare('UPDATE backup_config SET next_run_at = ? WHERE id = 1').run(at.toISOString());
    timer = setTimeout(() => {
      runBackup()
        .catch(() => {
          /* status recorded; one bad night must not stop the timer */
        })
        .finally(arm);
    }, at.getTime() - Date.now());
    timer.unref(); // don't keep the process alive solely for the backup timer
  }

  function updateConfig(patch: ConfigPatch): BackupConfigTable {
    const cur = getConfig();
    const next = {
      enabled: patch.enabled != null ? (patch.enabled ? 1 : 0) : cur.enabled,
      dir: patch.dir != null ? String(patch.dir) : cur.dir,
      time_of_day: patch.time_of_day != null ? String(patch.time_of_day) : cur.time_of_day,
      retention: patch.retention != null ? Number(patch.retention) : cur.retention,
    };
    sqlite
      .prepare(
        'UPDATE backup_config SET enabled = ?, dir = ?, time_of_day = ?, retention = ? WHERE id = 1',
      )
      .run(next.enabled, next.dir, next.time_of_day, next.retention);
    arm();
    return getConfig();
  }

  // Called once on real server boot: arm the timer, and run immediately if a
  // scheduled run was missed while the container was down.
  function init(): void {
    const cfg = getConfig();
    if (cfg?.enabled) {
      const stale = !cfg.last_run_at || Date.now() - new Date(cfg.last_run_at).getTime() > STALE_MS;
      if (stale) {
        runBackup()
          .catch(() => {})
          .finally(arm);
        return;
      }
    }
    arm();
  }

  return { getConfig, updateConfig, probeDir, browseDir, listBackups, runBackup, init };
}
