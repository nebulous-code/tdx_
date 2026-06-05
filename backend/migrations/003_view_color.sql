-- 003_view_color.sql — give saved views an optional icon color (like projects).
-- Nullable: existing/system views with NULL color fall back to their default
-- glyph styling on the client.
ALTER TABLE saved_queries ADD COLUMN color TEXT;
