# Small tasks — batch plan

A plan for knocking out several of the *Small / well-scoped* backlog items in one sitting.
Source of truth: `docs/BACKLOG_PLAN.md`. Frontend-only unless noted; persistence for
`tasks/projects/labels/savedQueries` is automatic via the snapshot, so no migration is needed
except where called out. **Don't commit until reviewed.**

## Recommended batch (one session, no migrations)

**t_318 · t_323 · t_415 · t_328** — all pure-frontend, low-risk, and t_323 + t_415 share a helper.
Suggested order: **t_318 → t_323 → t_415 → t_328**, then verify all together with one rebuild.

`t_273` (merge labels) is also frontend-only but heavier (cross-task mutation) — fold it in if the
batch feels light, otherwise do it on its own. `t_351` (needs a DB migration) and `t_274` (CI/devops,
no app code) are **not** in this batch.

A shared helper worth building first (used by t_323 and t_415):
> **`store.projectTree()` in `data.js`** → returns a flat, depth-tagged list in tree order:
> `[{ p, depth }]`, walking `store.projects.filter(p=>!p.parentId)` then `store.childProjects(id)`
> recursively (the same walk `sideItems()` already uses). Render with a depth-based indent.

---

### t_318 — Add-hint copy *(trivial)*
- **File:** `frontend/js/tasklist.js` → `addPlaceholder` computed (≈ lines 111-117).
- **Now:** `"…(try: buy milk #errand)"` / `"add task… (lands in X)"` — doesn't show priority syntax.
- **Do:** surface the label + priority syntax, e.g. `"add task…  (try: Call Mom #fun !5)"` (and the
  project-view variant similarly). Keep the "lands in X" context if you like.
- **Risk:** none. **Verify:** placeholder text in the empty quick-add box.

### t_323 — Project dropdown order in task detail (bug) *(small)*
- **File:** `frontend/js/task-detail.js` → the project `<select>` (line 27) iterates `store.projects`
  in raw position order, so subprojects scatter from their parents.
- **Do:** add a computed `projectOptions()` returning `store.projectTree()`; iterate that, indenting
  by `depth` (extend the existing one-level `indent(p)` to `'  '.repeat(depth) + (depth?'↳ ':'')`).
- **Reuse:** the new `store.projectTree()` helper.
- **Risk:** low (display only; `task.projectId` unchanged). **Verify:** open a task with nested
  projects — children sit under their parents, indented.

### t_415 — Change a project's parent when editing *(small-medium)*
- **File:** `frontend/js/modals.js` → `ProjectModal`; helper in `frontend/js/data.js`.
- **Do:**
  - Add `parentId` to `ProjectModal` data (init from `project.parentId` in edit mode; from
    `model.parentId` in new mode).
  - Add a parent `<select>` to the template **and** to `kbRows()` as `{id:'parent', type:'input',
    ref:'parent'}` so it's keyboard-reachable. Options = `store.projectTree()` filtered to **exclude
    the project itself and its descendants** (cycle guard) + a `"— none (top level) —"` (value `''`).
  - On save (edit), call a new `store.reparentProject(p, newParentId)` in `data.js`: set
    `p.parentId = newParentId || null` and reset `p.position` to end of the new sibling group
    (`max(position of same-parent siblings)+1`), so it sorts sanely. New-mode keeps using the passed
    parent. `parentId` already round-trips through the snapshot — no migration.
  - Cycle guard: descendant set = recursive `store.childProjects`.
- **Reuse:** `store.projectTree()`, `store.childProjects`, the existing `KbForm` rows in ProjectModal.
- **Risk:** medium — get the cycle guard right (can't parent under self/descendant). **Verify:** edit
  a project, change parent, confirm the sidebar tree updates and re-parenting under a descendant is
  blocked.

### t_328 — Shift-Enter on create → notes *(small)*
- **Files:** `frontend/js/tasklist.js` (quick-add input + a new method); a tiny hand-off flag.
- **Do:**
  - Split the input handler (line 85): `@keydown.enter.exact="commitAdd"` and
    `@keydown.enter.shift="commitAddToNotes"`.
  - `commitAddToNotes()` = `commitAdd`'s body, then open the new task's detail focused in notes:
    set `store.selectedTaskId = t.id`, `store.detailOpen = true`, and signal a notes focus.
  - **Notes focus hand-off:** set a transient `store.pendingNotesFocus = true`; in
    `task-detail.js` extend the `store.detailOpen` watcher to, on open, `if(store.pendingNotesFocus){
    $refs.notes.focus(); store.pendingNotesFocus=false; }` (and set the KbForm cursor to the notes
    row via `kbFocusRow('notes')`).
- **Reuse:** existing `addTask`, the detail's `detailOpen` watcher + `kbFocusRow`.
- **Risk:** low-medium (focus timing — do it in `$nextTick`). **Verify:** type a task, Shift+Enter →
  detail opens with the cursor in the notes textarea; plain Enter still adds-and-stays.

---

## Adjacent but separate

### t_273 — Combine (merge) labels *(medium, frontend-only)*
- **Files:** `frontend/js/modals.js` `LabelModal`; `frontend/js/data.js` `mergeLabels`.
- **Do:** add a "merge into…" `<select>` (other labels) to the label editor; on choosing one, the
  styled `store.askConfirm('…can't be undone')`; then `mergeLabels(from, to)`: for every task, swap
  `from.id`→`to.id` in `task.labels` (dedupe), then remove `from` from `store.labels`.
- **Risk:** medium — touches every task; test that no task ends up with duplicate ids.

### t_351 — Start-of-week setting *(medium — needs a migration)*
- **Files:** new migration (`backend/migrations/00x_week_start.sql`), `backend/src/state.js`
  read/write, `frontend/js/account-screen.js` control, `frontend/js/query.js` `dueWindow(…, weekStart)`
  (already parameterized).
- **Pattern:** mirror how `theme` was added (per-user column + account control). Out of the
  no-migration batch.

### t_274 — GH Action: build & push Docker image *(devops, no app code)*
- `.github/workflows/docker.yml`: build from repo root + `backend/Dockerfile`, push to GHCR on `main`.
- Independent of the frontend batch — do whenever.

---

## Verification (whole batch)
- `node --check` each changed JS file + the inline `index.html` script (extract the `<script>` block).
- `docker compose up -d --build`, hard-reload.
- Walk each task's "Verify" line above. Re-check that keyboard nav still flows through the new
  ProjectModal parent row and the detail's project select.
