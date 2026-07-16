-- 003_links.sql — the generic entity-link graph (D2 §3). One edge table connects
-- any typed entity to any other. Rels are MECHANICAL pair-names: the alphabetical
-- concept-pair (e.g. 'event-task'), one edge per pair, stored CANONICALLY — the
-- alphabetically-first type is always t1, the other always t2 — so there's no
-- (A,B)/(B,A) duplication. Meaning is per-screen presentation, not in the rel.
-- Only event-task is linkable now; notes (event-note, note-task) arrive in 2c.

CREATE TABLE links (
  id         TEXT PRIMARY KEY,                 -- UUID
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  t1_type    TEXT NOT NULL,                    -- alphabetically-first concept (e.g. 'event')
  t1_id      TEXT NOT NULL,
  t2_type    TEXT NOT NULL,                    -- alphabetically-second concept (e.g. 'task')
  t2_id      TEXT NOT NULL,
  rel        TEXT NOT NULL,                    -- canonical pair name, e.g. 'event-task'
  data       TEXT,                             -- optional JSON metadata (unused in 2b)
  created_at TEXT NOT NULL
);
-- one edge per pair (canonical ordering guarantees no A/B vs B/A dupes)
CREATE UNIQUE INDEX idx_links_pair ON links(owner_id, t1_type, t1_id, t2_type, t2_id);
-- "links touching entity X" resolves via two indexed lookups (X as t1, X as t2)
CREATE INDEX idx_links_t1 ON links(owner_id, t1_type, t1_id);
CREATE INDEX idx_links_t2 ON links(owner_id, t2_type, t2_id);
