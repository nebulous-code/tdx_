-- 009: "Inbox", not "inbox".
--
-- Every other categorizer a user sees is capitalized (their projects, folders and calendars are
-- named however they typed them, which is nearly always Title Case), so the one name the APP
-- picks should match. Two places said it in lowercase:
--   • the tasks Inbox project, seeded for every new user since 001
--   • the notes base directory name (008), whose default lands on existing rows
--
-- Renaming is safe for queries: the engine matches categorizer names through slug(), which
-- lowercases and strips non-alphanumerics — so `project:inbox` keeps finding it either way.
-- Only rows still holding the seeded default are touched; a user who renamed theirs keeps it.
UPDATE projects SET name = 'Inbox' WHERE name = 'inbox';
UPDATE users SET notes_root_name = 'Inbox' WHERE notes_root_name = 'inbox';
