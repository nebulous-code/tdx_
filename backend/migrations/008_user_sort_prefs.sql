-- 008_user_sort_prefs.sql — per-user sort configuration, stored as JSON:
--   { "order": ["due","created",…], "enabled": {"due":true,…}, "dirs": {"due":"asc",…} }
-- Nullable; the client treats NULL as the built-in defaults.
ALTER TABLE users ADD COLUMN sort_prefs TEXT;
