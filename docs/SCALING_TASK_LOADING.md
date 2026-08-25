# Scaling task loading (deferred perf work)

## Status

Deferred. This is "Milestone 2" of `docs/PERFORMANCE_PLAN.md`, parked after Milestone 1 (the memoization + parent/id index in `data.js`) fixed the felt keyboard lag. We chose to live with M1 first and revisit only if boot feels slow or the dataset keeps growing. This doc captures the full investigation so the work can be picked up cold.

## Problem

Boot ships every non-archived task, done included — prod (2026-08): 963 tasks (679 done / 284 open), ~520 KB bootstrap payload, ~250 completions/month accruing forever. Milestone 1 made the per-operation cost O(1)/O(n), so the interactive lag is gone; what remains is the one-time boot payload/parse, the count of reactive objects, and unbounded growth over years. This work bounds the *eager* load without losing history.

## Hard constraints (any solution must respect these)

### 1. The diff-sync delete landmine (critical — risk of data loss)

`frontend/js/sync.js` `diffType` (:77-85) derives changes by pure set-difference against the baseline `_lastSaved`: an id in the baseline but absent from the live snapshot becomes a **DELETE** (a real `DELETE /api/tasks/:id`, `index.html:1110/1242`); an id present but not in the baseline becomes a **CREATE**. There is no `done`/`archived` guard. The load-bearing invariant (`index.html:1106` comment): tasks only ever leave `store.tasks` via the server-side archive cascade, never client-side.

Implications for any lazy scheme:
- Booting open-only is safe by itself — the baseline is snapshotted from whatever `applyState` put in `store.tasks` (`index.html:1078`), so if bootstrap returns open-only, done ids are in neither snapshot and can't be diffed as deletes.
- Merging lazily-fetched done tasks INTO `store.tasks` must ALSO insert them into `_lastSaved.tasks`, wrapped in the existing `_suppress` window (`index.html:1071-1080`) — otherwise the next `persist()` sees them as CREATEs and re-POSTs existing ids (collision/duplicate).
- A loaded task must NEVER be evicted from `store.tasks` while its id remains in `_lastSaved` — that emits a DELETE and destroys it server-side.
- Session-completed tasks are already safe: `toggleDone`/`cascadeDone`/`cloneSubtree` flip/append in place and never remove, so a task completed this session stays a legitimate loaded row (an update, never a delete).

### 2. `archived` is permanent — rules out auto-archive

`archived=1` is a one-way soft-delete. There is no un-archive, no restore, no archived-list route, and no permanent-delete for tasks anywhere on the server. Archived tasks are excluded from bootstrap, from `POST /api/query` (its task source `readBootstrap` filters `archived=0`, `unifiedQuery.ts:115`), and from link resolution (`links.ts:88`). So auto-archiving old completed tasks permanently hides them — wrong for "what did I get done" retrospectives. Not an option unless a restore/archived-view path is built first.

### 3. `readBootstrap` is shared with the query engine

`server/src/services/bootstrap.ts` `readBootstrap(db, owner)` (task read at :33-40, `archived=0`, no `done` filter, no limit) is ALSO the task source for `unifiedQuery.ts:115`. A done-exclusion for boot must be a SEPARATE filtered variant/param, leaving the query engine's full set intact — otherwise `status:done` queries break server-side too.

### 4. `POST /api/query` already lazy-loads done

`POST /api/query` with `status:done` returns done tasks today (the `done` predicate, `server/src/query.ts:272`), as long as they stay `archived=0`. This is the ready-made lazy-fetch endpoint — no new read route needed. Full-text search already runs server-side through it (`data.js` `runSearch`), so search over completed tasks does not regress under any option.

## "Assumes full task set" break points (frontend), ranked

What a full lazy-load must handle; a recent-window approach only regresses the older-than-window slice of these.

