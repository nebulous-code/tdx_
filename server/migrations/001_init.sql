-- 001_init.sql — D1 target schema (fresh service, not a replay of legacy 001–015).
-- Shareable resources use a global UUID `id` PK + `owner_id` (instead of the legacy
-- composite (user_id, id)) and carry `updated_at` for later per-resource ETag
-- concurrency. The ownership / sharing / token tables exist from day one but stay
-- unused while the app is single-user; wiring is frontend work in a later step.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,                 -- UUID
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  theme         TEXT,                             -- nullable; client defaults to 'amber'
  week_start    INTEGER NOT NULL DEFAULT 1,       -- 0=Sun .. 6=Sat
  sort_prefs    TEXT,                             -- nullable JSON {order,enabled,dirs}
  fib_sizing    INTEGER NOT NULL DEFAULT 0,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,                    -- sha256(raw token) hex
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,                       -- ISO; sliding 30d
  last_seen  TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE projects (
  id         TEXT PRIMARY KEY,                    -- UUID
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  TEXT,                                -- UUID or NULL (no FK; client owns cascade)
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,
  glyph      TEXT NOT NULL,
  collapsed  INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  health     TEXT NOT NULL DEFAULT '[]',          -- JSON array of enabled check keys
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_projects_owner ON projects(owner_id);

CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,                  -- UUID
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_id   TEXT NOT NULL REFERENCES users(id),
  assignee_id  TEXT REFERENCES users(id),         -- nullable; distinct from creator/owner
  project_id   TEXT,                              -- UUID or NULL (no FK; client owns cascade)
  parent_id    TEXT,                              -- UUID or NULL (subtask)
  title        TEXT NOT NULL,
  done         INTEGER NOT NULL DEFAULT 0,
  due          TEXT,                              -- YYYY-MM-DD
  reminder     TEXT,                              -- YYYY-MM-DDTHH:MM local
  recurrence   TEXT,                              -- recurrence syntax string
  notes        TEXT NOT NULL DEFAULT '',
  priority     INTEGER NOT NULL DEFAULT 0,        -- 0..5
  size         INTEGER NOT NULL DEFAULT 0,        -- 0 | 1 2 3 5 8 13 (Fibonacci)
  position     INTEGER NOT NULL DEFAULT 0,
  archived     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  completed_at TEXT,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_tasks_owner ON tasks(owner_id);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX idx_tasks_reminder ON tasks(reminder) WHERE reminder IS NOT NULL AND done = 0;

CREATE TABLE labels (
  id       TEXT PRIMARY KEY,                      -- UUID
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  pinned   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_labels_owner ON labels(owner_id);

CREATE TABLE task_labels (
  task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);
CREATE INDEX idx_task_labels_label ON task_labels(label_id);

CREATE TABLE saved_queries (
  id       TEXT PRIMARY KEY,                      -- UUID
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  glyph    TEXT NOT NULL,
  query    TEXT NOT NULL,
  system   INTEGER NOT NULL DEFAULT 0,
  color    TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  pinned   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_saved_queries_owner ON saved_queries(owner_id);

-- ---- ownership / sharing (present now, single-user defaults; wired later) ----
CREATE TABLE grants (
  id             TEXT PRIMARY KEY,                -- UUID
  resource_type  TEXT NOT NULL,                   -- 'project' (later: 'calendar', 'note-folder')
  resource_id    TEXT NOT NULL,
  principal_type TEXT NOT NULL,                   -- 'user' | 'group'
  principal_id   TEXT NOT NULL,
  role           TEXT NOT NULL,                   -- 'viewer' | 'editor' | 'owner'
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_grants_resource ON grants(resource_type, resource_id);
CREATE INDEX idx_grants_principal ON grants(principal_type, principal_id);

CREATE TABLE groups (
  id         TEXT PRIMARY KEY,                    -- UUID
  name       TEXT NOT NULL,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE group_members (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',      -- member | admin
  created_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE api_tokens (
  id           TEXT PRIMARY KEY,                  -- UUID
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL,                     -- hashed at rest, opaque + revocable
  scopes       TEXT NOT NULL DEFAULT '[]',        -- JSON array (e.g. ["tasks:read"])
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT
);
CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);

-- instance-level singleton (unchanged from legacy)
CREATE TABLE backup_config (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  enabled     INTEGER NOT NULL DEFAULT 0,
  dir         TEXT NOT NULL DEFAULT '/backups',
  time_of_day TEXT NOT NULL DEFAULT '02:00',
  retention   INTEGER NOT NULL DEFAULT 7,
  last_run_at TEXT,
  last_status TEXT,
  last_error  TEXT,
  next_run_at TEXT
);
INSERT INTO backup_config (id) VALUES (1);  -- the singleton row (defaults above)
