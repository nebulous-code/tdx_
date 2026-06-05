-- 001_init.sql — initial schema for the tdx_ snapshot store.
--
-- Design notes (see docs/BACKEND_PLAN.md):
--  * The client persists the WHOLE state as a snapshot (PUT /api/state). The server
--    mirrors that snapshot into these normalized tables. Booleans are stored as
--    INTEGER 0/1 and translated back to JS booleans at the state.js boundary.
--  * Phase 1 is single-user and online-first. Deletes are HARD: anything absent
--    from a snapshot is removed. (Soft-delete is only needed for offline sync,
--    which is deferred to Phase 2.)
--  * `meta.version` is a monotonic counter used for optimistic concurrency on
--    /api/state, so two devices can't silently clobber each other.
--  * `reminders_sent` and `push_subscriptions` are SERVER-ONLY state. They are
--    never part of the snapshot and must not be touched by state.js.

-- Single-row table holding the optimistic-concurrency version counter.
CREATE TABLE IF NOT EXISTS meta (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO meta (id, version) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS projects (
  id        TEXT PRIMARY KEY,
  parent_id TEXT,                       -- no enforced FK: client owns cascade, we replace wholesale
  name      TEXT NOT NULL,
  color     TEXT NOT NULL,
  glyph     TEXT NOT NULL,
  collapsed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  project_id   TEXT,
  parent_id    TEXT,
  title        TEXT NOT NULL,
  done         INTEGER NOT NULL DEFAULT 0,
  due          TEXT,                     -- 'YYYY-MM-DD' (date only)
  reminder     TEXT,                     -- 'YYYY-MM-DDTHH:MM' local timestamp (time-precise)
  recurrence   TEXT,                     -- recurrence syntax string, stored verbatim
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  completed_at TEXT
);

-- Speeds up the scheduler's "what reminders are due now" query.
CREATE INDEX IF NOT EXISTS idx_tasks_reminder
  ON tasks(reminder) WHERE reminder IS NOT NULL AND done = 0;

CREATE TABLE IF NOT EXISTS labels (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_labels (
  task_id  TEXT NOT NULL,
  label_id TEXT NOT NULL,
  PRIMARY KEY (task_id, label_id)
);

CREATE TABLE IF NOT EXISTS saved_queries (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  glyph  TEXT NOT NULL,
  query  TEXT NOT NULL,
  system INTEGER NOT NULL DEFAULT 0
);

-- Records which reminders have already fired. The compound key (task_id, reminder_at)
-- is the RE-ARM mechanism: edit a reminder (new timestamp) or spawn a recurrence
-- (new task id) -> new key -> it fires again. Unchanged -> suppressed.
CREATE TABLE IF NOT EXISTS reminders_sent (
  task_id     TEXT NOT NULL,
  reminder_at TEXT NOT NULL,
  sent_at     TEXT NOT NULL,
  PRIMARY KEY (task_id, reminder_at)
);

-- One row per subscribed browser/device. `endpoint` is globally unique.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  keys_json  TEXT NOT NULL,             -- JSON: { p256dh, auth }
  created_at TEXT NOT NULL
);
