-- 006_readable_ids.sql — human-readable per-user ids (D2 2e §5). The UUID stays the
-- canonical key + link target; this is a DISPLAY/authoring alias (t_0001, p_0002, …),
-- per owner + type, monotonic (no reuse). A small counter table allocates the next seq.

ALTER TABLE tasks     ADD COLUMN readable_id TEXT;   -- t_NNNN
ALTER TABLE projects  ADD COLUMN readable_id TEXT;   -- p_NNNN
ALTER TABLE events    ADD COLUMN readable_id TEXT;   -- e_NNNN
ALTER TABLE notes     ADD COLUMN readable_id TEXT;   -- n_NNNN
ALTER TABLE calendars ADD COLUMN readable_id TEXT;   -- c_NNNN
ALTER TABLE folders   ADD COLUMN readable_id TEXT;   -- f_NNNN

-- one readable id per (owner, type); partial so pre-backfill NULLs don't collide
CREATE UNIQUE INDEX idx_tasks_readable     ON tasks(owner_id, readable_id)     WHERE readable_id IS NOT NULL;
CREATE UNIQUE INDEX idx_projects_readable  ON projects(owner_id, readable_id)  WHERE readable_id IS NOT NULL;
CREATE UNIQUE INDEX idx_events_readable    ON events(owner_id, readable_id)    WHERE readable_id IS NOT NULL;
CREATE UNIQUE INDEX idx_notes_readable     ON notes(owner_id, readable_id)     WHERE readable_id IS NOT NULL;
CREATE UNIQUE INDEX idx_calendars_readable ON calendars(owner_id, readable_id) WHERE readable_id IS NOT NULL;
CREATE UNIQUE INDEX idx_folders_readable   ON folders(owner_id, readable_id)   WHERE readable_id IS NOT NULL;

-- next sequence per (owner, entity_type); read-modify-write under the single sqlite connection
CREATE TABLE id_counters (
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,            -- task | project | event | note | calendar | folder
  next_seq    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (owner_id, entity_type)
);
