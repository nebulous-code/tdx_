# tdx_ Backlog — Implementation Plan (simple & well-defined items)

Triage of the 16 tasks in the **tdx** project (read from the live DB). Each is rated:

- **Quick win** — small, well-scoped, leans on patterns we already have. Outlined in full below.
- **Medium** — clear behavior but needs a schema field or a non-trivial chunk of UI. Sketched briefly.
- **Deferred** — large / under-specified / epic. Listed with the reason only.

| Task | Title | Tier |
|------|-------|------|
| t_148 | Sub-project filter not highlighting | Quick win (bug) |
| t_214 | Delete views | Quick win |
| t_221 | Collapse view/project/label sections (Tab) | Quick win |
| t_160 | Add project / sub-project shortcuts (a / A) | Quick win |
| t_164 | Edit (rename) labels | Quick win (rename); combine = Medium |
| t_153 | Task-detail polish | Quick win (the slices); full kbd-nav = Medium |
| t_236 | Help screen scrolling / tabs | Mostly done; tabs = Quick win |
| t_157 | Reorder views & projects (m / jk) | Medium (needs order field) |
| t_217 | Archive (soft-delete) projects | Medium (needs archived flag) |
| t_242 | Priority field | Medium |
| t_254 | Duration estimate field | Medium |
| t_239 | Task-creation language | Medium (do a subset) |
| t_224 | Data export / import (CSV) | Deferred |
| t_228 | Weekend (`dow_`) filter | Deferred |
| t_246 | Kanban board | Deferred (epic) |
| t_249 | Template projects | Deferred (epic) |

Shared building blocks already in the codebase to reuse:
- Sidebar keyboard nav: `index.html` `sidebarKey(e)` + `store.sideItems()` (`data.js`) + the `.nav-item.kfocus` highlight and the inline `›`/`+` affordances (`sidebar.js`).
- Styled confirm popup: copy the account screen's pattern (`account-screen.js` `confirmOpen` + the `"… Yes (enter) No (esc)"` overlay) instead of native `confirm()`.
- Per-row edit modal: `SaveQueryModal` / `ProjectModal` in `modals.js` (color + glyph pickers).
- Snapshot persistence is automatic: any new field added to a store object and to `state.js` read/write round-trips through `/api/state`.

---

## Quick wins

### t_148 — Sub-project filter chip doesn't highlight (bug)
**Cause.** `query-bar.js` `has(field,value)` compares the term value to `String(value).toLowerCase()`, but a project view's query is `project:` + **slug** (`Q.slug(p.name)`, alphanumeric-only). For a multi-word project ("Move Apartments") `slug` = `moveapartments` while `toLowerCase()` = `move apartments`, so they never match and the chip stays off.
**Fix.** Make `has()` slug-compare for `project` (and `label`, same class of bug):
```js
has(field,value){
  const v = String(value).toLowerCase();
  return this.terms.some(t => t.field===field && !t.neg &&
    ((field==='project'||field==='label') ? Q.slug(t.value)===Q.slug(v) : t.value===v));
}
```
**Files:** `frontend/js/query-bar.js`. **Est.** ~10 min. (Adding to a project from a project view already works via `store.viewDefaults()`.)

### t_214 — Delete views
We already delete views from the edit modal; this adds the in-nav affordances + a styled confirm.
1. **`x` affordance** on each view row, left of the `›` (only non-system views): `sidebar.js` views loop → `<span class="add" @click.stop="$emit('delete-query', sv)">✕</span>`; wire `@delete-query` in `index.html`.
2. **`x` shortcut** in nav focus mode: in `sidebarKey`, add `case 'x':` → if the focused item is a `query` (non-system), trigger delete.
3. **Styled confirm** (replace any native dialog): reuse the account-screen confirm overlay — *"Delete view "<name>"? Yes (enter) No (esc)"* → on Yes call `store.deleteQuery(sv)` (already exists) and, if it was the active view, fall back to Today.
**Files:** `sidebar.js`, `index.html` (sidebarKey + a small confirm, or a tiny `confirm-dialog` component). **Est.** ~1 hr.

### t_221 — Collapse view / project / label sections with Tab
**Behavior.** In nav focus mode, `Tab` collapses/expands the section the focused item belongs to (views / projects / labels).
1. Add UI state `store.navSections = { query:false, project:false, label:false }` (collapsed flags). Persist later if wanted; in-memory is fine to start.
2. `sidebar.js`: each section body `v-show="!store.navSections[kind]"`; the `side-head` shows a ▸/▾ twist.
3. `sidebarKey`: `case 'Tab':` → determine the focused item's kind (from `store.sideItems()[idx].kind`) and toggle `store.navSections[kind]`. `e.preventDefault()` to stop focus-tabbing.
4. `store.sideItems()` should **skip** items in a collapsed section so j/k navigation matches what's visible (mirrors how `visibleRows`/the project tree already respect collapse).
**Files:** `data.js` (sideItems + state), `sidebar.js`, `index.html`. **Est.** ~1.5 hr.

