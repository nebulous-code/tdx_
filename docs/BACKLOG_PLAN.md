# tdx_ Backlog — Implementation Plan

Reconciled against the **tdx** project tasks (`p_146`) in the live DB (DB = source of truth).
Completed/checked work is cleared out; only open items remain below. I did **not** touch the DB
(read-only query of `data/tdx.db`). Current: **25 done / 12 open**.

## DISCREPENCIES

A lot shipped since last time. **Checked & verified real this round:** t_274 (GH Action), t_314
(PWA icon), t_316 (mobile layout), t_318 (add-hint), t_323 (project-dropdown order), t_328
(Shift-Enter→notes), t_332 (search `/`), t_351 (start-of-week), t_415 (reparent project), t_421
(sort config). Plus prior: t_148/153/157/160/164/214/221/228/236/242/278/286/292/325.

Three things to flag:

- **t_273 "Combine Labels" — DB says OPEN, but it's shipped on `main`** (commit a3267f2: the
  `LabelModal` "merge into…" picker + `store.mergeLabels`, with the can't-be-undone confirm; you
  confirmed "merging works well"). So it's effectively **done but unchecked** — just needs its box
  ticked in the app. Omitted from the open list below since no work remains.
- **t_314 (PWA icon): fully on `origin/main`** (commit `5cb85a4` — classic `apple-touch-icon` path,
  no web manifest, `?v=` cache-bust, root icon). Done and released.
- **t_316 (mobile layout): committed (`7573dee`) on local `main` and `mobile_layout`, but NOT pushed
  to `origin/main`** (local `main` is 1 commit ahead). Nothing's lost — a `git push origin main`
  lands it remotely and triggers the GHCR build. (Per your workflow I'm not pushing.)
- **t_432 "new defect" is a test task** (testing the #bug/#defect label merge) — disregard.

**New tasks since last sync:** t_422 (attachments) and t_450 (open-symbol shape) — added below.

One **partial** still correctly open: **t_239 "Task Creation Language"** — `#label` + `!N` priority
ship; due-date/recurrence quick-add keywords don't yet.

---

## Reusable building blocks (for any of the below)
- **`KbForm` mixin (`frontend/js/kbform.js`)** — keyboard framework. A screen declares `kbRows()`
  (input/button/grid/static) and the mixin owns cursor, `h/l` magic-column, `kfocus`, dirty-guard.
  Hooks: `kbSubmit`/`kbDirty`/`kbOnClose`/`kbTab`/`kbDelegate` + `kbAutoListen`/`kbAutofocus`. The
  Shift+S **sort config** (`sort-modal.js`) is the latest example (move-mode via `kbDelegate`).
- **Per-user prefs** (`theme`, `week_start`): pattern = migration adds a `users` column → `auth.js`
  SELECT + `routes/auth.js` `publicUser`/validate/UPDATE → `account-screen.js` control →
  `index.html` applies on login. **Sort prefs** use the same path but store JSON (`users.sort_prefs`,
  `store.normalizeSortPrefs`/`applySortPrefs`).
- **Search** (`/`): `store.searchRoots()` runs the `query.js` `text` matcher over all tasks (ignores
  the view), feeding `visibleRoots`/`visibleRows`; `store.searchActive`/`searchTerm`; `store.setView`
  clears it. Design: `docs/SEARCH_PLAN.md`.
- **Projects:** `store.projectTree()` (tree-ordered, depth-tagged), `store.reparentProject`,
  `store.childProjects`/`projectById`. **Labels:** `store.mergeLabels(fromId,toId)`.
- App-styled dialogs `store.askConfirm`/`askPrompt` (never native). Edit modals in `modals.js`.
- **Persistence:** snapshot auto-saves `tasks/projects/labels/savedQueries`; a new column needs a
  migration + `state.js` read/write (+ `ORDER BY position`). The snapshot stores JSON-able data only —
  **binary attachments (t_422) need a new storage mechanism** (no blob store today).
- **Schema authority / sharing groundwork:** `docs/SHARED_SCHEMA_PLAN.md` (backend validation is the
  prerequisite for a 2nd frontend and t_320).
- **Mobile:** layout stacks at `≤860px` (`minmax(0,1fr)` so the column can't blow out; sidebar→overlay);
  the detail drawer goes full-screen at `≤1024px` (both phone orientations); global `overflow-x:hidden`.
- **PWA icon:** classic `apple-touch-icon` path (no web manifest — iOS web-app mode mis-loaded it);
  copy served at the site root + `?v=` cache-bust.

---

## Open backlog

### Small / well-scoped
**t_450 — Open symbol a box, not a circle.** The open-status glyph in the task list (the `○`) should
be a box to match the aesthetic. Tiny CSS/markup change in the task row (`tasklist.js` / `styles.css`).

### Medium
**t_239 (remainder) — task-creation keywords.** Extend `parseQuickAdd` with a due-date shorthand
then recurrence; document each on the help "new task" tab. Keep "unparseable → left as text."

**t_254 — Duration estimate field.** Same shape as priority: column + `state.js`, a detail control,
optional row badge, a `dur:` query token, a sort field. Decide units (hours vs sizing).

**t_217 — Archive (soft-delete) projects.** `archived` flag on `projects` (migration + `state.js`);
archived projects leave the sidebar/queries; toggle from the project edit modal. No hard delete.

**t_288 — Pin a view to the header.** A `pinned` flag on `saved_queries`; render pinned views with
live counts in the topbar; rework the existing open/overdue counts as default-pinned system views.

**t_321 — Database backups.** Scheduled, WAL-aware copy of the SQLite file (checkpoint then copy,
with retention). Backend cron/script + a documented restore. Devops-flavored.

### Large / own spec
**t_422 — Add attachments to a task.** Attach files/images. **Needs a design first:** the backend is
a JSON snapshot with no binary storage — requires a file-store (disk volume or object storage), an
upload/download endpoint, per-user scoping, and a way to reference attachments from a task. Biggest
unknown of the open set.

**t_224 — Data export/import (CSV).** Idempotent upsert-by-name, per-project vs account-wide,
pre-import warnings, semicolon-separated labels. Own spec before coding.

**t_320 — Multi-account project sharing.** Share a project across users — ownership/permissions on
the multi-tenant model. Epic; prerequisite is backend schema validation (`docs/SHARED_SCHEMA_PLAN.md`).

### Epics / maybe-not
**t_246 — Kanban board.** Alternate project view; large, "probably not."

**t_249 — Template projects.** Project duplication + `{field}` placeholder prompting + a creation
workflow. Big lift; its own project.
