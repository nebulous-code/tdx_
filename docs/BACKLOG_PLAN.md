# tdx_ Backlog — Implementation Plan

Reconciled against the **tdx** project tasks in the live DB (DB = source of truth).
Completed/checked work is cleared out; only open items remain below. I did **not** touch the DB.

## DISCREPENCIES

**None this round.** Every checked task matches what's actually built, and the one prior
discrepancy is resolved:

- **t_157's deferred half is now its own task.** The "land the user in the top view" piece we
  deliberately skipped is tracked as **t_325 "Land on Top View"** (open, below). So t_157 being
  checked off is correct.
- **t_228 "Weekend Filter" is checked and shipped** (`due:su` / `due:mwf`, see
  `docs/WEEKEND_FILTER.md`).

Checked & verified real: **t_148, t_153, t_157, t_160, t_164, t_214, t_221, t_228, t_236,
t_242, t_286, t_292**. (t_153 was checked accepting the shipped slices; its full keyboard-nav
remainder lives in t_278.)

One **partial** worth noting (not a discrepancy — correctly still open): **t_239 "Task Creation
Language"** — `#label` and `!N` priority ship and are on the help screen; due-date/recurrence
keywords don't yet.

---

## Reusable building blocks (for any of the below)
- Sidebar keyboard nav: `index.html` `sidebarKey(e)` + `store.sideItems()` (`data.js`) + the `.nav-item.kfocus`/`.moving` highlights and inline `›`/`✕`/`+` affordances (`sidebar.js`).
- App-styled dialogs: `store.askConfirm(msg)` / `store.askPrompt(label)` (Promise-based, wired in `index.html`) — never native `confirm()`/`prompt()`.
- Edit modals with color+glyph pickers: `ProjectModal` / `SaveQueryModal` / `LabelModal` in `modals.js`.
- Snapshot persistence is automatic for `tasks/projects/labels/savedQueries` fields; a new column needs a migration + `state.js` read/write (+ `ORDER BY position` for ordered tables) — see how `priority`/`position`/`theme` were added.
- Quick-add parsing (`#label`, `!N` priority) lives in `tasklist.js` `parseQuickAdd`; field defaults from the active view in `data.js` `viewDefaults`.

---

## Open backlog

### Small / well-scoped

**t_318 — Add-hint copy.** Change the quick-add placeholder in `tasklist.js` `addPlaceholder`
to `try: Call Mom #fun !5` (shows the label + priority syntax). One-liner.

**t_323 — Project dropdown order in task detail (bug).** The detail's project `<select>`
(`task-detail.js`) iterates `store.projects` (position order), so subprojects can sit far from
their parents and look random. Fix: order that select sensibly — alphabetical, or tree order
(parent then its children, using the existing `indent(p)`).

**t_325 — Land on the top view.** On load (and as the active-view fallback), land on the
**first/top view** instead of the hardcoded "Today" (`index.html`, `data.js`, `modals.js`); if
zero views exist, fall back to an on-the-fly Today (or no filter). The deferred half of t_157.

**t_328 — Shift-Enter on create → notes.** In the quick-add (`tasklist.js` `commitAdd` /
keydown), make `Shift+Enter` create the task **and** open its detail focused in the notes
field (instead of staying in the add box for another task).

**t_273 — Combine (merge) labels.** Extend the label edit flow with a "merge into…" picker +
the styled *"can't be undone"* confirm; reassign every task's folded label id → target, drop
the folded label. Client-side (`modals.js` `LabelModal`, a `data.js` `mergeLabels` helper).

**t_274 — GH Action: build & push Docker image.** `.github/workflows/docker.yml` → build from
repo root + `backend/Dockerfile`, push to GHCR on `main`; host `compose.yaml` references the
image and Watchtower auto-pulls. No app code.

**t_351 — Start-of-week as a user setting.** Add a `week_start` per-user pref (column +
`state.js`/account-screen control, like `theme`) and pass it into `query.js` `dueWindow(…, weekStart)`
(already parameterized). Unblocks non-Monday weekday filters.

### Medium

**t_239 (remainder) — task-creation keywords.** Extend `parseQuickAdd` with a due-date
shorthand (`^fri`/`^tomorrow`/`^2026-06-10`) then recurrence; document each on the help "new
task" tab. Keep "unparseable → left as text."

**t_254 — Duration estimate field.** Same shape as priority: column + `state.js`, a detail
control, optional row badge, a `dur:` query token, a sort field. Decide units (hours vs sizing).

**t_217 — Archive (soft-delete) projects.** `archived` flag on `projects` (migration +
`state.js`); archived projects leave the sidebar/queries (`query.js`/`visibleRoots` guard);
toggle from the project edit modal. No hard delete.

**t_288 — Pin a view to the header.** A `pinned` flag on `saved_queries`; render pinned views
lowercase with live counts in the topbar; rework the existing open/overdue counts as
default-pinned system views.

**t_332 — Search tasks (`/`).** A text search distinct from filtering — a search field in the
bottom bar (vim-style `/`) matching title/notes substrings. (Note: `/` currently focuses the
query bar; reconcile that.)

**t_314 — PWA favicon (bug).** App icon/favicon not showing — check `manifest.webmanifest`
icon paths + `apple-touch-icon`/`<link rel=icon>` in `index.html`. Likely small once diagnosed.

**t_321 — Database backups.** Scheduled, WAL-aware copy of the SQLite file (checkpoint then
copy, with retention). Backend cron/script + a documented restore. Devops-flavored.

### Large / own spec

**t_224 — Data export/import (CSV).** Idempotent upsert-by-name, per-project vs account-wide,
pre-import warnings, semicolon-separated labels. Own spec before coding.

**t_320 — Multi-account project sharing.** Share a project across users — touches the
multi-tenant model (ownership, per-user vs shared rows, permissions). Epic; needs a design pass.

### Epics / maybe-not

**t_278 — Unified keyboard-form framework.** One mixin so every modal/screen is keyboard-navigable
(and the color/glyph grids finally work by keyboard). **Design sketch: `docs/KEYBOARD_FRAMEWORK.md`**
(open questions pending your review). Closes the t_153 keyboard-nav remainder.

**t_316 — Make mobile nav better.** Responsive overhaul of the nav/layout for small screens. Broad.

**t_246 — Kanban board.** Alternate project view; large, "probably not."

**t_249 — Template projects.** Project duplication + `{field}` placeholder prompting + a
creation workflow. Big lift; suits the workflow but is its own project.
