# tdx_ Backlog — Implementation Plan

Reconciled against the **tdx** project tasks (`p_146`) in the live DB (DB = source of truth).
Completed/checked work is cleared out; only open items remain below. I did **not** touch the DB
(read-only query of `data/tdx.db`).

## DISCREPENCIES

This round reflects the keyboard-framework work landing. Three deltas vs. the last reconciliation:

- **t_278 "Unified keyboard-form framework" is now checked & shipped.** P1 (the `KbForm` mixin +
  the 3 edit modals + account screen + task-detail drawer), P2 (help modal + filter builder), and
  the task-detail **recurrence builder** are all keyboard-navigable now. The **sidebar (P3) was
  intentionally left bespoke** (tree `h/l` semantics + move-mode don't fit a rows model) — that was
  a conscious decision, not an unfinished slice, and there is no separate sidebar task. Design +
  decisions: `docs/KEYBOARD_FRAMEWORK.md` (status: built). So t_278 being checked is correct.
- **t_325 "Land on Top View" is now checked & shipped.** On load the app defaults the active view
  to the top saved query (`hydrate()` in `index.html` → `store.openQueryView(savedQueries[0])`),
  not the hardcoded "Today." Closes the deferred half of t_157.
- **NEW: t_415 "Editing a project should let you change its parent"** exists in the DB (open, p4) but
  wasn't in the prior plan. Added under *Small / well-scoped* below.

No contradictions found (nothing checked-but-unbuilt, nothing open-but-already-shipped).

Checked & verified real: **t_148, t_153, t_157, t_160, t_164, t_214, t_221, t_228, t_236, t_242,
t_278, t_286, t_292, t_325**. (t_153's keyboard-nav remainder was folded into t_278, now also done.)

One **partial** worth noting (not a discrepancy — correctly still open): **t_239 "Task Creation
Language"** — `#label` and `!N` priority ship and are on the help screen; due-date/recurrence
keywords don't yet.

---

## Reusable building blocks (for any of the below)
- **`KbForm` mixin (`frontend/js/kbform.js`)** — the shipped keyboard framework. A screen declares
  `kbRows()` (input/button/grid/static rows) and the mixin owns the cursor, `h/l` magic-column,
  `kfocus` highlight, and dirty-guard. Hooks: `kbSubmit`/`kbDirty`/`kbOnClose`/`kbTab`/`kbDelegate`
  + `kbAutoListen`/`kbAutofocus`. Use it for any new modal/screen instead of hand-rolling keys.
- App-styled dialogs: `store.askConfirm(msg)` / `store.askPrompt(label)` (Promise-based, in
  `index.html`) — never native `confirm()`/`prompt()`.
- Edit modals with color+glyph pickers: `ProjectModal` / `SaveQueryModal` / `LabelModal` in `modals.js`.
- Snapshot persistence is automatic for `tasks/projects/labels/savedQueries` fields; a new column
  needs a migration + `state.js` read/write (+ `ORDER BY position` for ordered tables) — see how
  `priority`/`position`/`theme` were added.
- Quick-add parsing (`#label`, `!N` priority) lives in `tasklist.js` `parseQuickAdd`; field defaults
  from the active view in `data.js` `viewDefaults`. Project tree helpers: `store.childProjects(id)`,
  `store.projectById(id)`, `store.openProjectView(p)`.
- Sidebar keyboard nav stays bespoke: `index.html` `sidebarKey(e)` + `store.sideItems()`.

---

## Open backlog

### Small / well-scoped
> A batch plan for knocking several of these out together lives in `docs/SMALL_TASKS_PLAN.md`.

**t_318 — Add-hint copy.** Update the quick-add placeholder in `tasklist.js` `addPlaceholder` to
show the label + priority syntax (e.g. `try: Call Mom #fun !5`). One-liner.

**t_323 — Project dropdown order in task detail (bug).** The detail's project `<select>`
(`task-detail.js`, iterates `store.projects` in position order) scatters subprojects away from
their parents. Fix: order the options as a tree (parent then children) or alphabetically, reusing
`indent(p)`.

**t_415 — Change a project's parent when editing.** `ProjectModal` (`modals.js`) has no parent
picker. Add a parent `<select>` (tree-ordered; exclude the project itself and its descendants to
avoid cycles) + a `data.js` reparent that sets `parentId` (and drops `position` to the end of the
new sibling group). `parentId` already round-trips through the snapshot.

**t_328 — Shift-Enter on create → notes.** In the quick-add (`tasklist.js`), make `Shift+Enter`
create the task **and** open its detail focused in the notes field (instead of staying in the add
box). Split the `@keydown.enter` handler into `.exact` vs `.shift`.

**t_273 — Combine (merge) labels.** Extend the label edit flow with a "merge into…" picker + the
styled *"can't be undone"* confirm; reassign every task's folded label id → target, drop the folded
label. Client-side (`modals.js` `LabelModal`, a `data.js` `mergeLabels` helper).

**t_274 — GH Action: build & push Docker image.** `.github/workflows/docker.yml` → build from repo
root + `backend/Dockerfile`, push to GHCR on `main`; host `compose.yaml` references the image and
Watchtower auto-pulls. No app code.

**t_351 — Start-of-week as a user setting.** Add a `week_start` per-user pref (column +
`state.js`/account-screen control, like `theme`) and pass it into `query.js` `dueWindow(…, weekStart)`
(already parameterized). Unblocks non-Monday weekday filters.

### Medium

**t_239 (remainder) — task-creation keywords.** Extend `parseQuickAdd` with a due-date shorthand
(`^fri`/`^tomorrow`/`^2026-06-10`) then recurrence; document each on the help "new task" tab. Keep
"unparseable → left as text."

**t_254 — Duration estimate field.** Same shape as priority: column + `state.js`, a detail control,
optional row badge, a `dur:` query token, a sort field. Decide units (hours vs sizing).

**t_217 — Archive (soft-delete) projects.** `archived` flag on `projects` (migration + `state.js`);
archived projects leave the sidebar/queries (`query.js`/`visibleRoots` guard); toggle from the
project edit modal. No hard delete.

**t_288 — Pin a view to the header.** A `pinned` flag on `saved_queries`; render pinned views
lowercase with live counts in the topbar; rework the existing open/overdue counts as default-pinned
system views.

**t_332 — Search tasks (`/`).** A text search distinct from filtering — a search field in the bottom
bar (vim-style `/`) matching title/notes substrings. (Note: `/` currently focuses the query bar;
reconcile that.)

**t_314 — PWA favicon (bug).** App icon/favicon not showing — check `manifest.webmanifest` icon
paths + `apple-touch-icon`/`<link rel=icon>` in `index.html`. Likely small once diagnosed.

**t_321 — Database backups.** Scheduled, WAL-aware copy of the SQLite file (checkpoint then copy,
with retention). Backend cron/script + a documented restore. Devops-flavored.

### Large / own spec

**t_224 — Data export/import (CSV).** Idempotent upsert-by-name, per-project vs account-wide,
pre-import warnings, semicolon-separated labels. Own spec before coding.

**t_320 — Multi-account project sharing.** Share a project across users — touches the multi-tenant
model (ownership, per-user vs shared rows, permissions). Epic; needs a design pass.

### Epics / maybe-not

**t_316 — Make mobile nav better.** Responsive overhaul of the nav/layout for small screens. Broad.

**t_246 — Kanban board.** Alternate project view; large, "probably not."

**t_249 — Template projects.** Project duplication + `{field}` placeholder prompting + a creation
workflow. Big lift; suits the workflow but is its own project.
