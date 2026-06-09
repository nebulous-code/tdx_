# Backup feature — design

Status: **implemented**. This doc is both the design and the operational reference
(see §8 for the restore runbook).

## 1. Goal

Scheduled, hands-off backups of the production SQLite database, configured from the
app's UI, written to a location the operator chooses (default `/backups`). Once set
up, the operator should never have to think about it — durability, offsite, and
long-term retention are delegated to the storage layer (ZFS), not re-implemented in
the app.

### Non-goals
- **Not** a per-user feature. The database is a single SQLite file holding every
  tenant's data, so a backup is inherently *instance-level* (admin-only).
- **Not** a restore button. Restoring overwrites the live DB and must happen with the
  server stopped — it stays a documented CLI runbook (§8), never a UI action.
- **Not** a retention/offsite engine. The app keeps a small rolling window so the
  directory doesn't grow without bound; ZFS snapshots + replication own real history
  and offsite. (See §3.)

## 2. Design principle: two layers, cleanly split

| Concern | Owner |
|---|---|
| Produce a **consistent** copy of the DB, on a **schedule** | **the app** (this feature) |
| Durability, RAID, **offsite**, long-term **retention** | **ZFS** (already configured) |

The app's only job is to drop a consistent `.db` file into a directory on a timer.
That directory is a bind mount onto a ZFS dataset that already has RAID + offsite
replication. We are not rebuilding any of that.

### Why the app makes the copy (not `cp`/rsync/cron)
The DB runs in WAL mode. A plain file copy of the live `.db` while the server is
writing yields a stale or corrupt file (the exact `SQLITE_CORRUPT` we hit seeding
the dev DB). `better-sqlite3` exposes `db.backup(dest)` — an **online backup** off the
live handle that is consistent even mid-write and does not block readers. Because the
app already owns the DB handle, it is the one place that can make a clean copy with
zero ceremony (no checkpoint dance, no WAL gotcha). This is the core reason the
in-app approach is clean rather than fiddly.

## 3. The container / bind-mount model (important)

The app runs **inside a container**. It can only write to paths that are writable
*inside the container*. It cannot see the host filesystem except through a Docker
**bind mount**. Therefore:

- The **UI configures the path the app writes to** (a path as seen *inside* the
  container).
- The **host → container mapping lives in `docker-compose.yml`**, not the UI.

There is **one code path**: a validated "backup directory" string in config. The only
deployment choice is what you bind-mount:

