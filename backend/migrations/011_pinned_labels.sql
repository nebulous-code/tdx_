-- Pinned labels: a label can be pinned to the top header (next to pinned views),
-- showing a live count of its tagged tasks and opening that label's filter on click.
-- Mirrors the saved_queries `pinned` flag from 010. No seeding — labels are created
-- on demand, so every label starts unpinned via the column default.

ALTER TABLE labels ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
