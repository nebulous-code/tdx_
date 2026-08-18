-- 014: close orphaned open subtasks left behind before completion cascaded (t_0687).
--
-- Until this release, completing a parent left its children open; recurring parents (TJ
-- Inspection reports, laundry cycles) piled up ~28 open children of long-done parents,
-- throwing off open-task totals. Completion now cascades to the whole subtree; this is the
-- one-time backfill that closes the already-accrued orphans.
--
-- `under_done` is the transitive closure of "reachable from a done task by parent->child"
-- (done tasks plus every descendant of a done task). Closing every open task whose parent is
-- in that set closes orphans at ALL depths in one pass: the CTE is evaluated against the
-- pre-update state, so an open grandchild's parent is already in the set. Only done=0 rows
-- flip, so already-done rows keep their original completed_at, and a re-run is a no-op.
WITH RECURSIVE under_done(id) AS (
  SELECT id FROM tasks WHERE done = 1
  UNION
  SELECT t.id FROM tasks t JOIN under_done u ON t.parent_id = u.id
)
UPDATE tasks
   SET done = 1,
       completed_at = COALESCE(completed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
       updated_at   = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE done = 0
   AND parent_id IN (SELECT id FROM under_done);
