# Filter "Status" section — keep or fold into Due? (t_621)

> Status: **analysis + recommendation for review.** No code written yet.

## The question
Your note: most of the filter builder's **Status** options look like they're already expressible via
**Due**, so the Status section may be redundant. Second set of eyes on that — and if it goes away, how to
do it **without losing functionality**.

## What each actually does (from `query.js`)
The builder offers Status chips `open · done · overdue · today` and Due chips
`today · tomorrow · overdue · ≤7d · <3d · no date · has date · M/T/W/R/F/S/U`.

| Status chip | engine meaning | Due equivalent? |
|---|---|---|
| `status:open`    | `!done` | ❌ Due is date-only — no completion concept |
| `status:done`    | `done`  | ❌ same |
| `status:overdue` | `!done && dueDelta<0` | ⚠️ `due:overdue` = `dueDelta<0` **but ignores done** |
| `status:today`   | `!done && dueDelta===0` | ⚠️ `due:today` = `dueDelta===0` **but ignores done** |

**The one real difference:** Status *bundles "not done" into the date condition.* Due is purely about the
date and includes done tasks.

## Why that difference mostly evaporates in practice
The list already has a global **"☑ completed"** toggle (`store.showCompleted`, the `c` key). With it
**off** (the default), `visibleRoots` filters out done tasks unless the query says `status:done`/`is:done`.
So in normal use:
- `due:overdue` and `status:overdue` show the **same** rows (done are hidden anyway).
- `due:today` and `status:today` likewise.

The bundling only matters when completed are *shown* — a rare combination ("show me overdue, including the
ones I already finished").

So the redundancy is real:
- **`overdue` / `today`** → fully covered by **Due** (+ the completed toggle handling done/open).
- **`open` / `done`** → this is the completion dimension, and it's already owned by the **completed
  toggle**. (`done` is *also* available as `is:done`.)

**Net: all four Status chips are redundant with "Due + the completed toggle."** Your instinct holds.

## Recommendation — fold it, one clean move
**Remove the Status *section* from the filter builder** (`query-bar.js navGroups`), and let the two
dimensions live where they belong:
- **Dates** (today / overdue / windows / comparisons) → the **Due** section (already does this).
- **Completion** (open / done) → the **completed toggle** in the list head (already there, more
  discoverable than a filter chip).

**Keep the `status:` token in the engine.** Don't touch `query.js`'s `case 'status'`. Reason: the seeded
saved views lean on it (`sv_open=status:open`, `sv_overdue=status:overdue`, `sv_today=status:open due:today`,
etc.), and `status:open` in a view means "always open-only, regardless of the global toggle" — a genuine
function. Raw-query power users keep it too. We're only removing the **builder chips**, not the syntax.

### The one gap, and how to not lose it
Removing the chips removes the *only* UI way to express **"done only"** and an explicit
**"open-only that survives toggling completed on."** Both are rare, but to lose nothing:

- **Make the existing completed toggle 3-state** instead of 2: **hide done → show all → done only**
  (cycling on `c` / click). That single control then covers `status:open` (hide done), `status:all` (show
  all), and `status:done` (done only) — exactly the completion axis, where users already look. This is the
  recommended replacement: it *removes* the redundant Status section **and** strictly adds the one thing
  the toggle couldn't do before (done-only).
- (`is:done` / `status:done` remain typeable for anyone scripting a query.)

That's the "one way" answer: **Due owns dates, the (now 3-state) completed toggle owns completion, the
`status:` syntax stays for saved views.** Nothing is lost; the builder gets simpler and less confusing.

## Smaller alternative (if you don't want to touch the toggle)
Just delete the Status section and accept that "done only" is a raw-query / saved-view thing. Lower effort,
loses only the UI affordance for an uncommon filter. The 3-state toggle is the strictly-better version.

## Open decisions
1. **Go ahead and remove the Status builder section?** (Engine token stays — saved views unaffected.)
2. **3-state completed toggle** (recommended, loses nothing) vs. plain removal (done-only becomes
   raw-query only)?
3. Any attachment to the *bundled* `status:overdue`/`status:today` semantics when completed are shown? If
   yes, that's the only thing the fold changes — otherwise it's invisible.

## Verification (once decided)
- Builder no longer shows a Status group; Due + the completed control reproduce every prior filter:
  open (hide-done), done-only (toggle/3-state), overdue (`due:overdue`), today (`due:today`).
- All **seeded + user saved views** that contain `status:…` still parse and return identical results
  (token untouched). Reload a `status:overdue` view → same rows as before.
- (If 3-state) `c` cycles hide→all→done-only; the list head label reflects the state.
