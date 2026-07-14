-- 010: make the glyph picker the SOURCE OF TRUTH (audit a.9).
--
-- `glyph` was an unvalidated TEXT column, so what the picker offered and what the database
-- accepted never had to agree. They didn't: a ♥ nobody could select sat on a seeded calendar,
-- and every system view (Today ☉, Open ○, Overdue !, …) wore an icon the picker never showed.
--
-- The list has now GROWN to cover what the app actually ships (40 glyphs — see
-- frontend/js/glyphs.js, parity-locked to server/src/glyphs.ts) and the request schemas
-- REJECT anything outside it. This migration makes the existing data legal, because the
-- validation is what breaks first: an off-list glyph on a row means the next edit of that row
-- — even just renaming it — comes back 400.
--
-- Two glyphs left the picker: ⌂ (the Inbox project) and ♥ (arbitrary). Everything else the app
-- shipped is now inside the list, so nothing else changes appearance.
--
-- NOTE this cannot reach a LEGACY IMPORT: migrations run against the empty target before
-- scripts/migrate-from-legacy.ts inserts a single row. The importer normalizes glyphs itself.
UPDATE projects SET glyph = '❯' WHERE glyph = '⌂';

-- Defensive normalization: any glyph outside the 40 becomes that entity's default. Rows can
-- hold anything today (no validation ever ran), so without this a stray glyph is a landmine
-- that only goes off when the user edits the row.
UPDATE projects      SET glyph = '●' WHERE glyph NOT IN ('❯','◆','▲','●','★','■','◈','⌘','⚙','§','¶','λ','Σ','∆','▒','☰','⎔','⊞','✦','⛁','♜','⌬','∴','▚','◇','✧','⊹','⌗','⟁','❖','☉','○','!','↻','∅','◫','»','✎','◉','▸');
UPDATE calendars     SET glyph = '●' WHERE glyph NOT IN ('❯','◆','▲','●','★','■','◈','⌘','⚙','§','¶','λ','Σ','∆','▒','☰','⎔','⊞','✦','⛁','♜','⌬','∴','▚','◇','✧','⊹','⌗','⟁','❖','☉','○','!','↻','∅','◫','»','✎','◉','▸');
UPDATE folders       SET glyph = '▸' WHERE glyph NOT IN ('❯','◆','▲','●','★','■','◈','⌘','⚙','§','¶','λ','Σ','∆','▒','☰','⎔','⊞','✦','⛁','♜','⌬','∴','▚','◇','✧','⊹','⌗','⟁','❖','☉','○','!','↻','∅','◫','»','✎','◉','▸');
UPDATE saved_queries SET glyph = '◆' WHERE glyph NOT IN ('❯','◆','▲','●','★','■','◈','⌘','⚙','§','¶','λ','Σ','∆','▒','☰','⎔','⊞','✦','⛁','♜','⌬','∴','▚','◇','✧','⊹','⌗','⟁','❖','☉','○','!','↻','∅','◫','»','✎','◉','▸');
