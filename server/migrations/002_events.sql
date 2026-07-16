-- 002_events.sql — the `event` domain (D2). Calendar events: start/end, all-day,
-- location, recurrence (same Rec syntax as tasks). Same ownership shape as tasks
-- (owner_id/creator_id/assignee_id). Events aren't "completed", so no done/
-- completed_at. Recurring events are expanded virtually at read time (not spawned).

CREATE TABLE events (
  id          TEXT PRIMARY KEY,                  -- UUID
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_id  TEXT NOT NULL REFERENCES users(id),
  assignee_id TEXT REFERENCES users(id),         -- nullable
  title       TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  location    TEXT,                              -- nullable
  all_day     INTEGER NOT NULL DEFAULT 0,        -- 1 = date-only, no time-of-day
  start_at    TEXT NOT NULL,                     -- YYYY-MM-DD (all-day) | YYYY-MM-DDTHH:MM
  end_at      TEXT,                              -- nullable, same format
  recurrence  TEXT,                              -- nullable; Rec syntax string
  reminder    TEXT,                              -- nullable; YYYY-MM-DDTHH:MM
  position    INTEGER NOT NULL DEFAULT 0,
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_events_owner ON events(owner_id);
CREATE INDEX idx_events_start ON events(start_at);
