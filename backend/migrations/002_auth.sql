-- 002_auth.sql — multi-tenant auth.
--
-- Adds users + sessions, scopes every data table to a user via a COMPOSITE
-- PRIMARY KEY (user_id, id), and retires the single global meta.version in favor
-- of a per-user users.state_version.
--
-- Migration notes:
--  * The runner wraps this file in one transaction (db.js). foreign_keys is ON at
--    the connection level. 001 declared NO foreign keys, so dropping/rebuilding the
--    data tables cascades nothing.
--  * Composite PK columns are NOT NULL, so existing rows can't be left with a NULL
--    owner. They're backfilled with the reserved sentinel owner '__unowned__'; the
--    first user created by tools/add-user.js adopts them (UPDATE ... WHERE
--    user_id='__unowned__'). No real user can ever have that id.
--  * FK policy (by design): only task_labels carries intra-user FKs (to tasks and
--    labels), declared DEFERRABLE so bulk insert order doesn't matter. tasks/projects
--    keep NO ref FKs, preserving the forgiving whole-snapshot replace in state.js.

-- 1) Auth tables ------------------------------------------------------------
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  state_version INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,                 -- sha256(raw token) hex
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,                    -- ISO; sliding 30d
  last_seen  TEXT
);
CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- 2) Rebuild data tables with composite PK (user_id, id) --------------------
-- projects
CREATE TABLE projects_new (
  user_id   TEXT NOT NULL,
  id        TEXT NOT NULL,
  parent_id TEXT,
  name      TEXT NOT NULL,
  color     TEXT NOT NULL,
  glyph     TEXT NOT NULL,
  collapsed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);
INSERT INTO projects_new (user_id, id, parent_id, name, color, glyph, collapsed)
  SELECT '__unowned__', id, parent_id, name, color, glyph, collapsed FROM projects;
DROP TABLE projects;
ALTER TABLE projects_new RENAME TO projects;

-- labels
CREATE TABLE labels_new (
  user_id TEXT NOT NULL,
  id      TEXT NOT NULL,
  name    TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);
INSERT INTO labels_new (user_id, id, name)
  SELECT '__unowned__', id, name FROM labels;
DROP TABLE labels;
ALTER TABLE labels_new RENAME TO labels;

-- tasks (no ref FKs by design — client owns cascade, snapshot replaced wholesale)
CREATE TABLE tasks_new (
  user_id      TEXT NOT NULL,
  id           TEXT NOT NULL,
  project_id   TEXT,
  parent_id    TEXT,
  title        TEXT NOT NULL,
  done         INTEGER NOT NULL DEFAULT 0,
  due          TEXT,
  reminder     TEXT,
  recurrence   TEXT,
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (user_id, id)
);
INSERT INTO tasks_new (user_id, id, project_id, parent_id, title, done, due,
                       reminder, recurrence, notes, created_at, completed_at)
  SELECT '__unowned__', id, project_id, parent_id, title, done, due,
         reminder, recurrence, notes, created_at, completed_at FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;
CREATE INDEX idx_tasks_reminder ON tasks(reminder) WHERE reminder IS NOT NULL AND done = 0;

-- task_labels (intra-user FKs to the rebuilt tasks + labels)
CREATE TABLE task_labels_new (
  user_id  TEXT NOT NULL,
  task_id  TEXT NOT NULL,
  label_id TEXT NOT NULL,
  PRIMARY KEY (user_id, task_id, label_id),
  FOREIGN KEY (user_id, task_id)  REFERENCES tasks(user_id, id)  DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (user_id, label_id) REFERENCES labels(user_id, id) DEFERRABLE INITIALLY DEFERRED
);
INSERT INTO task_labels_new (user_id, task_id, label_id)
  SELECT '__unowned__', task_id, label_id FROM task_labels;
DROP TABLE task_labels;
ALTER TABLE task_labels_new RENAME TO task_labels;

-- saved_queries
CREATE TABLE saved_queries_new (
  user_id TEXT NOT NULL,
  id      TEXT NOT NULL,
  name    TEXT NOT NULL,
  glyph   TEXT NOT NULL,
  query   TEXT NOT NULL,
  system  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);
INSERT INTO saved_queries_new (user_id, id, name, glyph, query, system)
  SELECT '__unowned__', id, name, glyph, query, system FROM saved_queries;
DROP TABLE saved_queries;
ALTER TABLE saved_queries_new RENAME TO saved_queries;

-- 3) Retire the global version counter (now per-user users.state_version) ----
DROP TABLE meta;

-- 4) Drop dead server-only tables from the removed notifications feature -----
DROP TABLE IF EXISTS reminders_sent;
DROP TABLE IF EXISTS push_subscriptions;
