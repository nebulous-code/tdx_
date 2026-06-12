-- 015_project_health.sql — per-project health-check config. Stores a JSON array of
-- the enabled check keys (e.g. ["no-due","no-notes"]); [] = health off for the project.
-- Each project chooses which completeness gaps to flag (no due / tag / priority / size /
-- notes, plus overdue), configured in the project editor.
ALTER TABLE projects ADD COLUMN health TEXT NOT NULL DEFAULT '[]';
