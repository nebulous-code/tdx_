-- 005_calendars_folders.sql — per-app "category" entities (D2 2e §2).
-- Calendars are to events what projects are to tasks; folders are to notes the
-- same, and map to real vault subdirs. Labels gain event/note join tables so the
-- one labels system spans all three apps. Events gain calendar_id; notes gain a
-- review_at date (the note's "due" for query purposes). Same ownership shape as
-- projects (owner-only in D1/D2). Readable per-user ids are added in 006.

-- calendars: the events "category" (mirror projects, no health, flat — no nesting)
CREATE TABLE calendars (
  id         TEXT PRIMARY KEY,                    -- UUID
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,
  glyph      TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_calendars_owner ON calendars(owner_id);

-- folders: the notes "category"; nests (parent_id) and maps to a vault subdir (path).
-- The on-disk dir is the source of truth for existence/location; this row shadows it
-- with icon/color metadata (carried across external renames by a .tdx-folder.json marker).
CREATE TABLE folders (
  id         TEXT PRIMARY KEY,                    -- UUID = the folder marker id
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  TEXT,                                -- UUID or NULL (nesting; client owns cascade)
  name       TEXT NOT NULL,
  path       TEXT NOT NULL,                       -- relative to the vault root (the subdir)
  color      TEXT NOT NULL,
  glyph      TEXT NOT NULL,
  collapsed  INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_folders_owner ON folders(owner_id);
CREATE UNIQUE INDEX idx_folders_path ON folders(owner_id, path) WHERE archived = 0;

-- labels span events + notes (mirror task_labels)
CREATE TABLE event_labels (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, label_id)
);
CREATE INDEX idx_event_labels_label ON event_labels(label_id);

CREATE TABLE note_labels (
  note_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, label_id)
);
CREATE INDEX idx_note_labels_label ON note_labels(label_id);

-- events belong to one calendar; notes carry a review date (their query "due")
ALTER TABLE events ADD COLUMN calendar_id TEXT;     -- UUID or NULL (a default calendar backfills these)
ALTER TABLE notes  ADD COLUMN folder_id   TEXT;     -- UUID or NULL (derived from the note's vault path)
ALTER TABLE notes  ADD COLUMN review_at   TEXT;     -- YYYY-MM-DD or NULL (note's "due" for queries)
CREATE INDEX idx_events_calendar ON events(calendar_id);
CREATE INDEX idx_notes_folder ON notes(folder_id);
