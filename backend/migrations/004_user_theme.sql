-- 004_user_theme.sql — per-user UI color theme (one of the preset palettes).
-- Nullable; the client treats NULL as the default 'amber' theme.
ALTER TABLE users ADD COLUMN theme TEXT;
