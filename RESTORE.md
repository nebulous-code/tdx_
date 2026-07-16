# Restoring tdx from a backup

Step-by-step recovery from a backup. Backups are created from the app (**@ account → backups**); for how the system works see `docs/BACKUP_DESIGN.md` (database) and `docs/VAULT_BACKUP.md` (notes vault).

Enabling backups protects **two separate stores**, and they restore differently:

- **The database** — a single SQLite file named like `tdx-20260608-021500.db`, holding tasks, events, projects, labels, saved queries, and note *metadata*. Restore it with §1–§3 below (app stopped).
- **The notes vault** — the `.md` files themselves (the note *content*), kept as git history in `vault.git` in your backup directory. Restore it with §4 (live, then sync).

> The **database** restore must be done with the app **stopped** — never copy a file over the live database while it's running. The **vault** restore is done live and followed by a sync.

---

## 1. Pick the backup file you want

Find it in your backup directory (the path shown in **@ account → backups**), or
download one from that screen. Newest filenames sort last (the timestamp is
`YYYYMMDD-HHMMSS`, local time).

---

## 2A. Docker

From your compose directory

```bash
# 1. stop the app
docker compose stop tdx

# 2. put the backup in place of the live database
cp /path/to/tdx-YYYYMMDD-HHMMSS.db ./data/tdx.db

# 3. clear leftover write-ahead files
rm -f ./data/tdx.db-wal ./data/tdx.db-shm

# 4. start the app
docker compose start tdx
```

If your backup directory is bind-mounted into the container, you can copy straight from
it on the host — it's just a normal folder there.

---

## 2B. Bare metal (running with `node`)

Stop your server process first (Ctrl+C, or however you run it), then — using the same
`DB_PATH` your server uses (e.g. `data/tdx.db`):

```bash
cp /path/to/tdx-YYYYMMDD-HHMMSS.db data/tdx.db
rm -f data/tdx.db-wal data/tdx.db-shm
```

Start the server again.

---

## 3. Verify

Open the app and log in. Your data should match the moment that backup was taken.

---

## 4. Restoring notes from the vault backup

The notes vault is backed up as **git history** in `vault.git` inside your backup directory, so you can recover a single note, an earlier version of one, or the whole vault. Unlike the database restore this is done **live** — but it's two steps: put files back on disk, then sync so the app re-reads them.

The vault's files live under your `VAULT_DIR` (Docker: the mounted vault volume; bare-metal dev default: `server/data/vault`), one subdirectory per user — `<user-id>/<path>.md`.

Three things trip people up, so mind them:

- A **delete is itself a commit** in the history. To bring back a deleted note, check out a commit from *before* the delete — often `HEAD~1`; use `git log` to find it. Checking out `HEAD` just gives you the deleted state again.
- **Run git from inside the vault directory** (the work tree) — issued from elsewhere, git refuses the paths.
- Restoring only writes files to disk. The app reads a database *shadow* of the vault, so you **must sync afterward** or the restored notes stay invisible in the app.

```bash
cd "$VAULT_DIR"                 # the mounted vault volume, or server/data/vault in dev
GIT="git --git-dir=<backup-dir>/vault.git --work-tree=."

$GIT log --oneline                                 # find the snapshot you want
$GIT log --oneline -- <user-id>/Notes/Foo.md       # ...or one note's history
$GIT checkout <commit> -- <user-id>/Notes/Foo.md   # restore a single note
$GIT checkout <commit> -- <user-id>                # ...or a whole user's vault
```

Then reconcile the database so the app shows the restored files: use the notes **sync** action in the app, or `POST /api/notes/sync?mode=full` (per user). The sync re-reads the files, re-keys them by their frontmatter `id`, and clears any tombstones left by deletes.

---

## Notes

- **Back up the current database first** if it still opens — copy `tdx.db` somewhere
  before overwriting it, in case you picked the wrong backup.
- **Logins:** `SESSION_SECRET` is **not** in the backup. If you restore onto a machine
  with a different secret, everyone is simply logged out and signs in again — no data
  is lost. Keep your `SESSION_SECRET` saved somewhere safe.
- **Wrong file?** Just repeat the steps with a different backup.