### t_160 — Add project / sub-project shortcuts (a / A)
**Behavior.** In nav focus mode: `a` = new sub-project under the focused project; `A` = new top-level project. Both open `ProjectModal`.
1. `sidebarKey`: `case 'a':` → if focused item is a project, `openProjectModal('new', focused.ref.id)`; `case 'A':` → `openProjectModal('new', null)`. (Both methods already exist in `index.html`.)
2. **Make `ProjectModal` keyboard-friendly** (the note calls this out): autofocus name (already does), `Enter` saves (already), add `Esc` to close, and `Tab` order through name → color → glyph. Optional: j/k over swatches/glyphs — but Tab + Enter already makes it usable. Treat full j/k picking as a stretch.
**Files:** `index.html` (sidebarKey), `modals.js` (Esc handler). **Est.** ~45 min (shortcuts) + ~1 hr (modal nav polish).

### t_164 — Edit (rename) labels
Rename is trivial because tasks reference labels **by id** — changing `label.name` updates everywhere automatically (no migration).
1. **`e` on a focused label** in nav: `sidebarKey` `case 'e'` already edits projects/views; extend it to `kind==='label'` → open a small label-edit modal (or reuse a minimal modal) with a single `name` field. Also add an `e`/`›` affordance on label rows in `sidebar.js` (labels were intentionally left out earlier — this is the task to add them).
2. **Save** → set `lab.name = trimmed` (reactive; persists via snapshot). Enforce lowercase + dedupe by `Q.slug` on save.
**Files:** `sidebar.js`, `index.html`, a tiny `label-modal` (or extend `modals.js`). **Est.** ~1 hr.
**Combine labels (defer):** the merge flow (pick a label to fold in → reassign every `task_labels` row → delete the folded label, with an "are you sure" confirm) is a clean follow-up but more involved; do it after rename ships.