- CRITICAL: the sync delete/create landmine (constraint 1).
- HIGH: "show completed" (`completion.done` toggle, keybind `c` at `index.html:762`, `completionPass` `data.js:405`, `visibleRoots`) shows nothing if done isn't loaded; `status:done`/`is:done` views come up empty.
- MEDIUM: `doneCount` badge (`tasklist.js:147`) reads 0; done-view nav badges (`queryCount`) undercount; wikilinks to done tasks (`resolveLink` `data.js:392`) render as plain text; a done parent of an open task resolves null (`task-detail.js:147`); the subtask done/total ratio undercounts (`tasklist.js:50`).
- LOW: the `[[` link pickers omit done tasks (`linked-items.js:33`, `notes.js:531`).
- SAFE (unaffected): `projectCount` (open-only), project health signals (open roots), full-text search (server-side).

## Options

### A. Recent-completed window — recommended (low-risk, server-only)

Bootstrap ships open tasks plus done tasks whose `completed_at` is within N days; older completed rows stay in the DB (findable via `POST /api/query` full-text search) but are not eager-loaded. Implement as a filtered bootstrap variant — do NOT change the shared `readBootstrap`. No client change is required (it just receives fewer tasks; the sync baseline stays self-consistent because `applyState` re-snapshots whatever it received). Add migration 015 with an index on `(owner_id, done, completed_at)` for the filter.

- Bounds the boot payload and keeps it bounded regardless of DB size, with no data loss and no permanent hide.
- Regression: the in-app "show completed" toggle and done-saved-views show only the last-N-days window; older completed reachable via search; wikilinks to older-than-window done tasks render as plain text.
- Window: a balanced default is ~30 days (≈40% payload cut at prod scale: 963 → ~580). Shorter = smaller payload but less in-app completed history (14d ≈ ~420 tasks; 60d ≈ ~780).

### B. Full lazy-load done — higher value, higher risk

Boot open-only; when a view needs completed (the `completion.done` toggle flips on, or a `status:done`/`is:done` query opens), fetch via `POST /api/query` (the view's query + `status:done`) and MERGE the results into `store.tasks` AND `_lastSaved` under `_suppress`; never evict. Because Milestone 1's derivations are computeds over `store.tasks`, they "just work" once done tasks are merged — no per-derivation rewrite. All completed history stays accessible in-app.

- The one risky place is the merge function (it must maintain `_lastSaved` correctly per constraint 1). Accepted minor regressions until a fetch happens: done-view nav badge counts and done-task wikilinks lazy-populate.
- Mirror the existing lazy patterns: `store.fetchNotes`/`fetchEventList` (`index.html:1411/1473`), which already keep notes/events out of the diff-sync on purpose.
- Rejected sub-design: keeping done in a SEPARATE cache (like `eventCache`) structurally avoids the sync path but forces every derivation (`visibleRoots`/`queryCount`/`resolveLink`/`subtasks`) to consult the cache, undoing M1's clean `store.tasks`-based computeds. Merge-into-store + never-evict is simpler given M1.

### C. Auto-archive old completed — NOT recommended

Permanent hide (constraint 2). Only viable if a restore/archived-view path is built first, and even then it removes history from the eager app. Prefer A/B, which preserve everything.

## Recommendation

Start with A (recent-completed window): most of the boot-payload win, a small server-only change, no data loss. Move to B only if the full completed history must live inside the "show completed" toggle rather than via search. Never C without a restore path.

## Implementation pointers (for pickup)

- Server (A): a filtered bootstrap variant in `bootstrap.ts` (keep `readBootstrap` intact for `unifiedQuery.ts:115`); route `GET /api/bootstrap` (`routes/bootstrap.ts`); confirm `TaskSchema` carries `done`/`completedAt` so they survive serialization; migration `015_*` for the `(owner_id, done, completed_at)` index.
- Client (B): a `store.fetchDone(query)` mirroring `fetchNotes`/`fetchEventList`; merge under `_suppress` while updating `_lastSaved` (`index.html:1071-1080`); trigger from `toggleCompletion` (`data.js:406`) and on opening a `status:done` view; a `resolveLink` fallback for done tasks.
- Verify with the Milestone-0 perf harness (`tools/perf_bench.sh`) plus a new bootstrap-payload budget, a server bootstrap-composition test (asserts done-exclusion AND that a task completed this session still round-trips through sync with no false delete/create), and a browser probe of the "show completed" flow.

## Prod scale reference (2026-08)

963 tasks (679 done / 284 open), 520 KB bootstrap, ~250 completions/month, 101 notes, 35 projects, 67 labels.
