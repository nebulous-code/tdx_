-- 012_task_position.sql — explicit display order for tasks (manual subtask sort).
--
-- Like 005 did for projects + saved_queries: with the composite PRIMARY KEY
-- (user_id, id), a `WHERE user_id = ?` read returns rows in id order, not the
-- client's array order — so manually reordered subtasks would read back scrambled.
-- A position column read with ORDER BY fixes that; state.js stamps position = array
-- index on every write, so the client's order (and thus sibling/subtask order)
-- round-trips.
ALTER TABLE tasks ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

-- Seed a deterministic starting order from current insertion (rowid) order.
UPDATE tasks SET position = rowid;
