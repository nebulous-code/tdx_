# Small-Batch Fixes — Implementation Plan

> Status: **ready to build.** Five small, well-scoped items from the live **prod** tdx backlog
> (`p_146`, `~/docker/tdx/data/tdx.db`, read-only). Decisions below are the user's answers to the
> scope questions. Epics (t_217, t_246, t_249, t_320) excluded.

| Task | Kind | One-liner |
|------|------|-----------|
| t_577 | bug | `a`/`A` in the nav always makes a *project* — route by the focused section |
| t_777 | bug | No standalone "delete label" — only rename + merge exist |
| t_778 | bug | A parent project's view shows its **children's** tasks |
| t_581 | feature | Nav helper buttons (`›`/`+`/`✕`) should hide until hover |
| t_796 | feature | Shift+Enter on a task should jump into its Notes |

All five are **client-side** (no migration, no backend) — they mutate the reactive store / DOM and the
300 ms autosave persists anything that changed. The snapshot write path is untouched.

---

## t_577 — `a`/`A` adds the right *kind* for the focused section

**Intent:** "you wind up creating a project no matter where you are and I'd like you to be able to add the
appropriate view/project/label depending on where your cursor is."

**Today** (`frontend/index.html` `sidebarKey`, ~484–491): `a` only fires when the focused item is a
project; `A` always opens a new top-level **project** regardless of where the cursor is.

```js
case 'a': { ... if(it.kind==='project') this.openProjectModal('new', it.ref.id); break; }
case 'A':  this.openProjectModal('new', null); break;
```

**Wiring already present** to create each kind:
- View → `this.openSave('')` (opens `SaveQueryModal` in create mode — same handler as the views-header `+`,
  `index.html:49`).
- Project → `this.openProjectModal('new', parentId)`.
- Label → `store.addLabel(name)` (`data.js:489`). Labels have no create-modal today (they're normally born
  from typing `#tag`), so reach for `store.askPrompt('New label name')` → `store.addLabel(nm)`.

**Change — resolve the focused section, then branch.** The sidebar `items` entries carry `.kind`
(`'head' | 'project' | 'query' | 'label'`); headers also carry `.section`. Derive the active section from
the focused item:

```js
// section of the focused row: a header's own section, else the item's kind
const sectionOf = (it) =>
  !it ? 'project'
  : it.kind==='head'  ? it.section
  : it.kind==='query' ? 'query'
  : it.kind==='label' ? 'label'
  : 'project';
```

- **`a`** (add *within* / *under* the cursor):
  - `query`  → `this.openSave('')`
  - `label`  → prompt → `store.addLabel`
  - `project`→ `openProjectModal('new', it.ref.id)` (subproject — unchanged)
  - a header → create a top-level item of that section's kind
- **`A`** (add *top-level* in the focused section): same switch on `sectionOf(it)`, but projects use
  `openProjectModal('new', null)` (no parent).

**Edge:** prompt-created labels need a non-empty, de-duped name — `addLabel` already slug-dedupes; just guard
the empty string from `askPrompt`.

**Verify:** cursor in views → `a`/`A` opens the new-view modal; in labels → prompts for a label name and it
appears in the list; in projects → `a` makes a subproject under the focused project, `A` makes a top-level
project; on a section header → adds a top-level item of that kind.

---

## t_777 — Delete a label (strip the tag, keep the tasks)

**Intent:** "There's no delete labels option."
**Decision:** delete **removes the label from every task that uses it; the tasks stay.** A confirm dialog
warns how many tasks will lose the tag.

**Today:** `LabelModal` (`frontend/js/modals.js:101`) supports **rename** and **merge** (merge moves tasks
onto another label, then deletes the source via `store.mergeLabels`, `data.js:497`). There is no way to
delete a label outright, and the only sidebar action on a label is **edit** (`sidebar.js:56`).

