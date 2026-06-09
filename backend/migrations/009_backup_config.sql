-- 009_backup_config.sql — scheduled database backups (instance-level, admin-only).
--
-- Two changes:
--  1) users.is_admin — backups are NOT per-user (one SQLite file = every tenant's
--     data), so the feature is gated to admins. On an existing DB we promote the
--     earliest-created user so an upgrade keeps an admin; on a fresh DB this is a
--     no-op and tools/add-user.js marks the first user admin instead.
--  2) backup_config — a SINGLE-ROW (id=1) instance config table. Deliberately NOT
--     scoped by user_id: it's the first non-tenant table since the global
--     meta.version was retired (see 002_auth.sql). The scheduler + routes read/write
--     this one row.

ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

UPDATE users SET is_admin = 1
 WHERE id = (SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1);

CREATE TABLE backup_config (
  id           INTEGER PRIMARY KEY CHECK (id = 1),   -- enforce a single row
  enabled      INTEGER NOT NULL DEFAULT 0,
  dir          TEXT    NOT NULL DEFAULT '/backups',  -- path INSIDE the container (a bind mount)
  time_of_day  TEXT    NOT NULL DEFAULT '02:00',     -- local HH:MM, daily
  retention    INTEGER NOT NULL DEFAULT 7,           -- keep N newest files in dir
  last_run_at  TEXT,            -- ISO; when the last run finished
  last_status  TEXT,            -- 'ok' | 'error' | NULL (never run)
  last_error   TEXT,            -- message when last_status = 'error'
  next_run_at  TEXT             -- ISO; set when the scheduler arms
);

INSERT INTO backup_config (id) VALUES (1);
