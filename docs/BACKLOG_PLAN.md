# tdx_ Backlog — Implementation Plan

Reconciled against the **tdx** project tasks in the live DB (DB = source of truth).
Completed/checked work has been cleared out; only open items remain below.

## DISCREPENCIES

Places where the DB checkmarks don't match what's actually built. I did **not** touch the
database — update the todo list as you see fit.

- **t_157 "Reorder Views and Projects" — checked OFF, but a sub-requirement isn't built.**
  The reorder (move mode + persistence) is done, but the notes also ask to "default to
  landing the user in the top view / system Today / on-the-fly today," which we deliberately
  deferred. → Consider re-opening t_157 or splitting that piece out (tracked as "Default
  landing view" below).

Everything else checked in the DB matches reality: **t_148, t_160, t_164, t_214, t_221,
t_236, t_242, t_286, t_292**. A fair amount of polish shipped without its own task
(alphabetical labels, vim-style `h` tree nav, the 6-theme picker, priority colors, sort
direction toggle `^`, etc.) and isn't tracked here.

---

## Reusable building blocks (for any of the below)
- Sidebar keyboard nav: `index.html` `sidebarKey(e)` + `store.sideItems()` (`data.js`) + the `.nav-item.kfocus`/`.moving` highlights and inline `›`/`✕`/`+` affordances (`sidebar.js`).
- App-styled dialogs: `store.askConfirm(msg)` / `store.askPrompt(label)` (Promise-based, wired in `index.html`) — never use native `confirm()`/`prompt()`.
- Edit modals with color+glyph pickers: `ProjectModal` / `SaveQueryModal` / `LabelModal` in `modals.js`.
- Snapshot persistence is automatic for `tasks/projects/labels/savedQueries` fields, but a new column needs: a migration, `state.js` read+write, and (for ordered tables) `ORDER BY position` — see how `priority`/`position` were added.

---

## Open backlog

### Small / well-scoped

**t_273 — Combine (merge) labels.** Follow-up to the shipped rename. On the label-edit
flow, add a "merge into…" picker listing the other labels; on confirm show the styled
*"Are you sure? This can't be undone"* dialog. On confirm: for every task carrying the
folded label, add the target label id if missing and remove the folded id, then delete the
folded label from `store.labels`. All client-side (labels are referenced by id), persists
via the snapshot. **Files:** `modals.js` (extend `LabelModal`), `data.js` (a `mergeLabels`
helper). Reuse `store.askConfirm`.

**t_274 — GH Action: build & push the Docker image.** Add `.github/workflows/docker.yml`
that builds from the repo root + `backend/Dockerfile` and pushes to GHCR (`ghcr.io/<owner>/tdx`)
on push to `main`, tagged `latest` (+ sha), using the built-in `GITHUB_TOKEN`. Then the host
`compose.yaml` references the pushed image and Watchtower auto-pulls. **Files:** new workflow,
small `compose.yaml` note. No app code. Decide: registry (GHCR vs Docker Hub) and tag scheme.

### Medium

**t_239 (remainder) — task-creation keywords.** `parseQuickAdd` already does `#label` and
`!N` priority. Add the next lowest-ambiguity tokens, one at a time, each documented on the
help "new task" tab: a due-date shorthand (e.g. `^fri` / `^tomorrow` / `^2026-06-10`), then
recurrence (`every week` / `↻weekly`). Keep "unparseable → leave as text, no error."

**t_254 — Duration estimate field.** Same shape as the shipped priority field: add a
`duration` column (migration + `state.js` round-trip), a control in `task-detail.js`, an
optional row badge, a `dur:` query token (`dur:<=2h`), and a sort field in the `SORTS` table.
Decide units (hours vs fibonacci sizing) first.

**t_217 — Archive (soft-delete) projects.** Add `archived` (0/1) to `projects` (migration +
`state.js`). Archived projects drop out of the sidebar tree (or show dimmed under an
"archived" disclosure) and their tasks are excluded from query results (`query.js` /
`visibleRoots` guard). Archive/unarchive from the project edit modal. No hard delete.

**t_288 — Pin a view to the header.** Let a saved view be pinned to the top bar, shown
lowercase with a live count (e.g. `bugs 3`), click opens the view. Likely a `pinned` flag on
`saved_queries` (migration) + header rendering of pinned views via `store.queryCount`. The
note also wants the existing `open`/`overdue` header counts reworked as default-pinned system
views. **Files:** migration, `state.js`, `index.html` topbar, `data.js`.

**Default landing view = the top view** (the deferred slice of t_157). Today the active-view
fallback (after deleting the active view, and on initial load) is hardcoded to "Today"
(`index.html`, `modals.js`, `data.js`). Now that views have a persisted order, change the
rule to **land on the first/top view**, falling back to the inline "Today" only when zero
views remain. New users are already seeded Today-first, so the rule lands on Today by default.

### Large / own spec

**t_228 — Weekend (`dow:`) filter.** Being scoped in its own design doc:
**`docs/WEEKEND_FILTER.md`** — review there.

**t_224 — Data export/import (CSV).** Idempotent upsert-by-name, per-project vs account-wide
scope, pre-import warnings, new-project creation with random color/icon, semicolon-separated
labels. A feature in itself — warrants its own spec like `AUTH_FLOW.md` before coding.

### Epics / maybe-not

**t_278 — Unified keyboard-form framework (vim nav/input toggle everywhere).**

*Problem.* Every keyboard surface reimplements the same idea: a roving cursor with a "nav
mode" + an "insert/activate" action + `Esc`. We've hand-built it ~4× (filter builder, account
screen, help modal, sidebar tree) and the project/view/label modals still aren't navigable
(color/glyph pickers are mouse-only). Every new modal repeats the work.

*Approach.* A reusable "keyboard-form" mixin/composable: a screen declares an ordered list of
focusable fields, each with a `type` (input · button/toggle · select · 2D grid) and how to
enter/activate it (`onEnter`/`onActivate`/`onLeft`+`onRight`). The mixin owns `j/k`/Tab
roving, `i`/Enter to enter a field, `Esc` to leave, the `kfocus` highlight, scroll-into-view,
and keydown attach + `stopPropagation`. Migrate the ~5 modals/screens to declare fields.

*Scope drivers.* (1) **2D grid fields** (color swatches, 30-glyph grid) need `h/l` within a
field — ~80% of the work; (2) per-control insert/activate semantics; (3) modal lifecycle +
stacked overlays; (4) refs/reactivity on `nextTick`.

*Effort.* ~3–5 day Medium (abstraction ~1d, migrate ~5 screens ~1–2d, edge cases ~1d). Risk
in the 2D grids + uniform insert-mode. **Phase-1 / 80-20:** roving-focus for 1D fields only
(~1–2d), grids stay mouse-only. *Payoff:* consistent keyboard UX + deletes per-screen
duplication. (Also closes the t_153 remainder.)

**t_246 — Kanban board.** Alternate project view; large, flagged "probably not."

**t_249 — Template projects.** Project duplication + `{field}` placeholder prompting + a
creation workflow/screen. Big lift; would suit the workflow but is its own project.