**1. Store helper** — new `store.deleteLabel(id)` next to `mergeLabels` (`data.js:~497`), modeled on the
merge tail but **without** a destination (strip, don't remap):

```js
store.deleteLabel = (id) => {
  store.tasks.forEach(t => {
    if(t.labels && t.labels.includes(id)) t.labels = t.labels.filter(x => x !== id);
  });
  const i = store.labels.findIndex(l => l.id===id);
  if(i>=0) store.labels.splice(i,1);
};
```

**2. Count helper for the warning** — reuse the existing label-count machinery (the same count rendered in
the sidebar) so the confirm can say how many tasks are affected, e.g.
`const n = store.tasks.filter(t => (t.labels||[]).includes(id)).length;`

**3. UI — `LabelModal`** (`modals.js`): add a **Delete** button in the footer (left of cancel), styled like
the destructive actions elsewhere, plus a `kbRows` entry (`{ id:'delete', type:'button', activate:()=>this.del() }`)
so it's keyboard-reachable. Handler:

```js
async del(){
  const n = this.store.tasks.filter(t => (t.labels||[]).includes(this.model.label.id)).length;
  const msg = n ? `Delete #${this.model.label.name}? It will be removed from ${n} task${n===1?'':'s'} (the tasks stay).`
                : `Delete #${this.model.label.name}?`;
  if(await this.store.askConfirm(msg)){
    if(this.store.view.id==='label_'+this.model.label.id) this.store.openQueryView(this.store.savedQueries[0]); // leave a now-dead view
    this.store.deleteLabel(this.model.label.id);
    this.store.toast('✓ label deleted');
    this.$emit('close');
  }
}
```

**4. Sidebar shortcut (optional, matches views):** the views list uses `x` to delete the focused view
(`index.html:469`). Add a `label` branch to that same `case 'x'` → confirm + `store.deleteLabel`, so
`x` deletes the focused label too. (Keeps keyboard parity; mouse users get the modal button.)

**Verify:** open a label used by ≥1 task → Delete warns with the count → confirm → the label disappears from
the sidebar and from every task's chip set, the tasks remain; reload confirms it's gone. If you were viewing
that label, you land on the top view. `x` on a focused label does the same.

---

## t_778 — A parent project's view should show only its **own** tasks

**Intent:** "Parent projects currently show tasks that belong to the children projects. These should be
excluded and only displayed under the children."
**Decision:** **everything exact** — the project *view*, its sidebar **count**, *and* the `project:` query
token all stop cascading into subprojects.

**Root cause:** a project view resolves to the query `project:<id>` (`store.currentQuery`, `data.js:~206`),
and the `project:` token's resolver **deliberately walks into subprojects**
(`query.js` `resolveProjects`, ~46–59, via `addWithChildren`). So opening a parent shows the whole subtree.
This single resolver also feeds **counts** (`store.projectCount`/`queryCount`) — so changing it fixes the
view and the counts in one place.

**Change — make `resolveProjects` exact** (`frontend/js/query.js`):

```js
function resolveProjects(value, ctx){
  const projects = ctx.projects || [];
  const match = projects.filter(p =>
    p.id === value || slug(p.name) === slug(value) || slug(p.name).includes(slug(value))
  );
  return new Set(match.map(p => p.id));   // exact: no addWithChildren cascade
}
```

**Also update the grammar doc** at the top of `query.js` (~6): `project:work   (matches that project only)`
— remove "OR any of its subprojects."

**Ripple to check (grep first, adjust copy only):**
- **Counts** — `store.projectCount`, `store.queryCount`, the pinned-view header counts: all run through
  `Q.run` → `resolveProjects`, so a parent's count now reflects only its own tasks automatically. Confirm no
  count helper re-implements the cascade separately.
- **Sidebar parent rows** — a parent project's row count drops to its own tasks; subproject rows already
  show their own. This is the intended behavior.
- **Quick-add target** — adding a task while viewing a parent still files into the parent (`currentProjectId`
  returns `view.id`); unaffected.
- **No data migration** — this is pure query semantics; nothing persisted changes.

**Note for the user:** this removes the "see everything under a parent" shortcut entirely (your call —
"everything exact"). If you ever want the old roll-up, it'd come back as a separate explicit token
(e.g. `under:<id>`), not the default — out of scope here.

**Verify:** a parent project with its own tasks + child projects with tasks → opening the parent shows
**only** the parent's own tasks; the parent's sidebar count matches; each child still shows its own tasks
under itself. Typing `project:<parent>` in the filter bar likewise returns only the parent's tasks.

---

## t_581 — Nav helper buttons appear only on hover / focus

**Intent:** "the `›` `+` and `x` symbols on the nav drawer should only appear if my mouse is hovering over
them or my cursor is hovering over them. Otherwise the full name should be displayed up until it's cut off
by the task count. The name should auto shrink to an ellipsis like it is today when I hover/cursor over the
entry."
**Decision (mobile):** since touch has no hover, **reveal on tap/select** — selecting a row (the existing
`.kfocus`/active state) reveals its helpers.

**Today:** every helper is a `<span class="add">` rendered inline and always visible — views
(`sidebar.js:22–23`), projects (`88–89`), labels (`56`), and the section `+` adds (`12/33`). The row name
already ellipsizes against the trailing count.

**This is CSS-only** (`frontend/styles.css`, near the `.nav-item`/`.add` rules):

```css
/* helpers hidden by default; the name reclaims the freed width and ellipsizes against the count */
.nav-item .add { opacity: 0; transition: opacity .12s; pointer-events: none; }

