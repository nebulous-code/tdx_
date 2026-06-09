// backup.js — scheduled, consistent backups of the whole SQLite database.
//
// Two-layer design (see docs/BACKUP_DESIGN.md): this module's only job is to drop a
// CONSISTENT copy of the DB into a directory on a daily timer; durability / offsite /
// long-term retention are owned by the storage layer (a ZFS dataset bind-mounted to
// `dir`). We keep only the newest `retention` files so the directory stays bounded.
//
// Consistency: better-sqlite3's db.backup() is an online backup off the live handle —
// safe even mid-write, no WAL copy hazard (unlike cp/rsync of the .db file).
//
// State lives in the single-row backup_config table (migration 009). Instance-level,
// not per-user; the routes that drive it are admin-only.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const db = require('./db');

const BACKUP_RE = /^tdx-\d{8}-\d{6}\.db$/;       // tdx-YYYYMMDD-HHmmss.db
const STALE_MS = 25 * 60 * 60 * 1000;            // missed-run threshold on boot (>25h)

let timer = null;

// ---- config ---------------------------------------------------------------
function getConfig() {
  return db.prepare('SELECT * FROM backup_config WHERE id = 1').get();
}

// Persist validated config (caller validates) and re-arm the scheduler.
function updateConfig(patch) {
  const cur = getConfig();
  const next = {
    enabled: patch.enabled != null ? (patch.enabled ? 1 : 0) : cur.enabled,
    dir: patch.dir != null ? String(patch.dir) : cur.dir,
    time_of_day: patch.time_of_day != null ? String(patch.time_of_day) : cur.time_of_day,
    retention: patch.retention != null ? Number(patch.retention) : cur.retention,
  };
  db.prepare('UPDATE backup_config SET enabled = ?, dir = ?, time_of_day = ?, retention = ? WHERE id = 1')
    .run(next.enabled, next.dir, next.time_of_day, next.retention);
  arm();
  return getConfig();
}

function recordRun(status, error, when) {
  db.prepare('UPDATE backup_config SET last_run_at = ?, last_status = ?, last_error = ? WHERE id = 1')
    .run((when || new Date()).toISOString(), status, error || null);
}

// ---- filesystem helpers ---------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
// Local timestamp (process TZ — America/New_York in prod) so filenames sort by time.
function stamp(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// List backups in dir, newest first (filename sorts chronologically).
function listBackups(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  return names
    .filter((n) => BACKUP_RE.test(n))
    .sort()
    .reverse()
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, mtime: st.mtime.toISOString() };
    });
}

// Read-only directory listing for the UI's file explorer (admin-only). Lets the
// operator navigate the filesystem AS THE PROCESS SEES IT to pick / confirm the
// backup directory (e.g. verify a bind mount actually landed). Non-invasive: uses
// access(W_OK) for the writability hint rather than touching a temp file.
const BROWSE_MAX = 500;
function browseDir(input) {
  const dir = path.resolve(input && String(input).trim() ? String(input).trim() : getConfig().dir);
  let dirents;
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    const msg = e.code === 'ENOENT' ? 'no such directory'
      : e.code === 'ENOTDIR' ? 'not a directory'
      : e.code === 'EACCES' ? 'permission denied'
      : e.message;
    return { ok: false, path: dir, error: msg };
  }
  const truncated = dirents.length > BROWSE_MAX;
  const entries = dirents.slice(0, BROWSE_MAX).map((d) => {
    const full = path.join(dir, d.name);
    let type = d.isDirectory() ? 'dir' : 'file';
    let size = null, mtime = null;
    try {
      const st = fs.statSync(full);          // follows symlinks
      if (st.isDirectory()) type = 'dir';
      size = st.size; mtime = st.mtime.toISOString();
    } catch (_) { /* unreadable entry — keep the dirent's type */ }
    return { name: d.name, type, size, mtime };
  }).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : (a.type === 'dir' ? -1 : 1)));

  let writable = false;
  try { fs.accessSync(dir, fs.constants.W_OK); writable = true; } catch (_) { /* read-only */ }
  const parent = path.dirname(dir);
  return { ok: true, path: dir, parent: parent === dir ? null : parent, writable, truncated, entries };
}

// Confirm dir exists (create if needed) and is writable, by touching a temp file.
// Returns { ok, count } or { ok:false, error }. Drives the UI's live writability badge.
function probeDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.tdx-write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return { ok: true, count: listBackups(dir).length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function prune(dir, retention) {
  const keep = Math.max(1, Number(retention) || 1);
  for (const f of listBackups(dir).slice(keep)) {
    for (const ext of ['', '-wal', '-shm']) {       // sweep any sidecars defensively
      try { fs.unlinkSync(path.join(dir, f.name + ext)); } catch (_) { /* best effort */ }
    }
  }
}

// ---- the job --------------------------------------------------------------
// Make one consistent copy now, prune to retention, record status. Throws (and
// records status='error') if the directory isn't writable or the copy fails.
async function runBackup() {
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
    await db.backup(dest);                         // online backup — consistent mid-write
    // db.backup() inherits the source's WAL mode, leaving a (0-byte) dest-wal/-shm.
    // Collapse the copy into a single standalone file so the artifact is portable
    // and nothing can orphan a WAL sidecar later.
    const copy = new Database(dest);
    copy.pragma('wal_checkpoint(TRUNCATE)');
    copy.pragma('journal_mode = DELETE');
    copy.close();
    prune(cfg.dir, cfg.retention);
    recordRun('ok', null, now);
    return { name };
  } catch (e) {
    recordRun('error', e.message, now);
    throw e;
  }
}

// ---- scheduler ------------------------------------------------------------
// Next local HH:MM strictly after `from`.
function nextFire(timeOfDay, from) {
  const [hh, mm] = String(timeOfDay).split(':').map(Number);
  const at = new Date(from);
  at.setHours(hh || 0, mm || 0, 0, 0);
  if (at <= from) at.setDate(at.getDate() + 1);
  return at;
}

// (Re)arm the single daily timer from current config. Clears next_run_at when disabled.
function arm() {
  if (timer) { clearTimeout(timer); timer = null; }
  const cfg = getConfig();
  if (!cfg || !cfg.enabled) {
    db.prepare('UPDATE backup_config SET next_run_at = NULL WHERE id = 1').run();
    return;
  }
  const at = nextFire(cfg.time_of_day, new Date());
  db.prepare('UPDATE backup_config SET next_run_at = ? WHERE id = 1').run(at.toISOString());
  timer = setTimeout(() => {
    runBackup().catch(() => { /* status recorded; one bad night must not stop the timer */ })
      .finally(arm);   // re-arm for the next day regardless of outcome
  }, at.getTime() - Date.now());
}

// Called once on server boot. Arms the timer, and if backups are enabled but the
// last run is stale (container was down at the scheduled minute, e.g. a Watchtower
// update), runs one immediately.
function init() {
  const cfg = getConfig();
  if (cfg && cfg.enabled) {
    const stale = !cfg.last_run_at || (Date.now() - new Date(cfg.last_run_at).getTime()) > STALE_MS;
    if (stale) {
      runBackup().catch(() => {}).finally(arm);
      return;
    }
  }
  arm();
}

module.exports = {
  BACKUP_RE,
  getConfig,
  updateConfig,
  probeDir,
  browseDir,
  listBackups,
  runBackup,
  init,
};