- **This deployment (Nick's box)** — identity mount so the UI shows the real host path:
  ```yaml
  volumes:
    - /the_agency/home_lab/tdx_:/the_agency/home_lab/tdx_
  ```
  In the UI you set the directory to `/the_agency/home_lab/tdx_`; what you see is
  literally what's on disk on the ZFS dataset.

- **Shipped default / self-hosters** — `compose.yaml` ships with `- ./backups:/backups`
  (or the self-hoster maps their own dataset, e.g. `- /mnt/pool/tdx:/backups`), and the
  default configured directory is `/backups`. A self-hoster who wants the identity style
  can mirror Nick's mount with their own path. Different location, **zero code change**.

### Catching a bad path at config time (the "set and forget" safeguard)
When the directory is saved in the UI, the server **probes it**: ensures it exists
(create if needed) and writes+deletes a temp file. The UI shows inline status:
- `✓ writable — N existing backups` (green), or
- `✗ not writable / not mounted: <reason>` (red).

So a wrong path or a missing mount is caught immediately in the form — not silently at
2am. The external staleness alarm (§9) covers everything after that.

## 4. Data model — migration `009_backup_config.sql`

Two changes, in the existing numbered-migration style (wrapped in one transaction by
`db.js`):

1. **Admin flag** on users:
   ```sql
   ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
   UPDATE users SET is_admin = 1 WHERE username = 'nebulous-code';  -- existing operator
   ```
   And `tools/add-user.js` marks the **first** user (the one that adopts `__unowned__`
   data) as admin, so a fresh self-host install has an admin from the start.

2. **Singleton instance-config table** (the first non-tenant table since the global
   `meta.version` was retired — intentionally *not* scoped by `user_id`):
   ```sql
   CREATE TABLE backup_config (
     id           INTEGER PRIMARY KEY CHECK (id = 1),   -- single row
     enabled      INTEGER NOT NULL DEFAULT 0,
     dir          TEXT    NOT NULL DEFAULT '/backups',
     time_of_day  TEXT    NOT NULL DEFAULT '02:00',     -- local HH:MM
     retention    INTEGER NOT NULL DEFAULT 7,           -- keep N files in dir
     last_run_at  TEXT,            -- ISO, local
     last_status  TEXT,            -- 'ok' | 'error' | null (never run)
     last_error   TEXT,            -- message when last_status='error'
     next_run_at  TEXT             -- ISO, computed when (re)armed
   );
   INSERT INTO backup_config (id) VALUES (1);
   ```

`db.js` already returns the live handle; `resolveSession()` / `publicUser()` get
`is_admin` added (see §6, §7).

## 5. Admin gating

- `request.user` is set by `authenticate` from `resolveSession()`. We extend the
  session-user SELECT to include `is_admin`.
- A new preHandler **`authenticateAdmin`**: runs `authenticate`, then `403` unless
  `request.user.is_admin`. All `/api/backups/*` routes use it.
- `publicUser()` gains `is_admin: !!u.is_admin` so the frontend can show/hide the
  backups entry (`store.currentUser.is_admin`).

With a single operator today this is effectively a no-op, but it prevents a future
second user from backing up or downloading the entire multi-tenant database.

## 6. Backend

### 6a. Scheduler (`backend/src/backup.js`)
Single Node process / single container, so an in-process timer is sufficient (no cron
dependency):
- On server boot: read `backup_config`. If `enabled`, compute the next `time_of_day`
  in local TZ → `setTimeout` → run the job → re-arm for the next day. Persist
  `next_run_at`.
- On config change (PUT): cancel the pending timer and re-arm from the new config.
- **Missed-run catch-up (optional, recommended):** if `enabled` and `last_run_at` is
  older than ~25h on boot, run once immediately (covers the container being down at the
  scheduled minute, e.g. a Watchtower update).
- Watchtower restarts are transparent: the scheduler simply re-arms from persisted
  config on the new container.

### 6b. Backup job
1. Resolve `dir`; ensure it exists and is writable (same probe as §3).
2. `await db.backup(path.join(dir, fileName))` where
   `fileName = tdx-YYYYMMDD-HHmmss.db` (local TZ from the `TZ` env — `America/New_York`
   in prod).
3. **Prune**: list `tdx-*.db` in `dir`, sort by name (timestamp-sortable), delete all
   but the newest `retention`.
4. Write `last_run_at`, `last_status`, `last_error`, `next_run_at`.
- Errors are caught, recorded in `last_status='error'` + `last_error`, and logged.
  The timer still re-arms (one bad night doesn't disable backups).

### 6c. Routes (`backend/src/routes/backup.js`, registered in `server.js`)
All gated by `authenticateAdmin`:
- `GET  /api/backups/config` → config + status + `{ dirOk, dirError }` from a live probe.
- `PUT  /api/backups/config` → validate (`dir` writable, `time_of_day` HH:MM,
  `retention` ≥ 1), persist, re-arm scheduler, return the same shape as GET.
- `POST /api/backups/run` → run the job now; return updated status (used by "Back up now").
- `GET  /api/backups` → list existing `tdx-*.db` in `dir` with `{ name, size, mtime }`.
- `GET  /api/backups/:name/download` → stream one file. `:name` is validated against
  `^tdx-\d{8}-\d{6}\.db$` and resolved strictly within `dir` (no path traversal).

## 7. Frontend

### 7a. Entry point — a button on the `@` account screen
`account-screen.js` is a `KbForm` modal. We add, **only when
`store.currentUser.is_admin`**, an `admin` separator with a row:
```
admin
  backups                                        ›
```
- Declared in `kbRows()` (so `j/k` reaches it) and as a clickable row.
- Activating it emits an event the root handles by opening the new
  `<backup-screen>` modal (same pattern as how `account-screen` itself is mounted in
  `index.html`).

### 7b. New component — `frontend/js/backup-screen.js`
A `KbForm` modal mirroring `account-screen.js` conventions:
- **enabled** — toggle row.
- **directory** — text input; on blur / on save the form calls the probe and shows
  `✓ writable — N existing` / `✗ …` inline.
- **time of day** — `HH:MM` input (or a simple time `<select>`).
- **retention** — number input (keep N).
- **status line** — `last run: …`, `next run: …`, and `last error: …` in red when
  `last_status='error'`.
- **Back up now** — button → `POST /api/backups/run`, then refresh status.
- **existing backups** — list of `{name, size, date}` with a download link each.
- Save → `PUT /api/backups/config`. Esc uses the shared `KbForm` dirty-guard.

No new global keybinding — it's reached through the account screen, consistent with
the other modals.

## 8. Restore — CLI runbook, **not** a UI button

Restoring overwrites the live DB; doing that under the running process corrupts it, so
it stays a stop → swap-file → start operator step (same shape as `tools/dev.sh` /
`tools/snapshot.sh`). The step-by-step user-facing procedure lives at the repo root in
**[`RESTORE.md`](../RESTORE.md)** — that's what the UI links to. Test one real restore
after rollout; a backup that's never been restored isn't a backup.

## 9. Failure alarm — external staleness check

A backup you never look at fails silently (disk full, dataset unmounted, permissions)
and you find out the day you need it. A passive in-app banner doesn't help because
nobody looks. Since ZFS/host monitoring already exists and is trusted, the alarm lives
**outside the app**: watch the backup dataset and alert if the **newest `tdx-*.db` is
older than ~2× the interval** (e.g. >26h for daily). This catches every failure mode,
including the app being down. (An in-app banner on `last_status='error'` can be added
later if wanted — noted as future work, not in this cut.)

## 10. Ops / deploy

- **Prod compose** (`~/docker/tdx/docker-compose.yml`): add the identity bind mount
  `- /the_agency/home_lab/tdx_:/the_agency/home_lab/tdx_`, set the UI directory to that
  path.
- **Shipped `compose.yaml`**: add `- ./backups:/backups` and keep the config default
  `/backups` so a fresh clone works out of the box.
- **Permissions/UID gotcha** (the thing most likely to bite): the dataset/dir must be
  writable by the container's runtime UID. We confirm what UID the image runs as and
  `chown` the dataset to match; the §3 write-probe surfaces it immediately if not.
- No new required env var — the directory is config, defaulting to `/backups`.

## 11. Security notes
- All backup routes are admin-only (`authenticateAdmin`, `403` otherwise).
- Download endpoint validates `:name` against a strict pattern and resolves within the
  configured dir (no `../` traversal).
- A backup file is a full copy of every tenant's data — hence admin-gated, and the
  destination should be a private dataset.
- `SESSION_SECRET` lives in `.env`, not the DB; it is **not** in the backup. Losing it
  doesn't lose data (it invalidates sessions). Operator should store it safely
  separately — noted in the runbook.

## 12. Edge cases handled
- Container down at the scheduled minute → optional missed-run catch-up on boot (§6a).
- One failed run → recorded, timer re-arms, next night proceeds.
- Directory missing/not mounted/not writable → caught by the probe at save and by the
  job (status=error), and by the external alarm.
- Disk full → job errors, status=error, alarm fires; pruning keeps the window bounded.
- Watchtower auto-update → new container re-arms from persisted config.

## 13. Testing plan
- `node --check` each new/changed JS; migration applies cleanly on a copy of prod.
- Unit-ish: trigger `POST /api/backups/run` → a `tdx-*.db` appears, opens read-only,
  row counts match live.
- Schedule: set a near-future `time_of_day`, confirm it fires once and re-arms.
- Retention: set `retention=2`, run 3×, confirm only 2 newest remain.
- Admin gate: a non-admin user (test) gets `403` on every `/api/backups/*`.
- Path validation: point `dir` at an unwritable path → red status, no crash.
- **Restore**: do one real stop→swap→start on the dev box and confirm data.
- Non-admin and logged-out: no backups row in the account screen.

## 14. Files touched (summary)
- `backend/migrations/009_backup_config.sql` *(new)*
- `backend/src/backup.js` *(new — scheduler + job)*
- `backend/src/routes/backup.js` *(new — routes)*
- `backend/src/server.js` *(register backup routes; init scheduler on boot)*
- `backend/src/auth.js` *(add `authenticateAdmin`; include `is_admin` in session user)*
- `backend/src/routes/auth.js` *(`publicUser` → add `is_admin`)*
- `tools/add-user.js` *(first user → `is_admin=1`)*
- `frontend/js/backup-screen.js` *(new — modal)*
- `frontend/js/account-screen.js` *(admin-only "backups" row)*
- `frontend/index.html` *(mount `<backup-screen>`; load the new script)*
- `compose.yaml` *(default `./backups:/backups` mount)*
- `docs/PROD_MIGRATION.md` *(backup + restore runbook, alarm note)*

## 15. Open questions / future work
- In-app failure banner (deferred; external alarm first).
- Backup-now progress feedback for very large DBs (currently fast; revisit if needed).
- Optional: encrypt-at-rest for the backup files (today relies on the dataset being
  private). Out of scope for this cut.