/* desktop: reveal on hover. touch/keyboard: reveal on select (.kfocus) or active row. */
.nav-item:hover .add,
.nav-item.kfocus .add,
.nav-item.active .add { opacity: 1; pointer-events: auto; }
```

- **`opacity` (not `display:none`)** keeps the row's layout/width stable so the name doesn't reflow as
  helpers appear — it just ellipses a bit sooner when they're shown (which is the asked-for behavior).
- **`pointer-events:none` while hidden** so a stray tap on an invisible `›` can't fire.
- **Touch/mobile = "reveal on tap/select":** tapping a row sets it active/`.kfocus` (same state keyboard
  focus uses), which the third selector reveals — no hover needed. Confirm a tap toggles `.kfocus`/`active`
  on the row on touch; if a plain tap currently *navigates* instead of selecting, gate reveal on `.active`
  (the opened row) so the helpers are reachable on the row you just opened.
- **Section-header `+`** (`.side-head .add`): same treatment scoped to `.side-head:hover`/`.kfocus` so the
  add buttons on the Views/Projects/Labels headers also hide until you're on the header.

**Verify (desktop):** at rest, rows show full names ellipsing at the count, no `›`/`+`/`✕`; on hover the
helpers fade in and the name ellipses sooner; keyboard `j/k` onto a row reveals its helpers (`.kfocus`).
**(Mobile):** at rest, names only; tapping/selecting a row reveals its helpers; the buttons are tappable.

---

## t_796 — Shift+Enter on a task drops into Notes

**Intent:** "I'd like to be able to pop straight into the notes on the task list by clicking shift enter
similar to the workflow on initial task creation."
**Decision:** open the detail drawer **and start editing Notes** (cursor in the textarea), exactly like
quick-add Shift+Enter.

**The plumbing already exists.** Quick-add's Shift+Enter sets `store.pendingNotesFocus = true`
(`tasklist.js:182`); the detail drawer's open-watcher consumes it and focuses the notes textarea
(`task-detail.js:132–138`). We just reuse it from the **list** key handler.

**Today** (`index.html` main-list keydown, ~329): `Enter` (and `e`) opens the drawer; Shift is ignored.

```js
case 'e': case 'Enter':
  if(curId){ e.preventDefault(); this.store.detailOpen=true; } break;
```

**Change** — branch on `e.shiftKey` for the Enter case (Shift+Enter still reports `e.key==='Enter'`):

```js
case 'e': case 'Enter':
  if(curId){
    e.preventDefault();
    if(e.key==='Enter' && e.shiftKey) this.store.pendingNotesFocus = true;  // land in Notes
    this.store.detailOpen = true;
  }
  break;
```

The existing watcher (`task-detail.js:135`) sees `pendingNotesFocus`, focuses `$refs.notes`, and clears the
flag — same path quick-add uses, so behavior is identical. `e` (no Shift) and plain `Enter` are unchanged.

**Verify:** select a task in the list → **Shift+Enter** opens the drawer with the cursor blinking in the
Notes textarea (type immediately, `⌘/⌃+Enter` saves, `esc` releases). Plain `Enter`/`e` still open the
drawer focused on the title row as before.

---

## Build order & checks
1. **t_796** (one branch) and **t_581** (CSS) — smallest, no store changes.
2. **t_577** (key routing + label prompt) and **t_777** (`deleteLabel` + modal button).
3. **t_778** (query resolver) last — grep all `resolveProjects`/count callers, then flip the cascade.

`node --check` each touched JS (`frontend/js/data.js`, `frontend/js/modals.js`, `frontend/js/query.js`,
`frontend/index.html` inline script). No migration, so just boot `tools/dev.sh` and walk each Verify
section. None of these touch `backend/src/state.js`, so the snapshot round-trip is unaffected.
