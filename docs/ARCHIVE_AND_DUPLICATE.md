# Delete (soft-archive) + Duplicate Projects — Design Doc (t_217 / t_878, t_249 parked)

> Status: **proposal — all decisions locked, ready to turn into a build plan.** No code written yet. Folds in the former `ARCHIVE_PROJECTS_PLAN.md` (removed — its choke-point analysis is the appendix) and your `ARCHIVE_AND_DUPE_RESPONSE.md` answers. Long-term templates stay parked in `TEMPLATE_PROJECTS_PLAN.md`. Branch: `feat/archive_and_duplicate`.

Two features that ship together off the same project surface: **duplicate** a project to spin up a fresh working copy, and **delete** one when you're done.

## The naming convention (important)
- **To the user it's "Delete."** The data is presented as gone — no archive language, no restore button.
- **Under the hood it's a soft archive:** an `archived` flag; rows stay in the DB as a safety net against buggy hard deletes. There is **no in-app revival in this cut** — if you need it back you're in the DB, where the recovery query is literally `WHERE archived = 1`. *(An optional in-app restore screen is now tracked separately as **t_880** — see the Backlog.)*
- **README transparency:** document that "Delete" is a soft archive on disk (recovery safety net, no in-app restore), so it's honest, not a hidden surprise.

## Intent (backlog + conversation)
- **t_217:** *"soft delete projects … tasks inside should not show up in views … no hard delete."*
- Refinements you gave: soft delete only (peace of mind over lift); no revival UI / no archived section / not searchable; deleted project + everything under it simply disappears from views, filters, search, counts, pickers.
- **t_878 (duplicate):** covers the near-term "template" need.
- **t_249 (real templates):** mark-as-template + `{placeholder}` prompting — **parked**.

---

# Part A — Delete a project (soft-archive, server-protected)

## Architecture (locked): archived data never reaches the client
Since there's no in-app restore, archived rows live **server-side only**:
- **`readState` filters `archived` out** → the frontend store only ever holds *live* data.
- **`writeState` deletes only live rows** before re-inserting the snapshot → the routine autosave can **provably never touch** archived data (the safety net).
- **Deleting is an explicit server mutation** that sets the flag; the client then re-hydrates.

Payoff: the frontend needs essentially **no filtering changes**. Exploration found ~16 places an archived project could leak into (counts, search, pickers, query engine…); **none can leak what isn't in the store.** (The in-client-filter alternative that would need all 16 filters is kept in the appendix as the rejected road.)

## Data model
- **Migration `013_archive.sql`** (012 is latest): `ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;` `ALTER TABLE tasks    ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;` (Validate against a DB copy before boot; needs a backend restart to apply, like 012.)
- A task's `archived` is only ever set as part of deleting its project's subtree. Storing it on the row keeps `readState`/`writeState` symmetric (no project-join subqueries).

## Cascade (what gets archived together)
Deleting project **P** sets `archived = 1`, in one transaction, on:
1. **P** and **all descendant subprojects** (walk `parent_id`).
2. **every task** whose `project_id` is P or any descendant (subtasks included — same `project_id`).

## Backend — `backend/src/state.js`
- **`readState`:** add `WHERE archived = 0` to the projects SELECT and the tasks SELECT. (No `archived` field needs to surface in client objects.) Labels + saved_queries unchanged (still hard deletes).
- **`writeState`:** wipe **only live rows** for the soft-archive tables:
  - `DELETE FROM projects WHERE user_id = ? AND archived = 0`
  - `DELETE FROM tasks    WHERE user_id = ? AND archived = 0`
  - `task_labels`: delete only rows for live tasks (`… WHERE task_id IN (SELECT id FROM tasks WHERE user_id = ? AND archived = 0)`), so an archived task keeps its label links for a clean DB restore.
  - `labels`, `saved_queries`: unchanged (delete-all + reinsert — stay hard deletes).
  - Re-insert the snapshot as today (snapshot rows are live → `archived = 0`).

