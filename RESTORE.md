# Restoring tdx from a backup

Step-by-step recovery from a backup file. (Backups are created from the app:
**@ account → backups**. For how the system works, see `docs/BACKUP_DESIGN.md`.)

A backup is a single SQLite file named like `tdx-20260608-021500.db`. Restoring means
stopping the app, putting that file in place of the live database, and starting again.

> Do this with the app **stopped**. Never copy a file over the live database while the
> app is running.

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

## Notes

- **Back up the current database first** if it still opens — copy `tdx.db` somewhere
  before overwriting it, in case you picked the wrong backup.
- **Logins:** `SESSION_SECRET` is **not** in the backup. If you restore onto a machine
  with a different secret, everyone is simply logged out and signs in again — no data
  is lost. Keep your `SESSION_SECRET` saved somewhere safe.
- **Wrong file?** Just repeat the steps with a different backup.
