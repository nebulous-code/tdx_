# 2E — UI polish + keyboard/accessibility (D2 phase 2e)

> Living design doc, the sibling of `2D_APP_SHELL.md`. 2d rebuilt the frontend's **structure** (shell, router, lazy modules, unified query, cross-link UI). 2e is the **polish + interaction** pass over it: per-app navigation, the query system everywhere, the detail surfaces, keyboard-everywhere, and the feel of each module.
>
> Most of this is inherently **cyclical**: a change ships, you live with it, you give feedback, it gets adjusted — treat each item as "first cut + iterate," not "build once and done." **Open decisions live under each item.**

## Context
Sequencing from `BACKEND_REDESIGN_TODO.md`: **2d** (done) → **2e** (this doc) → **2f** (CLI/MCP/RAG). Two things previously parked "after 2e" — **per-app secondary navs** and **notes tags** — are pulled forward into 2e because nearly everything here depends on them.

Locked in 2d that 2e builds on (`2D_APP_SHELL.md` → Decided): the **notes-tags model** (reuse `labels`, in each note's frontmatter header), the **deep-nav drawer** + Lucide icons, **vim insert/normal** note editing (no side-by-side), and **Enter-to-save** as a global convention.

## Build order (this doc's section order = the build order)
1. **Update / save-in-place query** — self-contained warm-up.
2. **Per-app navs + calendars & folders** — the foundation entities.
3. **Query system everywhere** — per-app query bar, the `type:` rule, the unified date model, global search.
4. **Keyboard everywhere + detail drawers** — the right-hand drawers and full keyboard nav.
5. **Human-readable per-user ids** — its own backend slice; can slot early so everything renders readable ids.
6. **Note-editor feel + final polish** — the vim cursor, button cleanup, the Enter/`↵` + accessibility audit.

Sizable backend changes riding under "UI polish": the **calendars/folders entities** (§2) and **human-readable ids** (§5) — both effectively their own slices.

## Status (as of the §6 note-editor pass)
**§1–§5 are DONE. §6 is done except the audit.** Each section heading below carries its own status + a one-line record of what shipped.
- **Remaining to build:** **§6.4** — the keyboard + mouse accessibility audit (always planned as the final sweep once everything else landed).
- **Remaining to decide:** **§6.2** — note button layout / back-vs-close, deliberately deferred until the new frontend had been lived with. Now decidable.
- **Remaining to feel out:** **§6.1** reflow/motion tuning, and the provisional §4.2 day-drawer key mappings — both explicitly "iterate in-product."
- **Not a 2e item, but the real gate on shipping this:** the **prod cutover**. `docs/DEPLOY.md` is a **D1-only** runbook — neither it nor `compose.yaml` mentions the notes **vault** (no `VAULT_DIR` volume/env in prod), and there's no backfill rehearsal for the D2 migrations (`002`–`006`: events, links, notes, calendars/folders, readable ids) against real data. Refresh the runbook + dry-run the migration on a copy of the prod DB before flipping anything.

---

## 1. Update / save-in-place query — ✅ DONE
*Shipped: an **Update** action (`u`) beside Save in `frontend/js/query-bar.js` — Save = save-as-new, Update = overwrite the selected saved view in place.*

Today, selecting a saved query and changing its syntax only offers **Save**, which creates a **new** query — there's no in-place edit (confirmed: `query-bar.js` `save()` just emits `save-query`). Add an **Update** action beside Save: **Save** = save-as-new, **Update** = overwrite the selected query in place. Needed to make the §3 `type:`-scoping cleanup practical (you edit old queries rather than re-create them).

**Open decisions**
- **When is Update offered?** Only when a saved **non-system** query is the active view and its text changed? Seed/system views are save-as-new only — confirm.
- **Keybinding.** Save is `s`; Update could be `u` (check it's free in the query pane).

---

## 2. Per-app navs + calendars & folders — ✅ DONE
*Shipped: `migrations/005_calendars_folders.sql` (calendars flat, folders nesting + on-disk sync + `.tdx-folder.json` marker); `services/calendars.ts` / `services/folders.ts`; the nav's category tree swaps by app via `store.categoryKind` (`js/sidebar.js`); per-app seed views in `server/src/seed.ts`. Defaults + icon/color polish stay open below.*

### 2.1 Per-app navigation (Tasks / Events / Notes each get their own nav)
Today the Tasks nav (projects + labels) is the only app nav and only makes sense on Tasks. Each app gets its own `n`-toggled nav, all sharing the same project-style "category" shape (per-owner, name, user-pickable icon + color):
- **Tasks** → projects (as today).
- **Events** → **calendars** (§2.2).
- **Notes** → **folders** (§2.3).
- **Labels** are available in **every** app's nav (the notes-tags model from 2d, extended to events too).

Saved queries surface **under each app whose type(s) the query addresses** (a `grocery` query over notes+tasks shows in both the Notes and Tasks navs, not Events). Per the §3 `type:` rule (no `type:` → all types), a query with **no** `type:` term shows under **every** app.

**Decided**
- **Category icon on the right edge — always shown.** Body color alone can't always distinguish (system/amber color, or color-blind users), so **every** event/task row shows its **category icon on the right edge** (always, not conditional), tinted its calendar's/project's color (matching the left icon), while the row body uses a more **translucent** wash of that color (like today's system-color events). Applies to events and tasks.

**Open decisions**
- **Sequencing.** Confirm per-app navs are 2e's first big chunk (folded forward from "after 2e").

### 2.2 Calendars (the events "category" entity)
**Decided.** Calendars are a **first-class entity** like projects: a `calendars` table (per-owner, name, color, icon); events gain a `calendar_id`; **one calendar per event**; a **default calendar** for unassigned events. Events render in their calendar's color (the projects-pick-icon+color model applied to events). Migration + backfill needed. Calendars do **not** nest (flat list).

**Open decisions**
- **Defaults.** What's the default calendar named, and can it be renamed/deleted?

### 2.3 Folders (the notes "category" entity)
**Decided.** Folders are a **managed entity** (not just a path): a `folders` table (per-owner, name, icon, color, `parent_id`) mapped to vault subdirs, so folders get the same icon/color styling as projects/calendars. The DB entity and the on-disk directory stay **in sync** on create/rename/move/delete from either side — accepted as worth the cost. Moving a note between folders moves the underlying `.md` on disk.
- **Folders nest** (`parent_id`, mirroring the vault directory tree) — like projects. (Calendars don't.)
- **Identity via a hidden marker file.** Each folder holds a `.tdx-folder.json` (folder id + icon/color), so an external rename/move (nvim/Obsidian) carries its identity + styling — the `.obsidian` precedent; a `.tdx` dotfile is acceptable. The app writes it on folder create, and **gently writes one back** when a scan finds a bare externally-created dir (mirrors the note frontmatter-id writeback). The note scanner already skips dotfiles, so the marker is never indexed as a note. A note's own frontmatter id is stable, so `[[wikilinks]]` survive any folder move.

**Open decisions**
- **Defaults.** What's the default folder named, and can it be renamed/deleted?

### 2.4 Per-app home / seed views
Each app's nav has a **top/default query** that acts as its home (where the cursor lands on entry — Tasks already has one). Ship default smart views per app (`*` = primary/home):
- **Events:** this week\*, this month, last week, next month. *(month views = true calendar months.)*
- **Notes:** edited in past week\*, created in past week, no label/tag, **review today**.

These rely on the §3.3 date model (universal `created:`/`edited:`, `due:`-per-type incl. the note **review** date, true calendar-month keywords). No sorting needed — all date-range/equality filters. Events lean on already-shipped work (bidirectional `due:` comparisons + occurrence expansion); the only new query-engine pieces are §3.3's `created:`/`edited:` fields and calendar-month keywords. *(So the seed-view definitions land once §3.3 is in.)*

---

## 3. Query system everywhere — ✅ DONE (all four subsections)

### 3.1 App-type selector + the `type:` rule — ✅ DONE (see "Completed")
Built at the larger "live mixed results" scope, which also delivered the §3.2 **inline cross-type rendering**. Full record in the **Completed** section.

### 3.2 Per-app query bar (bring it to Events & Notes) — ✅ DONE
*Shipped: one shared, app-aware `js/query-bar.js` on all three app screens, auto-defaulting `type:<app>`; saved queries route to the navs whose type they address.*
Only **Tasks** has the top query bar today; the unified query already works for events and notes, so the query top-drawer should appear on **all three** app screens. Each app's builder offers the chip groups that fit its type (Tasks: project/status/due/labels; Events: calendar/date/labels; Notes: folder/labels), all writing the same language, results rendering in that app.

**Decided**
- **Auto-default `type:<app_type>`, expandable** — a query written in Tasks defaults to `type:task`; select the Note chip to also pull in notes. This is the nudge that makes the `type:` rule self-enforcing: an old task query surfacing under Notes is annoying enough that you'll scope it.
- **Nav shows queries whose `type:` includes the app's type, or has no `type:`** (= all).
- **One shared, app-aware `query-bar.js`** (swap chip groups by app, not three copies); rename "filter" → "query" (§12); focus key + layout carry over per app.
- **Cross-type results render inline** — ✅ **done in §3.1** (the `mixed-list` component with deep-nav type icons, on the Tasks screen). Remaining: per-type result-format polish (task → checkbox, event → start date, note → edited date), refined once all types share a result view.

### 3.3 Unified query date model (created / edited · due-per-type · note "review" date) — ✅ DONE
*Shipped: `created:`/`edited:` + true calendar-month keywords in the parity engine (`query.ts` ≡ `query.js`, goldens regenerated); the per-type `due:` mapping in `unifiedQuery.ts`; the note **review date** (`review_at`, from frontmatter).*
Make the date predicates work **consistently across all item types**, so a mixed query like `type:task,note created:>=-7d` behaves sensibly instead of silently matching nothing.

**Decided**
- **`created:` / `edited:` — universal.** Both backed by each type's existing timestamps: `created_at` everywhere; `edited` = `updated_at` for tasks/events, `mtime` for notes. Reuse the existing date-delta + `cmpDate` machinery (incl. negative offsets). This is what makes `type:task,note created:…` find **both** — without it the filter only hits whichever type had the hook. The values already exist in the DB; we just add the query hook.
  - *Asymmetry to accept:* "edited" = file `mtime` for notes (external nvim edits count) vs `updated_at` for tasks/events (**any** change — even a status toggle — counts; "touched," not "text-edited"). Same concept, different triggers.
- **`due:` — one concept, mapped per type.** "The date this item is actionable/relevant," resolved per type (the events pattern, generalized): task → its due date; event → its start/occurrence date (already so); **note → a new "review" date.**
- **Note "review" date (new metadata).** Optional review date in frontmatter (`review:` alongside `id:`/`labels:`), shadowed to a `review_at` column on scan (same pattern as tags). `due:` on a note evaluates against it. Uses: spaced study, or a recipe flagged to review Sunday at meal-planning — you **manually** bump it each review (recurrence parked). Frontend label: **"review date."** Most notes have **no** review date and that's the norm; `due:none` matches them. Notes get a review date **only — no `reminder:`** (notification system deferred; views cover the need). **"review today"** (the 4th Notes seed view) surfaces reviews due **or overdue** — a missed review keeps showing.
- **Calendar-month keywords — true months.** New `this-month`/`next-month` (and `this-week`/`last-week`) sugar uses **true calendar boundaries** (Jun 1–30), not day-offset windows — sugar should give something you can't easily hand-roll with `due:<Nd`. (`due:week`/`due:month` keep their day-offset meaning.)

**Parity + scope**
- `created:`/`edited:` and the calendar-month keywords are **parity-engine** changes (`query.ts` + `query.js` + regenerated goldens) — additive, so existing predicates/goldens are untouched.
- The `due:`→per-type **mapping** lives in `unifiedQuery.ts` (`*AsTask`), **not** the parity engine.
- Notes gain a `review_at` column (small migration), populated from frontmatter on scan.

**Parked (not 2e)**
- **Review recurrence.** Manual bump for v1; a future "review every week" recurrence could automate it.

### 3.4 Global search (`/`) → live text find across all types — ✅ DONE
*Shipped: `store.runSearch` runs `type:task,event,note` through `POST /api/query` (debounced, sequence-guarded); results render in `js/search-list.js` with deep-nav type icons.*
Upgrade the `/` bottom-bar search (today: tasks only, client-side) to a **text-only live find** over tasks + events + notes. This is **not** the query system — it's the throwaway find defined in `STYLE_GUIDE.md` §12.

**Decided**
- **Distinct from query, intentionally limited** — text match on title/body across all types; not categorical, not saved.
- **Result presentation.** Each hit shows its app's **deep-nav type icon** on the left. Acting on a hit opens that type's right-hand detail drawer (§4). Until every type has a drawer, the icon + opening the item is enough.

---

## 4. Keyboard everywhere + detail drawers — ✅ DONE
*Shipped: all four detail surfaces (task · the event drawer replacing the old modal · note · the shared `js/md-field.js` render-when-not-editing editor), the §4.2 calendar day-schedule drawer (`E`, all-day + dated-task strips, task rows opening the task drawer atop it), and deep-nav (`N`) + per-app nav keyboard models. The **§6.4 audit** is the remaining coverage check.*

### 4.1 Unified right-hand detail drawer (all item types)
Every item type opens in a **consistent right-hand drawer** (like today's task-detail drawer), so a mixed-type search/query result behaves the same regardless of type and there's one detail surface to learn.
- **Task** → the existing task-detail drawer.
- **Note** → the note detail drawer (§4.3).
- **Event** → a **new event detail drawer** (metadata: calendar/label/links + light edit), opened from a search/query hit or the calendar day-detail.

**Leaning drawer.** The §4.2 day-detail nav and the §3.4/§3.2 result presentation both assume the **drawer** form for events, so the direction is **one event detail drawer everywhere** (replacing the centered `EventDetail` modal).

**Open decisions**
- **Quick-create path.** Keep a lightweight fast-create affordance for brand-new events (where a modal/inline form may beat a full drawer), or route even creation through the drawer?
- **Drawer vs full screen, per type.** Notes have a full editor screen; the drawer is the "peek + metadata" surface (drawer = metadata + light edit; full screen = primary editing). Tasks/events have no full screen — they just *are* their drawer. Confirm.

### 4.2 Calendar day-detail drawer
**`E`** (Shift-E) on a focused day opens an **hour-by-hour** schedule for that day in a right-hand drawer. Selecting an event in it opens the **event detail drawer** to its right — a *second* right-hand drawer, one level deeper (the right-hand analogue of the deep nav). Because the calendar is the app's main focus, it warrants this two-level right-hand stack (day → event) where Tasks need only one.

**Decided**
- **`E` = day schedule; `e` = event detail.** `e` is already "edit/detail" for tasks (and will open note metadata / the note drawer too), so `e` stays "this item's detail" and **`E`** is "this day's schedule." (`l`/`Enter` are nonstarters — `l` drives the grid/nav, `Enter` is reserved for save.) The `E`-vs-`e` split is intentional but not yet fully designed; `Shift-E` preserves it.
- **Layout.** All 24h, **scrollable**, default-scrolled to **8am** for now. All-day events pinned in a top strip. Overlapping events lay out **side-by-side in columns**, ordered **longest-event leftmost → shortest rightmost** (a containing event sits left of the events inside it).
- **Complement, not replace.** The month grid keeps its clickable event chips for the glance; the day drawer is the deep, keyboard view.

**Provisional keyboard-nav model** *(design intent — refine by feel once built; exact keys not committed):*
- **Vertical (`j`/`k`)** steps through the day chronologically by **hour slot, stopping on events** — e.g. 8–9 → 9–10 → a 10–10:30 event → the leftover 10:30–11 slot → …
- **`e`** on a focused event → its event detail drawer.
- **Multiple events in one slot → `h`/`l`**, default leftmost. Meeting 11–12 / Lunch 11:20–11:40 / Phone 11:30–11:35 → columns **Meeting | Lunch | Phone**; vertical nav lands on **Meeting** (first hit), so `j` jumps to 12–13 — reach Phone via `l` `l`.
- **Partial-overlap exception:** 11–12 and 11:30–12:30 — earliest start wins the left column (11–12 left), but `j` from the 11–12 event goes to the **11:30–12:30 event** (not 12–13). The 11:30–12 gap becomes unreachable — **accepted for now.**

**Open decisions**
- Exact key mappings + gap handling are **provisional** — felt out in-product; no further design until then.

### 4.3 Note detail drawer
A note detail drawer for **metadata** — label, folder, links — settable **without** putting links in the note body. Available on the Notes screen and **whenever you click a link to a note** (peek in place, not navigating away).

**Decided**
- **Open in place.** Clicking a note link opens this drawer (a peek), it does **not** navigate away. An explicit **"open fully"** action (**`o`**) navigates to the full `/notes` editor — you leave only by consenting. (`o` already opens a note from the notes *list* — conceptually the same action, so the overlap is fine; if it stomps, scope the cursor's area-of-effect.)
- **Shared detail editor (one component, reused).** Build **one** editor used by **task, event, and note** detail drawers, mirroring the task notes editor. Model: **render-when-not-editing / `i`-to-edit-raw** (rendered preview by default; `i` drops into raw editing, like the cursor-on-a-task's-notes-field flow today). This is **not** the §6.1 vim current-block-raw cursor — that lives only on the full `/notes` screen. **Two tiers:** simple shared editor in drawers; vim editor on the full Notes screen.
- **Task & event notes become markdown** too (long-wanted). The shared render-when-not-editing editor applies wherever a notes/body field exists.
- **Accept the markdown churn.** Existing plain-text task/event notes (stray `#`, `*`, `[ ]`, `_`) start rendering — no migration. The task quick-add already promises "markdown like notes" but never rendered it; this delivers on it.
- **Reuse `<linked-items>`.** The link section extends `frontend/js/linked-items.js` (chips + "+ link" picker) plus label + folder controls. The drawer creates/removes **app links** only; body `[[wikilinks]]` show **read-only** with the ↟ marker.

### 4.4 Deep-nav keyboard navigation
The deep-nav drawer (Tasks/Events/Notes switcher) is currently mouse-only. Make it keyboard-reachable:
- From the app nav, **`h`** at the **top of the tree** (nothing left to collapse/walk up) jumps into the deep nav.
- **`N`** (Shift-N) toggles the drawer open **and** places the cursor in it; **`j`/`k`** move between apps; **`Space`/`Enter`** switches to the app under the cursor.
- **`l`** enters the current app's nav **without** closing the deep nav (closing again = `N` twice — acceptable).

**Decided**
- **`h`-at-top** jumps to the deep nav only when there's nothing left to collapse/walk-up; otherwise `h` keeps its collapse/up behavior.
- **After switching into an app**, the cursor lands at the **top of that app's nav** — its top/default query (the §2.4 home view).
- **Same keyboard model across all three navs** — reuse the Tasks-nav model verbatim; no per-app reinvention.

### 4.5 App-nav keyboard navigation (Events / Notes navs)
**Decided:** Events and Notes navs reuse the **same shared nav/`KbForm` model** as Tasks (j/k move, h/l collapse/expand), no bespoke handling — comes mostly for free once the per-app navs exist.

---

## 5. Human-readable per-user item ids — ✅ DONE
*Shipped: `migrations/006_readable_ids.sql` + `services/readableIds.ts` (per-user, per-type, monotonic, no reuse); UUID stays canonical, readable id is display/authoring only.*
UUIDs were the right backend call but read badly in the UI — you should never see a UUID on the frontend. Each user-facing item gets a **per-user, per-type readable id** purely as a **display/authoring name** (like a note's filename → displayed title): the UUID stays the canonical key + backend link target; the readable id is what you read and type. *Its own backend slice (new column + allocation + backfill + search reindex); can slot early so everything renders readable ids from the start.*

**Decided**
- **Display-only alias; UUID is canonical.** Links/edges always store the UUID; the readable id is resolved on parse and rendered. Reassigning/re-rendering readable ids never breaks a link. No UUID ever shows in the UI or note bodies.
- **Format + prefixes.** `<type>_<NNNN>` for your own items — `p_` projects, `f_` folders, `c_` calendars, `t_` tasks, `n_` notes, `e_` events — 4 digits, **overflow widens to 5** (no re-pad). Per-user-scoped DB field; allocation **monotonic per type per user, no reuse** after delete.
- **Cross-user = username prefix.** `dev_t_0001` is dev's task 1, `admin_t_0092` is admin's task 92. Reference **your own** items bare (`t_0092`); reference someone else's (with access) prefixed (`admin_t_0092`). Username is **derived from the owner at display time**, not stored in the id field, so a username change just re-renders.
- **Parse from the right** — the `_<prefix>_<digits>` suffix is the id; everything before is the username. Safe because we control the suffix.
- **No-access = no-leak.** Referencing an id you can't access **or** that doesn't exist returns the **same generic** error — no enumeration.
- **Username-change edge accepted.** Picker-created refs store the UUID and re-render fine; a hand-typed cross-user `dev_t_0001` stops resolving after a rename — you re-type it. (Username change **does** exist in-app via the account screen.)
- **Searchable** like the old task ids (bare + accessible prefixed ids). UUID search removed.

**Open decisions / spin-outs**
- **Username validation story.** Restrict the charset to **letters, numbers, `-`, `_`** (excludes `/`, `:`, whitespace — anything that breaks parsing, DB, or vault paths). Validate **on input only — no backfill/guard** for existing names (the only two users already comply).

---

## 6. Note-editor feel + final polish

### 6.1 Note editor: cursor + navigation feel — ✅ FIRST CUT (iterating on feel)
*Shipped: `MdRender.blocks()` segments the body by markdown-it token line-ranges; normal mode renders every block except the cursor's, which goes raw under a terminal block cursor; motions `hjkl` `w` `b` `0` `$` `gg` `G` + `i`/`a`/`I`/`A` (insert reuses the full-body textarea, so the `[[` picker is untouched); always-on editor border. **Reflow feel + motion edges still to tune live.***
The note editor's presentation/navigation need work. Minimum bar: a **border around the editor at all times** (render-mode border can use the dimmer theme color). Plus a **vim-like cursor** (`hjkl`), `i`/`a`/`I`/`A` insert entries, and a **terminal-style block cursor** over characters. Most feel-dependent item here; will iterate.

**Decided — current-block-raw / rest-rendered.** Normal mode renders markdown on everything **except the block the cursor is in**; the active block shows **raw source** with the block cursor over its characters. Whole-**block** (not just one line) goes raw — a half-rendered table/code-fence reads as broken, so the enclosing construct switches as a unit. (markdown-it tokens carry line-range `.map`s — already used for clickable checkboxes — so "find the block whose line range contains the cursor" is tractable.) Reconciles 2d's "normal = rendered" with a real editable cursor. `j`/`k` move between lines/blocks (which block is raw, so the view reflows); `h`/`l` within the current raw line.

**Open decisions**
- **Reflow feel.** Swapping a rendered block for its raw source as the cursor enters/leaves shifts the view — tune so it doesn't feel jumpy (reserve height, or ease it).
- **Scope of the first cut.** Ship the high-value bit first — always-on border + current-block-raw cursor + `i`/`a`/`I`/`A` — iterate on motions.
- **How much of vim.** Just `hjkl` + insert, or word/line motions (`w`/`b`/`0`/`$`), visual mode? Define floor + someday-ceiling.

### 6.2 Note button consistency — *intentionally open (revisit once the new frontend is built out)*
The note editor has back + edit/render buttons top-right and others bottom-right; the rough intent is to consolidate **all** controls at the bottom (left: back, close · right: edit/render, delete, save). **Not deciding the layout, or back-vs-close, yet** — want to see the new frontend built out before any sweeping call.
- **Captured to fix:** the yes/no "navigate away?" confirmation buttons show **"esc" as text** instead of the **escape symbol** we use elsewhere — make it consistent.
- **Back vs close** (two buttons — back = prior context, close = notes list — or collapse to one `Esc`) and the final button order/glyphs: **deferred.**

### 6.3 Enter-to-save + `↵` sweep — ✅ DONE
Adopted globally in 2d; this sweep catches stragglers across every save UI. Largely mechanical.

### 6.4 Keyboard + mouse accessibility audit — ⬜ THE ONE REMAINING BUILD ITEM
Wire the shared `KbForm` model (`KEYBOARD_FRAMEWORK.md`) into **every** module and modal so the high-level 2d keyboard wins extend to consistent coverage everywhere. **Approach:** build keyboard-first **per feature** as each lands above, then a short **final audit** here to catch gaps (rather than one big bolt-on sweep).

### 6.5 Notes list/detail layout polish — ✅ DONE
*Shipped: `listNotes` + `NoteListItemSchema` now return `labels` + `createdAt`; rows render title, labels beneath, created/edited dates on the right.*
Lay out the notes list/detail like tasks: title with **labels beneath**, created/edited dates on the right. Overlaps with the notes-tags + note-drawer work — likely lands with §4.3 / §2.3 rather than standalone.

---

## Completed

> Per-section status now lives **inline** on each heading above (with a one-line record of what shipped). This section keeps the long-form build record for §3.1, whose scope changed enough during the build to be worth writing down.

### §3.1 — App-type selector + the `type:` rule ✅
Built at the **"live mixed results"** scope, which also delivered §3.2's inline cross-type rendering early.

*Original design (for the record):*
- **Chip → predicate.** The builder emits `type:<types>` only when ≥1 chip is selected; no chips → no `type:` term.
- **Default semantics (changed).** No `type:` term → **all item types**; explicit empty `type:` → **return nothing**; never fall back to tasks. Intentionally breaks the old `no type: → tasks` default; saved queries get hand-updated (add `type:task`).
- **One word: "query."** Chip builder + raw box are one language; "filter" retired as user-facing vocabulary (`STYLE_GUIDE.md` §12). **Query ≠ search** (search = throwaway live text find).

*Implemented:*
- **Backend** `server/src/services/unifiedQuery.ts`: no-type→all, empty-type→nothing, no task fallback. Tests updated/added in `server/test/unified-query.test.ts`.
- **Query builder** `frontend/js/query-bar.js`: additive `type` chip group (tasks/events/notes) collapsed to one comma-joined `type:` term (`toggleType`/`hasType`).
- **Mixed results** `frontend/js/mixed-list.js` (new) + `store.isMixedView()`/`queryTypes()`/`taskQuery()` (`data.js`): the Tasks screen renders mixed items (deep-nav type icons) via the server unified endpoint when `type:` spans beyond tasks; pure task / no-type / project keep the instant client `Q.run` path. Act-on: task → detail, **event → editor popup, note → full Notes nav** (§4 drawers will replace these). `type:` is stripped before client `Q.run`, so the parity engine stays frozen (no `query.ts` change, no golden regen).
- **Rename** filter→query, user-facing **and** internal (`focusPane:'query'`, `enterQuery`/`exitQuery`/`toggleQueryFocus`/`queryKey`; help-modal tab + lines; `⊞ query` button + tooltip). Fixed the pre-existing `enterQuery` focus-row nit (`status`→`type`).
- **Verified:** 360 server tests (incl. parity) + tsc + lint green; live curl smokes on :3001 (no-type→mixed, empty-type→0, `type:task,note`→scoped, `type:even`→400).
- **Carryover:** §3.2 now only needs the per-app query bar on the Events/Notes *screens* + auto-default `type:<app>` + saved-query routing; §3.4 (global `/` search) still pending. Per-type result-format polish deferred.
