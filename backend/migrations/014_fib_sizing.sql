-- 014_fib_sizing.sql — per-task Fibonacci "Size" estimate + the account preference
-- that gates it. size: 0 = none, otherwise one of 1/2/3/5/8/13 (13 ≈ "break this down").
-- fib_sizing: 0 = off (default), 1 = on; when off, the Size field/badge/sort are hidden
-- but stored sizes are retained.
ALTER TABLE tasks ADD COLUMN size       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN fib_sizing INTEGER NOT NULL DEFAULT 0;
