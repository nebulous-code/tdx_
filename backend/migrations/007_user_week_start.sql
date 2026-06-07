-- 007_user_week_start.sql — per-user start of week (0=Sun, 1=Mon, … 6=Sat).
-- Defaults to 1 (Monday) so existing weekday-window filters (due:mwf, due:su, …)
-- keep their current behavior.
ALTER TABLE users ADD COLUMN week_start INTEGER NOT NULL DEFAULT 1;
