# Project Health Check — Design Doc (t_867)

> Status: **proposal for review.** No code written yet.

## Intent (from the backlog)
> "project health check in **row above new task field** … show the **health** of a project including how
> many tasks are **missing due dates, tags, priority, etc.** it'd be nice if this is **configurable in the
> project**."

So: a compact banner at the very top of a project view (directly above the quick-add input) that surfaces
*completeness* gaps in that project's open work — "3 with no due, 2 with no tag, 5 with no priority" — so
nothing important is left half-specified. Which signals show is configurable.

## What "health" means — the signals
Completeness checks over the project's **open, non-archived** tasks. The natural set, all already
derivable from the task fields:
- **no due date** — `!task.due`
- **no tag** — no labels
- **no priority** — `!task.priority` (0)
- **no size** — `!task.size` (only when the account's Fibonacci sizing is enabled)
- *(optional extras)* **overdue** count, **stale** (created long ago, never touched)

Each signal is a count; the bar reads e.g. `◷ 3 no due · # 2 no tag · ⚑ 5 no priority`. When every signal
is clear, show a quiet `✓ healthy` (or hide — see open Qs).

## Where + when it shows
- A new `.health-bar` rendered in `frontend/js/tasklist.js` **immediately above `.quickadd`** (the quick-add
  is the first child of `.main-inner`).
- **Project views only** — `store.view.kind==='project'`. Label/query/search views aren't "a project," so
  the bar is hidden there (it'd be ambiguous what it's measuring).

## Computation (pure client-side)
Over `store.tasks` filtered to the current project — no backend, no query engine needed for the counts:
```js
healthStats(){
  if(this.store.view.kind!=='project') return null;
  const pid = this.store.view.id;
  const ts = this.store.tasks.filter(t => t.projectId===pid && !t.done && !t.archived /* + root-only? */);
  const fib = this.store.currentUser && this.store.currentUser.fib_sizing;
  return {
    total: ts.length,
    noDue:      ts.filter(t=>!t.due).length,
    noTag:      ts.filter(t=>!(t.labels && t.labels.length)).length,
    noPriority: ts.filter(t=>!t.priority).length,
    noSize:     fib ? ts.filter(t=>!t.size).length : null,   // omit the chip when sizing is off
  };
}
```
(Whether to count subtasks or root tasks only is an open Q — `store.projectCount` counts roots.)

## Configurability — the key decision (open Q1)
Three shapes, smallest→largest:
- **A. Global account preference** *(recommended for v1)* — mirrors the just-shipped `fib_sizing` flow
  (`users` column → `auth.js`/`routes/auth.js` → account screen → `store.currentUser`). One master "show
  project health" toggle, plus which signals to include (a small checklist). Simplest; no per-project
  schema churn; one consistent config everywhere.
- **B. Per-project config** *(the note's literal wording)* — a persisted blob on each project (e.g. a
  `health` JSON/bitmask column) + `state.js` read/write + a control in `ProjectModal`. More flexible
  (different projects care about different signals) but more surface.
- **C. Hybrid** — global defaults, optional per-project override.

Recommendation: **ship A first** (it's the pattern we just used and gives 90% of the value), and treat
**B as a fast follow** if the global config feels too blunt. The note leans B, so this is the main thing
to confirm.

## Interactivity — click a signal to see those tasks (open Q4)
Nice but optional. Clicking `3 no due` would filter the list to those tasks. Reuses the query engine:
- `due:none` and `has:no-labels` **already exist** (`query.js`).
- **Missing:** no token for "no priority" / "no size" — add `priority:none` + `size:none` (or
  `has:no-priority`/`has:no-size`) to `query.js`'s `case 'has'`/priority handling. Small, self-contained.
- Clicking sets the query (append the term to the project view, or open a scoped filtered view).

Recommendation: **v1 is read-only counts**; add click-to-filter as Phase 2 once the token additions land.

## Architecture fit & phasing
Everything heavy is **client-side** (a computed over `store.tasks` + a banner). Backend only if/when:
- **Config A** → one `users` column (mirror `fib_sizing` end-to-end). 
- **Config B** → one `projects` column + `state.js` round-trip (mirror `archived`/`position`).
- **Click-to-filter** → a few `query.js` tokens (no persistence).

**Phase 1** — global toggle + which-signals checklist (account screen) + the read-only `.health-bar` in
project views. **Phase 2** — click-to-filter (query tokens). **Phase 3** — per-project override (if wanted).

## Open decisions
1. **Config scope:** global account pref (rec. v1) vs per-project (your note) vs hybrid? This sets the
   shape of Phase 1.
   - I'd like it to be per project
2. **Signals to include:** due / tag / priority / size — also overdue? stale? (size chip auto-hides when
   sizing is off.)
    - due tag priority size notes overdue is what i'm looking for 
3. **Task scope:** count **root tasks only** (matches the sidebar count) or **all** open tasks incl.
   subtasks? Rec. root-only — subtasks rarely carry due/priority and would inflate the gaps.
   - yes root task only don't check subtasks
4. **Interactivity:** read-only counts (rec. v1) vs click-a-signal-to-filter (Phase 2, needs the new
   `:none` tokens).
   - click a signal to filter would be really helpful. let's implement that with escape to clear it and an x icon for mobile and mouse users
5. **Healthy state:** show a quiet `✓ healthy` row, or hide the bar entirely when there are no gaps?
    - healthy row when health scan is enabled for project and everything passes otherwise nothing
7. **Scope of views:** project views only (rec.) — or also show on label/query views (measuring the
   visible set instead of a project)?
   - Project view only for now.

## Out of scope (for now)
A configurable *scoring*/percentage, trend over time, cross-project health dashboard, and notifications —
the bar is a glanceable per-project completeness nudge, not an analytics surface.

## Verification
- In a project view, the bar appears above quick-add; counts match a hand check of that project's open
  tasks (e.g. set one task's due → `no due` drops by one live, since it's a reactive computed).
- Non-project views (label/query/search) show no bar.
- Sizing off → no "no size" chip; sizing on → it appears.
- (Phase 2) clicking a signal filters the list to exactly those tasks.
- (Config) toggling the pref/which-signals shows/hides the bar and chips immediately (no reload), and
  the choice persists across reload.
