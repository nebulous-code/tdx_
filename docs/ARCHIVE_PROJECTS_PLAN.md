# Archive Projects — Design Doc (t_217)

> Status: **proposal for review.** No code written yet.

## Intent (from the backlog)
> "I want to be able to **soft delete** projects which will make all tasks inside the project be
> hidden/soft-deleted. These tasks should **not** show up in the views. At this time I do **not** want
> to implement a hard delete."

So: archiving a project takes it (and everything under it) out of sight everywhere — sidebar, views,
search, counts, pickers — without deleting anything. It must be reversible (unarchive), since there's
no hard delete.

## Why this is mostly a one-flag, mostly-frontend feature
Persistence is a full client snapshot (`state.js writeState` re-inserts everything from the store), so
the only thing that needs backend work is **one new persisted column** on `projects`. Once that column
round-trips, "archived" is enforced entirely by filtering in the existing frontend choke points.

## Data model
- **Migration `011_project_archived.sql`:** `ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;`
- **`backend/src/state.js`:** add `archived` to the projects SELECT (`archived: !!p.archived`) and to the
  INSERT column list + `forEach` (the write path is explicit-columns, so an unlisted field is dropped —
  same gotcha we hit with `pinned`).
- **`frontend/js/data.js`:** default project objects get `archived:false`. `db.js seedUserDefaults`
  needs no change (inbox seeds unarchived by the column default).

## "Effective archive" — cascade without mutating children
A project is **effectively archived** if it *or any ancestor* is archived. Compute it; don't stamp the
flag onto descendants. Benefits: archiving a parent hides its whole subtree, and **unarchiving the
parent restores exactly what was visible before** — no bookkeeping about which children were already
archived independently.

- Add `store.isArchived(projectId)` — walk `parentId` up; true if self or any ancestor has `archived`.
- One direct toggle: `store.archiveProject(p)` / `unarchiveProject(p)` flips only that project's flag.

## What "hidden" means — the filter points
All driven through existing functions, so behavior stays consistent across list, nav, counts, search:

1. **Sidebar tree** (`sidebar.js` / `store.projectTree`): exclude effectively-archived projects from the
   normal "projects" section.
2. **Task visibility** (`store.visibleRoots` + `store.searchRoots`, `data.js`): drop tasks whose project
   is effectively archived. This is the key line — it covers every view, the query engine results,
   search, and the empty state in one place.
3. **Counts** (`store.projectCount`, `store.queryCount`, label counts): archived projects' tasks fall
   out automatically once #2 filters them (verify pinned-view/header counts too).
4. **Project pickers** (task-detail project `<select>`, quick-add target, move-to-project): hide
   archived projects so you can't file new work into a hidden project.

## Reaching archived projects again (restore UX)
Since there's no hard delete, archived projects need a home you can get back to:
- A collapsible **"archived" section** at the bottom of the sidebar (reuses the `navSections` collapse
  pattern), listing effectively-archived top-level projects with an **unarchive** action (`✕`-style or a
  context action). Hidden when empty.
- Selecting an archived project opens a read-only-ish view of its tasks (so you can confirm before
  unarchiving). Optional; simplest is just unarchive-in-place.

## Trigger (how you archive)
- **`ProjectModal` (edit mode):** an **"Archive"** button next to delete-style actions, with an
  `askConfirm` ("Archive 'X'? Its tasks will be hidden until you unarchive it."). The modal already
  carries the project; add an `archived` toggle / button + a `kbRows` entry so it's keyboard-reachable.
- Optional later: a sidebar shortcut on the focused project (mirrors the view `p`-to-pin pattern).

## Open decisions (need your call)
1. **Subprojects of an archived parent:** confirm cascade-by-ancestor (recommended) vs. archive only the
   single project and leave children visible (orphans). Recommendation: cascade.
2. **Active-view safety:** if you archive the project you're currently viewing, where do you land?
   Recommendation: fall back to the top pinned view (e.g. "today"/"open").
3. **Archived section placement:** dedicated collapsible sidebar section (recommended) vs. an entry on
   the account screen vs. a `is:archived` query token only.
4. **Should archived tasks still be searchable** by `/`? Your note says hidden from views; recommend
   hidden from search too (consistent), with unarchive as the only way back.

## Out of scope
Hard delete (explicitly not wanted); per-task archive (this is project-level); exporting archived
projects (Import/Export doc decides whether archived data is included).

## Verification
- Migration applies at boot (validate against a copy of the DB first, like `010`).
- Archive a project → it and its subtree vanish from sidebar, all views, search, counts, and pickers;
  the DB still holds the rows. Unarchive → everything returns in place.
- Archiving a parent hides children; unarchiving the parent restores them (no child left wrongly hidden).
- Round-trips through reload + a subsequent autosave (proves `archived` survives the delete-and-reinsert
  write path).
