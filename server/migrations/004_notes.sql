-- 004_notes.sql — the `note` domain (D2 §4). Note CONTENT lives as raw .md files
-- on disk (the vault); these tables are a rebuildable SHADOW index. Identity is a
-- machine-managed frontmatter UID, so a rename in nvim/Obsidian keeps the id (and
-- its links). Deletions are only noticed by a scan → the row is TOMBSTONED, not
-- hard-deleted. FTS5 is a derived keyword index, refreshed on every scanFile.

CREATE TABLE notes (
  id          TEXT PRIMARY KEY,                  -- UUID = the file's frontmatter id
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,                     -- relative to the vault root; mutable (rename)
  title       TEXT NOT NULL,
  mtime       TEXT NOT NULL,                     -- file mtime ISO; drives incremental scan
  frontmatter TEXT,                              -- JSON of extra frontmatter keys (nullable)
  tombstoned  INTEGER NOT NULL DEFAULT 0,        -- 1 = file gone (kept so links can reconcile)
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_notes_owner ON notes(owner_id);
-- a live note owns its path uniquely; tombstoned rows are exempt (path may be reused)
CREATE UNIQUE INDEX idx_notes_path ON notes(owner_id, path) WHERE tombstoned = 0;

-- file-derived edges: the cache of [[wikilinks]]/embeds written IN the markdown.
-- Distinct from 2b's app-asserted `links` table — these are directional (the file
-- declares them) and reconciled wholesale per origin note on each scan.
CREATE TABLE note_links (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  origin_note_id TEXT NOT NULL,                  -- the note whose file declares this edge
  target_type    TEXT NOT NULL,                  -- 'task' | 'event' | 'note'
  target_id      TEXT NOT NULL,
  rel            TEXT NOT NULL,                  -- mechanical pair-name: note-task | event-note | note-note
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_note_links_origin ON note_links(owner_id, origin_note_id);
CREATE INDEX idx_note_links_target ON note_links(owner_id, target_type, target_id);

-- derived FTS keyword index (one row per note); rebuilt from file content on scan.
CREATE VIRTUAL TABLE notes_fts USING fts5(
  note_id UNINDEXED,
  owner_id UNINDEXED,
  title,
  body,
  tokenize = 'porter'
);