## The delete mutation (locked: small endpoint)
A soft delete **must** be an explicit mutation, not a client array-removal: the snapshot write would read a missing row as a hard delete (`archived = 0` → wiped → gone) and would **race** the debounced autosave. So:
- **Endpoint** `POST /api/projects/:id/delete` — server computes the subtree, runs the two `UPDATE … SET archived = 1` statements + bumps the state version, returns the fresh live state.
- **Client:** suppress autosave → call the endpoint → apply the returned state / re-hydrate (store drops the subtree) → if the open `store.view` was that project (or a descendant), redirect to the top pinned view.

## Frontend (locked: ✕ on the project row, labeled as Delete)
- **Trigger:** add an **✕** helper to each project's sidebar row in `sidebar.js`, mirroring the view/label delete ✕ (and the `x` shortcut). It emits `delete-project`; `index.html` confirms via `askConfirm` worded as a real delete — *"Delete 'X' and everything in it?"* (no recovery promise) — then calls the mutation + re-hydrate + view-redirect above.
- The `ProjectModal` Delete button is **repointed to the same mutation** (kept for parity).
- The old hard-delete `store.deleteProject` cascade is **removed**.
- Re-hydrated store has no archived subtree → all existing views/counts/pickers/search/nav are correct with no further changes.

## Task deletion is soft too (locked)
**Today** `store.deleteTask` and the detail-drawer subtask `✕` hard-delete (array splice → snapshot wipe). **Decision: fold task delete into the same `archived` machinery — a task and all its subtasks.**
- A task delete becomes a mutation `POST /api/tasks/:id/delete` that sets `archived = 1` on the task **and all descendant subtasks** in one transaction (+ version bump); the client suppresses autosave and re-hydrates. The round-trip is acceptable (your call).
- Applies to **both** task-delete entry points: the detail drawer's `del()` and the per-subtask `✕`.
- `tasks.archived` is already filtered on read / spared on write (added for the project cascade), so this adds only the endpoint + rewiring those two callers off `store.deleteTask`'s array splice.
- Recovery same as projects: `WHERE archived = 1`, DB-only.
- Note: the project-delete endpoint already archives a project's tasks server-side, so it doesn't call this; this endpoint is for deleting an individual task/subtree. Views + labels remain hard deletes.

---

# Part B — Duplicate a project (t_878)

## Architecture: pure client-side (no schema/backend work)
Mirrors task `duplicate()`, extended to a whole subtree. Deep-clone into the store with fresh ids; autosave persists (a create, not a delete — stays a normal snapshot write).

## `store.duplicateProject(p)`
- Recurse the subtree: **P + all subprojects** (`store.childProjects`) and **all their tasks + subtasks** (`store.subtasks`).
- Mint new ids (`uid('p')`/`uid('t')`); build an **old→new id map** so cloned `parentId` (tasks *and* subprojects) and `projectId` remap to the new ids — structure preserved exactly.
- Root copy name gets `" (copy)"`; lands under the **same parent** as the original.
- Preserve `color`, `glyph`, `position`, task `notes`, `labels`, `priority`, **`recurrence`**.
- **`done`/`completedAt` reset → open** *(locked — your preferred workflow)*.
- **`due`/`reminder` kept as-is** *(locked — overdue tasks become your "dates to update" worklist)*.
- Open the new project; autosave persists. Reuses `store.childProjects`, `store.subtasks`, `mk()`, `uid()`, `addProject`/`addTask`.

Note: task `duplicate()` does *not* copy subtasks; project duplication intentionally does a **full deep clone** (subprojects + subtasks).

## Trigger
A **"Duplicate"** action in `ProjectModal` (edit mode), beside Delete. (Command-palette entry optional later.)

---

