-- 013_archive.sql — soft delete ("Delete" in the UI, archive on disk).
--
-- Deleting a project or a task sets archived = 1 instead of removing the row, as a
-- recovery safety net (no in-app restore — the recovery query is WHERE archived = 1).
-- readState filters archived rows out (the client never sees them); writeState deletes
-- only live rows (archived = 0) before re-inserting the snapshot, so the routine save
-- can never touch archived data. A project delete cascades archived = 1 to its
-- subprojects + all their tasks; a task delete cascades to its subtasks.
ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks    ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
