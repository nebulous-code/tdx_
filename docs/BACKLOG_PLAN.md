# tdx_ Backlog — Implementation Plan

Reconciled against the **tdx** project tasks (`p_146`) in the live **prod** DB
(`~/docker/tdx/data/tdx.db`, read-only query — DB is the source of truth).
Current: **38 done / 20 open**.

## Deploy state
Everything checked done is merged to **main**. The most recent batch — pinned views (t_288),
the search/filter/recurrence quality-of-life set (search-by-id, "no tag", mobile search,
recurring due-date inference, sub-sub `h` nav, blinking caret, recurring-subtask regen),
open-symbol box (t_450), and the dev→prod migration (t_524) — is on main but **not yet on prod**;
it deploys on the next 4 AM Watchtower run (Watchtower is daily-4 AM, monitor-only globally, with
tdx opted into auto-update via a per-container label). Manual deploy if impatient:
`cd ~/docker/tdx && docker compose pull tdx && docker compose up -d tdx`.

## Reconcile notes (this round)
- **Cleared from the open list (now done):** t_288 (pin view → header), t_321 (database backups),
  t_239 (task-creation language — `#label`/`!N`; due/recurrence keywords were never built and are
  **not** tracked separately, fold into t_549's polish or reopen if you still want them), t_450
  (open symbol → box).
- **Nine new issues since last sync:** t_590, t_621, t_653, t_681, t_747, t_777, t_778, t_793, t_796
  (most are bugs / small features — see below).
- **Five picked for the next small batch** → `docs/SMALL_BATCH_PLAN.md` (with the user's scope decisions):
  t_577, t_777, t_778, t_581, t_796.
- t_246 (Kanban) stays parked — your note still says "probably not."

## Three epics now have their own design docs (for your review)
- **t_217 Archive Projects** → `docs/ARCHIVE_PROJECTS_PLAN.md`
- **t_224 Data Import/Export** → `docs/DATA_IMPORT_EXPORT_PLAN.md`
- **t_249 Template / Duplicate Projects** → `docs/TEMPLATE_PROJECTS_PLAN.md`

---

## Reusable building blocks (for any of the below)
- **Snapshot persistence is the superpower.** `state.js writeState` deletes & re-inserts the whole
  per-user dataset from one client snapshot (`tasks/projects/labels/savedQueries`). So most features
  are **pure client-side**: mutate the reactive store → the 300 ms autosave persists it. A feature only
  needs backend work when it (a) adds a **persisted column** (migration + `state.js` read/write +
  frontend default + `db.js seedUserDefaults`), or (b) needs **binary/blob storage** (attachments) or
  a **server endpoint** the snapshot can't carry.
- **`KbForm` mixin (`frontend/js/kbform.js`)** — keyboard framework. Declare `kbRows()`
  (input/button/grid/static); the mixin owns cursor, `h/l` magic-column, `kfocus`, dirty-guard.
  Used by every modal + the recurrence sub-pane (nested via `kbDelegate`).
- **Projects:** `projects` table (`id, parent_id, name, color, glyph, collapsed, position`);
  `store.projectTree()` (tree-ordered, depth-tagged), `childProjects`, `projectById`, `reparentProject`.
- **Tasks:** `tasks` table (`id, project_id, parent_id, title, done, due, reminder, recurrence, notes,
  priority, created_at, completed_at`); subtasks via `parent_id`; `store.subtasks(id)`.
- **Labels:** `labels` + `task_labels` join; `store.addLabel`, `store.mergeLabels`. `COLORS`/`GLYPHS`
  palettes live on the store (used by the random color/icon need in import/templates).
- **Query/visibility:** `query.js` (`Q.run`) + `store.visibleRoots()` is the single choke point for the
  list, `j/k` nav, counts, and the empty state — branch it once and everything follows (how search and
  pinned-views hooked in).
- App-styled dialogs `store.askConfirm`/`askPrompt` (never native). Edit modals in `modals.js`
  (`ProjectModal`, `LabelModal`, `SaveQueryModal`). Account-wide actions on `account-screen.js`.

---

## Open backlog

> **Next small batch (scoped + decided):** t_577, t_777, t_778, t_581, t_796 → `docs/SMALL_BATCH_PLAN.md`.
> Marked ★ below.

### Bugs
**★ t_577 — `a`/`A` in the nav always creates a *project*.** In the sidebar, `a`/`A` should add the
*kind* under the cursor — a view in the views section, a project in projects, a label in labels —
not always a project. Route by the focused section in `sidebarKey`. *(In the batch.)*

**★ t_777 — no "delete label" option.** Labels only support rename + merge. Add a standalone delete that
**strips the tag from every task (tasks stay)** behind a count-aware confirm — `LabelModal` button +
`store.deleteLabel` + `x`-on-focused-label. *(In the batch.)*

**★ t_778 — parent project view shows children's tasks.** A project view resolves to `project:<id>`, whose
resolver cascades into subprojects. Decision: **exact match everywhere** — view, counts, and the `project:`
token all stop cascading (`query.js resolveProjects`). *(In the batch.)*

**t_621 — rethink what the filter's "Status" option represents.** Suspicion that most Status concepts
(open/overdue/today) are already expressible via Due (`>0d`, etc.). Audit overlap between the Status and
Due builder sections; collapse/clarify so they don't duplicate. Design-y — decide the model before coding.

**t_653 — mobile top/bottom bars don't fit width.** The bottom (and top) bar should expand *vertically* to
fit the tag/pin names and size to the viewport width dynamically. CSS/flex-wrap on the bars; mobile.

**t_681 — swipe from the left edge opens the nav.** Add a left-edge touch swipe gesture to open the nav
drawer on mobile (mirror whatever closes it). Touch-event handler on the shell; no desktop impact.

### Small / well-scoped
**★ t_581 — nav helper buttons only on hover.** The `›` / `+` / `✕` affordances on sidebar rows should be
hidden until hover; the name shows full-width (ellipsing at the count) otherwise. Mostly CSS
(`.nav-item .add { opacity:0 }` → reveal on `:hover`/`.kfocus`/`.active`). Mobile: reveal on tap/select.
*(In the batch.)*

**★ t_796 — Shift+Enter on a list task jumps into Notes.** Reuse the existing `store.pendingNotesFocus`
path (quick-add already does this) from the list key handler. One branch on `e.shiftKey`. *(In the batch.)*

**t_580 — "system color" as a color option for projects & views.** Add the theme accent (`var(--amber)`)
as a selectable swatch in the color pickers (`ProjectModal`/`SaveQueryModal`), stored as a sentinel
(e.g. `color:'system'`) so it follows the active theme instead of a fixed hex.

**t_747 — tag autofill suggestion.** When typing `#` in the quick-add/task input, suggest existing labels
matching what follows — keeps tags consistent. Reuses `store.sortedLabels`; needs a small typeahead popover
+ keyboard accept. Verge of medium (new UI affordance) but self-contained.

**t_590 — pin labels like views.** Pin a label (★) into the header next to pinned views, showing its
tagged-task count; header order left→right = views │ labels. Builds directly on the just-shipped
pinned-views machinery (add a `pinned` flag to labels, same round-trip). Small-medium; natural follow-on.

### Medium
**t_549 — keyboard-scroll task-detail dropdowns + fix priority label.** In the task-detail drawer,
`j/k` should move through an open `<select>` (project/priority) like the arrows do (today only
arrows work after `i`). Also: priority isn't a real field header — it shares a line with status
separated by a dot; make it a proper header (shrink status below 25% if needed — eyeball first).

**t_793 — manual reorder of subtasks.** In the task list and the detail drawer's subtask list, reorder
subtasks with the same `m` → `j/k` → `esc` move workflow used for views/projects. Today they're
creation-ordered (fine as the default). Needs a persisted per-subtask `position` (same migration +
`state.js` round-trip pattern as other ordered rows) — so it's medium, not small.

**t_254 — Duration estimate field.** Same shape as priority: column + `state.js` read/write, a detail
control, optional row badge, a `dur:` query token, a sort field. **Decide units:** hours, number+unit,
or Fibonacci sizing.

### Large / own design doc
**t_217 — Archive (soft-delete) projects.** → `docs/ARCHIVE_PROJECTS_PLAN.md`.
**t_224 — Data export/import (CSV).** → `docs/DATA_IMPORT_EXPORT_PLAN.md`.
**t_249 — Template / duplicate projects.** → `docs/TEMPLATE_PROJECTS_PLAN.md`.

**t_422 — Add attachments to a task.** Attach/list/download files (no inline render); bind-mount the
store to a known host path; keyboard nav like recurrence (`i` in, `hjkl`, space). **Biggest unknown:**
the snapshot has no binary storage — needs a file volume + upload/download endpoints + per-user scoping
+ a task→attachment reference. Own design doc before coding (not written this round).

**t_320 — Multi-account project sharing.** Share a project across users; ownership/permissions on the
multi-tenant model. Epic; prerequisite is backend schema validation (`docs/SHARED_SCHEMA_PLAN.md`).

### Parked
**t_246 — Kanban board.** Alternate project view; large, "probably not" per your note.
