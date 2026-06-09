-- Pinned views: a saved view can be pinned to the top header (shows a live count).
-- Adds the `pinned` flag and converts the previously-hardcoded header "open"/"overdue"
-- counts into real, pinned-by-default system views.

ALTER TABLE saved_queries ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

-- pin the existing "overdue" system view for everyone
UPDATE saved_queries SET pinned = 1 WHERE id = 'sv_overdue';

-- give every user an "open" system view, pinned, ordered just before overdue.
-- Same position as overdue; the read sort is ORDER BY position, id, and
-- 'sv_open' < 'sv_overdue' lexically, so it lands first of the two.
INSERT INTO saved_queries (user_id, id, name, glyph, query, system, color, position, pinned)
SELECT o.user_id, 'sv_open', 'Open', '○', 'status:open', 1, NULL, o.position, 1
  FROM saved_queries o
 WHERE o.id = 'sv_overdue'
   AND NOT EXISTS (SELECT 1 FROM saved_queries x WHERE x.user_id = o.user_id AND x.id = 'sv_open');