## Build order
1. **Duplicate** first — pure frontend, no migration, immediately useful, low risk.
2. **Delete (soft-archive)** second — migration 013 + `state.js` read/write + the two delete endpoints (`/projects/:id/delete` cascading to its tasks; `/tasks/:id/delete` cascading to subtasks) + the client re-hydrate flow (needs a one-time backend restart to apply 013, like t_590/t_793).

## Decisions locked ✅
- Server-protected architecture; deletes via **small endpoints**, not the snapshot.
- UX verb **"Delete"**; internal flag/column **`archived`**; recovery is `WHERE archived = 1`, DB-only.
- Project delete trigger is an **✕ on the sidebar project row** (mirrors views/labels), plus the ProjectModal button; cascades to subprojects + all their tasks.
- **Task delete is soft too** — task + all subtasks, via `/tasks/:id/delete` + re-hydrate; both the detail drawer `del()` and the subtask `✕`. Round-trip accepted.
- **No unarchive UI / no archived section / not searchable.** Views + labels stay hard deletes.
- Duplicate: reset cloned tasks to **open**; keep **due/reminder as-is**; keep recurrence; same parent, `" (copy)"` name.
- README documents the soft-archive reality.

## Out of scope (parked)
Template marking + `{placeholder}` prompting (t_249); a real hard-delete/purge tool; whether Import/Export includes archived rows (that doc decides).

## Verification
- **Migration 013** applies at boot (validate against a DB copy first); `archived` columns present.
- **Duplicate:** clone a multi-level project (subprojects + subtasks) → exact structure with new ids, original untouched, all tasks open, due dates preserved; reload confirms persistence.
- **Delete:** ✕ a project → it and its whole subtree vanish everywhere (sidebar, views, search, counts, pickers); rows remain with `archived = 1`; a manual `UPDATE … archived = 0` over the subtree brings them back on next load. Deleting the open project redirects to a safe view. Confirm the routine autosave **never** clears `archived` rows.
- **Task delete:** delete a task (detail `del()` or subtask `✕`) → it and its subtasks vanish from the UI, rows persist with `archived = 1`; no autosave race resurrects or hard-deletes them.

---

## Appendix — In-client-filter alternative (the rejected option)
*(Folded in from the former `ARCHIVE_PROJECTS_PLAN.md`. We chose server-protected; this is the lighter-but-leak-prone road not taken: archived rows stay in the client store with a flag — like `pinned` — and every surface filters them out.)*

**Data model (lighter):** `archived` on `projects` only; `state.js` reads/writes it in the projects SELECT/INSERT (explicit-columns gotcha — an unlisted field is dropped, same as `pinned`); frontend default `archived:false`. Tasks hidden by their project, not their own column.

**Effective archive (cascade without stamping children):** a project is *effectively archived* if it **or any ancestor** is archived — compute it (`store.isArchived(projectId)` walks `parentId` up); one toggle flips only that project's flag. Gives parent-hides-subtree cascade without per-child bookkeeping.

**Choke points that would all have to filter — the leak surface this option must cover:**
1. **Sidebar tree** — `sidebar.js roots`, `store.childProjects`, `store.projectTree`, `store.sideItems`.
2. **Task visibility** — `store.visibleRoots` + `store.searchRoots` (drop tasks whose project is effectively archived); covers every view, query-engine results, search, and the empty state in one place.
3. **Query engine** — `Q.run` (exclude archived-project tasks) and `resolveProjects` (exclude archived projects from `project:` matches), `query.js`.
4. **Counts** — `store.projectCount` (direct `store.tasks` iteration — must filter explicitly), `store.queryCount`, label/pinned-view/header counts (mostly inherited from #2).
5. **Project pickers** — task-detail project `<select>` (`projectTree`), quick-add target, query-bar project chips (direct `store.projects` map), command palette.
6. **`store.subtasks`** — exclude archived.
7. **View safety** — `store.openProjectView` guard/redirect; `store.currentQuery` for an archived project view.

The whole point of the chosen server-protected approach is that **none of the above is needed** — archived data never reaches the client, so there's nothing to filter and nothing to miss.