### t_153 — Task-detail polish (the easy slices)
The full "make the detail a keyboard window" is Medium, but several listed sub-items are quick and independent:
- **Force-lowercase labels:** in `store.addLabel` (`data.js`) lowercase the name before create/dedupe (already dedupes by `Q.slug`); also lowercase on the label-rename save (t_164).
- **Styled new-label popup:** replace the `prompt()` in `task-detail.js#addLabel` with a small app-styled input modal (reuse the overlay/modal pattern).
- **Dupe / delete shortcuts:** the detail already has buttons + a Save button; add `e`-detail-scope keys is the bigger item, but a quick version: when detail is open and not typing, `⌫`/`d` = delete (with confirm), `y` = duplicate. (Pick keys that don't fight the list nav — gate on `store.detailOpen`.)
**Files:** `data.js`, `task-detail.js`, `index.html`. **Est.** ~1.5 hr for the slices. Leave full detail keyboard-nav as its own Medium task.

### t_236 — Help screen scrolling / tabs
**Scrolling is already implemented** (the help modal is `max-height:76vh` with an `overflow-y:auto` body). The remaining ask is **tabs** (Keyboard / Query syntax / …) navigable by `h`/`l`, contents by `j`/`k`. Small: split the `keys`/`syntax` arrays into tabs, track `activeTab`, render a tab strip, handle `h`/`l` in the modal. **Est.** ~1 hr. Could also just leave scrolling and close this.

---

## Medium (clear, but needs a field or larger UI — sketch only)

- **t_157 Reorder views & projects.** Needs an explicit order. Add a `position` integer to `projects` and `saved_queries` (migration), have `state.js` `ORDER BY position`, and write positions on reorder. Then: `m` enters "move mode" on the focused item, `j/k` swap it up/down (re-number neighbors), `Esc` exits. Without a persisted order, reordering won't survive reload, so the schema piece is the gate.
- **Default landing view = the top view (depends on t_157).** Today the active-view fallback (after deleting the active view, and on initial load) is hardcoded to "Today" (`index.html`, `modals.js`, `data.js`). Once views have a persisted order, change the rule to **land on the first/top view** (the user controls which view that is via reorder/sort), falling back to the inline "Today" only when zero views remain. Until t_157 ships we intentionally keep the hardcoded-Today fallback. New users are seeded with **Today first** (`db.js seedUserDefaults` inserts `sv_today` first → it's the top view by default), so the eventual top-view rule lands on Today out of the box.
- **t_217 Archive projects.** Add `archived` (0/1) to `projects` (migration + `state.js`). Archived projects: hidden from the sidebar tree (or shown dimmed under an "archived" disclosure) and their tasks excluded from query results (add an `archived` guard in `query.js`/`visibleRoots`). Archive/unarchive from the project edit modal. No hard delete (matches the note).
- **t_242 Priority** and **t_254 Duration.** Same shape: add a column (`priority` enum `0–4`, `duration` number) → `state.js` round-trip → a control in `task-detail.js` → a query token in `query.js` (`priority:high`, `priority:>=high`, `est:<=2h`) → optional badge in the task row + a sort option. Each ~half a day.
- **t_239 Task-creation language.** `parseQuickAdd` already handles `#label`. Extend incrementally with the lowest-ambiguity tokens first: `due:` / a date shorthand (`^fri`, `^tomorrow`), then recurrence (`↻weekly` / `every ...`), then `!high` priority once t_242 lands. Each token is isolated, so ship one at a time and document them on the help screen.

---

## Deferred (complex or epic)

- **t_224 Data export/import (CSV).** Idempotent upsert-by-name, per-project vs account-wide scope, pre-import warnings, new-project creation with random color/icon, semicolon-separated labels. A feature in itself — worth its own spec like `AUTH_FLOW.md`.
- **t_228 Weekend `dow_` filter.** Novel query semantics (next occurrence of given weekdays, "roll over until past the last day in the series") and an unclear builder UI. Needs a design pass before coding.
- **t_246 Kanban board.** Alternate project view; large, and flagged "probably not."
- **t_249 Template projects.** Project duplication + `{field}` placeholder prompting + a creation workflow/screen. Big lift; the note already calls it out.

---

## Epic — Unified keyboard-form framework (vim nav/input toggle everywhere)

**Problem.** Every keyboard-navigable surface reimplements the same idea from scratch:
a roving cursor with a "nav mode" and an "insert/activate" action plus `Esc`. We've now
hand-built it ~4 times — the filter builder (groups+chips, `h/l`+`j/k`+space+`i`), the
account screen (rows + `i`-to-edit + theme `h/l`), the help modal (tabs + `j/k`), and the
sidebar tree — and the modals (project / view / label) still aren't keyboard-navigable
at all (their color/glyph pickers are mouse-only). Every new modal repeats the work.

**Approach.** A reusable "keyboard-form" mixin/composable. A screen declares an ordered
list of focusable fields, each with a `type` (text input · button/toggle · select · 2D
grid) and how to enter/activate it (`onEnter` / `onActivate` / `onLeft`+`onRight` for
grids). The mixin owns: `j/k` (or Tab) roving, `i`/Enter to enter a field, `Esc` to leave
insert mode / close, the `kfocus` highlight, scroll-into-view, and the document-keydown
attach/detach + `stopPropagation` against the global handler. Each existing screen then
migrates to *declare* its fields instead of carrying bespoke key code.

**Scope drivers (where the effort is):**
1. **2D grid fields** — the color swatches and 30-item glyph grid need `h/l` *within* a
   field. 1D lists are trivial; the grids are ~80% of the work. (Filter chips are precedent.)
2. **Per-control insert/activate semantics** — inputs (focus+type), selects (open),
   toggles (flip), grids (move) each need a small descriptor.
3. **Modal lifecycle** — listener attach/detach, `stopPropagation` vs the global `onKey`,
   focus-trap, and stacked overlays (the confirm/prompt sitting on top of a modal).
4. **Refs/reactivity** — focusing the right input by ref on `nextTick`.

**Effort.** ~3–5 day Medium: abstraction ~1 day, migrate the ~5 screens (project / view /
label modals, account, detail) ~1–2 days, edge-case testing (grids, escape-from-insert,
nested overlays) ~1 day. Risk concentrated in the 2D grids + uniform insert mode.

**Cheaper 80/20 (phase 1).** Ship a roving-focus composable that handles only 1D fields
(inputs / buttons / toggles) with Tab·`j/k`·`Esc`·`i`, leaving color/glyph grids mouse-only
for now (~1–2 days). Covers the text/button parts of every modal; add grid support later.

**Payoff.** Consistency across all windows + deletes (and stops re-writing) the per-screen
keyboard duplication every new modal currently needs.

---

## Suggested order to ship the quick wins
1. **t_148** (bug, ~10 min) — fixes a visible papercut.
2. **t_214** (delete views) — completes the view CRUD we started.
3. **t_164** (rename labels) — finally brings labels into the edit story.
4. **t_160** (a/A project shortcuts) — rounds out nav-window creation.
5. **t_221** (Tab collapse) — declutters the nav.
6. **t_153 slices** + **t_236 tabs** — polish.

All of the above are additive and independently shippable; none needs a migration except where noted in the Medium tier.
