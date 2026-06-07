# Scoping: Task search (vim `/`)

> Status: **scoping — for review.** Open decisions at the bottom; nothing built yet.
> Branch: `feat/search`. Source: **t_332 "Search Tasks."**

## The ask (t_332, verbatim)
> Right now you can filter but you can't search strings. So I wanted to find a task with *Mom* in
> the name a few minutes ago and that's not going to show up on the filter (and shouldn't). I think
> this is an area where the vim `/` would actually be useful. We could fit it into the bottom bar
> which is currently just help and greeblings. A search field there would be useful and would mirror
> vim.

So: a **vim-style `/` free-text search**, **distinct from filtering**, that finds tasks by string
**across everything** (not just the current view), living in the **bottom bar**.

## Why it's different from the filter
Filtering narrows the *current view* by structured terms (status/due/label/project/…). The use case
here is the opposite: "find *Mom* anywhere, even though my current view hides it." Search must look
**across all tasks regardless of the active view**, then let you jump to a hit.

## Current state (what we'd build on)
- **A substring primitive already exists.** `frontend/js/query.js` has a `text` term that matches
  `title.includes(v) || notes.includes(v)` (lines ~105-107); bare words / `"quoted"` text in the
  query become `text` terms. So the matcher is solved — the work is the **UX + scope**, not the match.
- **`/` is currently the query-bar focus shortcut** (`index.html` `onKey` ~line 295 →
  `this.$refs.qbar.focus()`). Repurposing `/` for search needs reconciling (decision #4).
- **The bottom bar** is `<footer class="statusbar">` (index.html:59): `● READY │ N rows` on the left,
  `? help · ⌘K · v1.0` on the right — the "greeblings" the note refers to. The search field slots in
  here.
- **List rendering** goes through `store.visibleRoots()` (current view's query → sorted roots).
  Search needs a *view-independent* result set (run the matcher over **all** `store.tasks`, not the
  active `store.view` query).
- Precedent for an overlay results UI if we want it: the command palette (`command-palette.js`).

## Proposed approach (recommended)
A **bottom-bar incremental search that temporarily takes over the list**:

1. **`/`** focuses a search input in the statusbar (mirrors vim: a `/` prompt at the bottom). A small
   readout shows the term + match count (e.g. `/mom — 3`).
2. **As you type**, the main task list shows **all matching tasks across every project/view**
   (ignoring the active view's filters), matched by `title` substring (± notes — decision #1),
   case-insensitive. Implementation: reuse the `text` matcher but run it over the full task set
   instead of the view query — e.g. a `store.searchRoots(term)` that mirrors `visibleRoots` but
   swaps the view query for a single `text:term` over all tasks.
3. **Navigate results** with the usual list keys (`j/k`, `Enter` opens the detail). `Enter` in the
   search field commits (drops focus into the results); **`Esc` exits search and restores the prior
   view** (and selection).
4. **Distinct from the query bar:** the query bar stays the structured filter (and keeps its own
   bare-word matching *within* a view); `/` is the global, ephemeral "jump to a task" search that
   never mutates the saved view/query.

This matches the note (vim `/`, bottom bar, cross-view), reuses the existing matcher, and keeps a
clean separation: **filter = shape the view; search = find a task anywhere**.

## Sketch of touch points (if we proceed as above)
- `index.html`: a `searchOpen` + `searchTerm` state; a search `<input>` in the `.statusbar`; an
  `onKey` `/` handler that opens/focuses it (replacing the query-bar focus); the input handles
  `Esc` (exit + restore view) / `Enter` (commit to list); while search is active, the task list
  renders `store.searchRoots(searchTerm)` instead of `visibleRoots()`.
- `data.js`: `store.searchRoots(term)` (view-independent matcher over all tasks; surfaces matching
  subtasks' parents like `visibleRoots` does); maybe `store.searchActive` flag.
- `query.js`: reuse the `text` term; optionally expose a tiny `Q.textMatch(task, term)` helper.
- CSS: the statusbar search input + a "searching" affordance.
- Help: document `/` (search) — and update the existing `/` entry that says "focus the query bar."

## Effort / risk
- **Small–medium.** The matcher exists; the work is the input UI, the view-takeover/restore, and the
  `/` reconcile. No backend, no migration, no persistence (search is ephemeral).
- Risks: the `/` rebind (don't strand the query bar), and clearly signalling "you're in search, not
  filtering" so the temporary list takeover isn't confusing.

---

## Open decisions (for your review)
1. **What does search match?** Title only (the note says "Mom in the name"), or title **+ notes**
   (the existing `text` term already does both), or also **labels / project name**? Recommendation:
   title + notes (reuse the existing matcher), title-matches ranked first (#7).
    - Title and notes is fine. If you want label search you can search the side bar
2. **Result display.** (a) **Temporary list takeover** — the main list shows matches, navigate as
   usual *(recommended)*; (b) **palette-style dropdown** of results over the bottom bar; (c) pure
   in-place **jump + `n`/`N`** through the *current* list — note (c) can't satisfy "find a task the
   filter hides," so it's out unless search is meant to be within-view only.
   - List take over is fine
3. **Search scope.** Across **all** tasks including **done/completed** ones? And include **subtasks**
   (surfacing their parent)? The whole point is finding things the view hides, so I lean: search
   everything (done + subtasks), independent of `showCompleted` and the active view.
   - I think the complete/done should respect the complete toggle that we have implemented in the 
     task list today. I wouldn't want to see complete by default but if i'm really sure it exists
     then complete is somewhere I'd check after I searched open
4. **Reconcile `/`.** `/` becomes search. Does the **query bar** need a replacement focus shortcut
   (it's currently `/`), or is click + the filter pane's `i` enough? (Options: leave it click-only,
   or give it another key.)
   - you can get to the query bar via f + i that's good enough for me. Remove the / entry so it can
     be search only
5. **Relationship to the query bar's bare-word matching.** Keep **both** (query bar = in-view text
   filter; `/` = global search) — or is the overlap confusing enough that we should drop bare-word
   matching from the query bar once `/` exists?
   - THat makes sense. I think of the query bar/filters as a long term savable repeat option. 
     the serach is a one time "where's that task called blah"
6. **Incremental vs on-Enter, and what Enter does.** Live-filter as you type *(recommended, vim-ish)*
   vs only filter on Enter. And after committing: `Enter` drops into the results list, or jumps
   straight to / opens the first match?
   - Live search is ideal if we can pull it off. THen enter drops you into the task list. The real
     question is how do you get to clearing the search? A second escape? If I'm in a task editing we'd
     have to make sure we respect those most of all
7. **Result ordering.** Use the **current sort**, or **relevance** (title starts-with, then title 
   contains, then notes)?
   - relevance is fine. If you want the result ordering you'd use the filter. 
8. **Exit semantics.** Search clears (and the prior view restores) on **`Esc`**; does it also clear
   when you **open a task**, **switch views**, or start typing in the query bar? When does a search
   "end"?
   - You should be able to edit a task relevant to the search. Like if you wnated to change the project 
     for everything that has "book" in the title. But switching projects and selecting a view would 
     clear the search. If you type / again it'd remember what you last search was. Escape while in 
     the search task list would clear the search altogether. 
     - if I search what I'm looking for, say what else is in that project, switch to a project it 
       should show my project but then if I hit / again it'll bring the working search back up.
9. **Empty / no-results state.** Show a "no matches" row, and what the count readout looks like.
    - Let's leverage something similar to what the filter no results found does. 
