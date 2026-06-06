-- 005_order_position.sql — explicit display order for projects + saved views.
--
-- With the composite PRIMARY KEY (user_id, id), a `WHERE user_id = ?` read uses
-- the PK index and returns rows in id order, NOT insertion/array order — so
-- reordering (move mode) was saved but always read back sorted by id. A position
-- column read with ORDER BY fixes that; state.js stamps position = array index on
-- every write, so the client's order round-trips.
ALTER TABLE projects      ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE saved_queries ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

-- Seed a deterministic starting order from current insertion (rowid) order.
UPDATE projects      SET position = rowid;
UPDATE saved_queries SET position = rowid;
