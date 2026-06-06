-- 006_task_priority.sql — per-task priority (0 = none … 5 = very high).
ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
