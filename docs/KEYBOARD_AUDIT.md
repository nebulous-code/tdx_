# Keyboard Audit

Some notes about keyboard accessiblity for section 6. (2E §6.4 — the final keyboard/mouse pass.)

> **IDs:** `n.*` notes · `e.*` events · `t.*` tasks · `a.*` all-apps. Cross-references use those ids.
> Claude's assessment + the order of attack live at the bottom under **Triage**.

## Status
**Batch 1 shipped and passed testing** — 11 items (**n.2** `o`/`O` · **n.3** the unified ladder · **n.4** list continuation · **n.5** `r` replace · **n.6** checkbox styling · **n.7** wikilink clicks · **n.8** the `o|pen` gap · **n.9** `h` → notes nav · **n.12** `dd`/`D`/`dw` · **a.1** header count spacing · **e.2** the event drawer not switching), plus **n.1** closed as standard markdown behavior. Each section's **Resolved issues** subsection holds them, in their original order — collapse those to see only what's outstanding.

Also resolved along the way: **2E §6.2** (note button layout). One `back ⎋` control replaced the header's `‹ back` **and** the bottom-right `close` — they had never actually been different (both called `closeEditor()`) — and every editor control now lives in the bottom action row as a ladder rung.

**Behavior change now live:** **`d` in the note body no longer deletes the note** — it's vim's operator prefix (`dd`/`dw`). Delete-the-note lives on the **field rows** and in the **notes list** (see **n.12**).

**Batch 2 shipped and passed testing** — **e.1** (grid/list toggle; `display` as view metadata; occurrence-level date filtering) and **e.5** (the grid obeys the `type:` rule — which gave **tasks a calendar view** for free).

**Batch 3 shipped** — **a.3** (the ⊞ query button never revealed save/update/clear), **a.4** (the quick-add ⚠ fired on every default task view), **a.5** (`h` in the query builder now reaches the app nav). Plus query-bar polish: clear is now **`c`** (not `x`), the toggle's label carries its state (**`query`** ⇄ **`hide Q`**) instead of a glow, and the buttons are text-only with underlined shortcut letters.

**Still outstanding:** **n.10** + **e.3** (the `h`-at-the-edge nav model — needs your call on the calendar edge-rule) · **n.11** (design open) · **n.13** (links have no keyboard model) · **n.14** (`i` → new note) · **n.15** (notes search — a surface question first) · **e.4** (`t` → today; written up, not built) · **a.2** (the capstone — **unblocked**: event views now have a list to navigate).

## notes

**n.10 — Bug: collapsing View/Calendars/Folders/Projects/Labels doesn't work with `h`.** Instead I get put into the deep nav menu. I can still collapse those areas with space. I'd like to hit `h` and collapse the area then land in the deep nav if I want to by hitting `h` again. This keeps the `h` to collapse functionality we have in prod today. If someone wants to quick access the deep nav we support `N` to get there so this is collapsing is a more natural flow for users.
> *This is a **regression against the §4.4 spec**, which already says `h` jumps to the deep nav "only when there's nothing left to collapse/walk-up." The implementation is jumping too eagerly. Same family as **n.9** / **e.3**.*

**n.11 — Feature: navigate wikilinks with keyboard.** Not sure how I want to implement this. Right now you've got to click any imbedded wikilinks with a mouse. Open to ideas on how to get this one done.
> *Depends on **n.3** (there's no in-note field/nav ladder to hang link-hopping off of yet) and on **n.7** (links have to resolve before they're worth navigating to). Ideas in Triage — no decision needed now.*

**n.13 — Nav gap: the `links` section can't be navigated (GENUINE DESIGN GAP, not a wiring miss).** Found while testing **n.3**. `linked-items.js` — the component shared by the task, event **and** note detail surfaces — has **no keyboard model at all**: no cursor over the link chips, no way to open a linked item or unlink one. The only keyboard affordance is the `+ link` picker input (which the n.3 ladder now focuses). It has always been mouse-only; the ladder just made that visible.
> *The fix is a **nested KbForm sub-pane**, exactly like the task drawer's recurrence builder: `l`/`i` on the links row descends into it, `j`/`k` walk the chips, Enter/space opens the linked item, `x` unlinks, `h`/`Esc` pops back out to the host ladder. Because the component is **shared**, doing this once fixes links in the task and event drawers too. That's real work, not a patch — sizing it as its own item rather than smuggling it into the n.3 batch. **Depends on nothing; can go anytime.***

**n.14 — Bug: `i` doesn't create a new note from the notes list.** I'd like to mirror the way you add new tasks on the tasks screen. Right now you have to click the `＋ new` button to create a note; `i` would be much easier.
> *Straightforward and consistent: `i` is already "create" on the tasks list (`index.html`), and the notes list is the one list where it does nothing. `newNote()` exists and the `＋ new` button already calls it — this is a binding, not a feature. Note it lands you in the **title** (a note needs a name before it can be written to the vault), which is the one way it differs from the task list's inline quick-add.*

**n.15 — Nav gap: the notes list's own search box can't be reached by keyboard.** The global `/` find works, but the notes screen's search input — which searches within the current folder/list — is mouse-only. Not sure how I want to handle this yet.
> *Real gap, and it needs a small design call first — the notes search box is a **third** search surface alongside the global `/` find and the query bar (`q`), so the question is which key owns it without stomping the other two. Options: give the notes list its own focus key, or fold folder-scoped search into the existing query bar (`folder:` is already a query field) and retire the bespoke box. **No code until you decide.** Related: **e.1** (the other "what is this surface for" question).*

### Resolved issues

**n.1 — Bug: view mode does not show line breaks while insert mode does.** Example in Pragmatic Programmer highlights note. There's a line break between "design." and "See also" when I'm in insert mode but view mode shows them all on a single line. I think this is a single line break versus double line break issue. Let's discuss before you implement a fix so I can understand it better.
> *Root cause is known and cheap to explain — it's a one-word markdown-it option (`breaks: false`), not a bug in our code. Related: **n.4** (both are about how source lines map to rendered output). Discussion below in Triage.*
> Response. Great now that I understand that's just how markdown is I'm willing to accept it. No code change needed here.

**n.2 — Feature: `o` and `O` in vim style.** `O` opens a line above the cursor and `o` opens a new line below the cursor.
> *Same family as **n.5** (`r`) — both are normal-mode editing operators on top of the §6.1 block cursor.*
> **✅ RESOLVED**
> **How to test:** open a note, `Esc` to nav mode, put the cursor on a line. `o` → a new empty line **below**, dropped into insert. `O` → same **above**. Type, then `Esc`.

**n.3 — Nav issue: no way to access the Title, Folder, or links below the text field.** Escape sends you back to the notes list.
I would like this to work similar to how inserting notes works on the task detail pane. Basically when you shift+enter create a note you get dropped into the note field in insert mode. If you hit escape it lets you keyboard nav around the task detail and insert to edit any metadata. Escape again will drop you into the task list.
Same flow applies here. Enter on a note in the note list (view or folder) drops you into the nav mode of the note (different from task's insert because task down have keyboard nav on text). Escape will let you nav around the fields with `i` letting you edit them. Escape while naving fields sends you back to the view/folder/label list that you came from.
Make sure we're reusing our generic field navigation logic for this. It's why we wrote it.
> *The biggest item in this document. **n.11** and **a.2** both depend on it, so it lands before them.*
>
> **DECIDED (design settled — ready to build).** The note **body's lines are rows in the ladder**, not a separate mode you enter. One continuous vertical nav; three states total, not four:
>
> ```
> insert  ──Esc──►  nav  ──Esc──►  notes list
> (typing)      (walks fields AND body lines)
> ```
>
> **The ladder, top to bottom:** title · folder · labels · review date · **every line of the body** (block cursor) · links · save · delete.
> - `j`/`k` walk the whole thing — stepping off the review-date field lands on body line 1; stepping off the last body line lands on links.
> - `i` edits whatever the cursor is on: a field, or insert-at-cursor in the body.
> - `Esc` from insert → nav. `Esc` in nav → back to the view/folder/label list you came from (dirty-check via the existing `kbDirty`/`askConfirm`).
> - `Enter` from the notes list lands the cursor on **body line 1** (the common case — reading/editing the text; `k` up a few rows for metadata).
> - **Long notes:** `G`/`gg` (already built, body-scoped) are the escape hatch — `G` then `j` exits out the bottom, `gg` then `k` out the top. No new key. Revisit if it bites.
> - **Scope addition:** labels + review date must be **added to the full notes screen** (they exist only in the note peek drawer today). Reuse the drawer's markup — the save path already carries both.
>
> *Why this is smaller than it looked: the fields (title/folder/links/save/delete) are **already rendered** on the notes screen — they're just unreachable. And `notes.js` is the one module that never adopted `KbForm`, so the work is "make the note editor a KbForm citizen," which is exactly the generic-field-nav reuse asked for. `KbForm` already supports a row that owns its own keys (`kbDelegate` + `kbAutoListen:false`) — the task drawer's recurrence sub-pane is the working precedent to copy for the body rows.*
>
> **`d` — DECIDED: context-sensitive by row.** `d` can't be both "delete note" and vim's operator prefix (a single `d` fires the delete confirm before a second key can arrive), so it splits by where the cursor is:
> - **body line** → vim operator (`dd`, `D`, `dw` — see **n.12**).
> - **field row** (title/folder/labels/review/links/buttons) → delete the note. This is the exact task parallel: tasks bind `d` while KbForm-naving the detail (`index.html:536`), not while typing in a field.
> - **notes list** → delete the note. Currently unbound there (`j`/`k`/`Enter`/`o` only); adding it makes note deletion mirror task deletion — one key, from the list, where you'd naturally do it.
>
> *Cost to accept: `d` inside the body no longer deletes the note, so it will surprise you once if that's already in your fingers.*
> **✅ RESOLVED**
> **How to test:** from the notes list press `Enter` — you land on **body line 1** (block cursor). Now `k` walks **up** out of the body → review date → labels → folder → title; `j` walks back down through the body and off the bottom → links → save → delete. `i` edits whatever you're on (a field, or insert-at-cursor in the body); `Esc` returns to the ladder. `Esc` on the ladder → back to the notes list (with a discard prompt if dirty). `Enter` anywhere = save. Labels + review date are **new on this screen** — set them here and confirm they persist (and that they still match what the peek drawer shows).

**n.4 — Feature: continue lists on Enter.** It'd be nice if bulletted lists and numbered lists inserted a bullet/number at the same indention level if you hit enter on a bulletted row. Basically the logic would be: if the first non-whitespace character is a `-`/`*`/`#`. then the new line will inherit the white space and the bullet leader or increase the number if it's a number.
> *Insert-mode behavior; independent of the normal-mode operators (**n.2**, **n.5**). Related to **n.1** only in that both concern markdown source semantics.*
> **✅ RESOLVED**
> **How to test:** in insert mode, `Enter` at the end of `- eggs` → `- `; `3. third` → `4. `; `- [ ] todo` → a fresh **unchecked** `- [ ] ` (a checked `- [x]` also continues unchecked); indentation is preserved. `Enter` on an **empty** leader ends the list (strips it). Headings are deliberately **not** continued.

**n.5 — Feature: `r` for vim style replace.** Basically if you're in nav/normal mode and you hit `r` the next key replaces where your cursor is with the key you pressed. Super helpful for updating checkboxes in place.
> *Pairs with **n.2** (normal-mode operators) and is the keyboard counterpart to the click-to-check behavior discussed in **n.6**.*
> **✅ RESOLVED**
> **How to test:** in nav mode, put the cursor on the space inside `- [ ]` and press `r` then `x` → `- [x]`. `r` + any key replaces the character under the block cursor.

**n.6 — Bug: styling of `- [ ]`.** I'd be interested in what we could do with this. Right now it looks like it's just a default interactive checkbox. this might be necessary because I do want the clicking to check functionality to work on notes. However it looks a little out of place. If we could figure out how to style it with the default system colors that would be ideal. The checked state looks good and on brand so if we could inherit some style from that it'd be nice.
> *Pure CSS — the click-to-toggle behavior does **not** depend on the native checkbox appearance, so we can restyle it freely. Related: **n.5** (toggling the same checkboxes from the keyboard).*
> **✅ RESOLVED**
> **How to test:** open a note with checkboxes — the unchecked box should now be a brand-amber outline (not the OS widget), the checked state amber-filled with a tick. **Clicking still toggles** (that behavior was untouched).

**n.7 — Bug: task linking doesn't work on notes via clicking.** On the Standup notes file the first line has `[[t_0009]]` at the end of it. When I click on it I get the error that the note is not found. I suspect this is because it's only searching for notes and this is a task. The Links under the note text area does successfully link the task and clicking that works just fine so I suspect this is either something about how the link is inserted into the text area. This may not be a code bug but a note creation bug. Look into it but don't make any code changes until we understand the root cause.
> ***Your diagnosis was exactly right, and this is already fixed in the working tree*** *(uncommitted, from the readable-id sweep). Root cause: the frontend markdown renderer had no concept of readable ids, so `[[t_0009]]` fell through to the "note by name" branch and searched notes **by title** → "note not found." Nothing wrong with the note or how the link was inserted — the **backend** resolved it correctly all along, which is why the Links section worked. The renderer now recognizes readable ids, resolves them through the store, and hands the click the real uuid. **Needs your smoke test to confirm.** Related: **n.11** (keyboard access to these same links).*
> **✅ RESOLVED**
> **How to test (was already fixed, never smoke-tested):** open the Standup note and click `[[t_0009]]` — it should open that **task's** drawer, and render as the task's **title** rather than the raw id. Titles resolve live, so renaming the task re-renders the link.

**n.8 — Bug: gap between "o" and "pen" in the `open fully` button** on the right-hand drawers. This is likely an artifact of the o being underlined, we see this often so it should be fixed not to have the gap.
> *Cosmetic, and it's the shared accesskey-underline pattern (`<u>o</u>pen`), so the fix applies everywhere we underline a hotkey letter — not just this button. Same cosmetic bucket as **a.1**.*
> **✅ RESOLVED**
> **How to test:** open a note's peek drawer — the `open fully` button should read cleanly with no gap. (Root cause was `.btn`'s flex `gap`, not the underline: `<u>o</u>` and the loose text were two flex items. Every other button already wrapped its label; this was the last one.)

**n.9 — Bug: can't get to the notes nav (left-hand drawer) with `h`** when navigating a list of notes. Landing in there with `n` works fine but I'd like to be able to get in there with a normal `h` nav like I can with tasks.
> *One of the three "`h` at the edge" items: **n.9**, **n.10**, **e.3**. Fix them together as one model, not three patches.*
> **✅ RESOLVED**
> **How to test:** from the notes **list**, press `h` → the notes nav takes focus, same as `h` from the task list. (Only the list — inside the editor `h` is still a cursor motion.)

**n.12 — Feature: vim delete operators in the note body (`dd`, `D`, `dw`).** None of these exist today — the body's normal mode has exactly one `d` binding (delete the whole note). `dd` deletes the current line, `D` deletes from the cursor to end of line, `dw` deletes a word forward.
> *Spun out of the **n.3** `d` decision, which frees `d` in the body to act as an operator prefix. Same family as **n.2** (`o`/`O`) and **n.5** (`r`) — all normal-mode operators on the §6.1 block cursor, and all cheap once the first one establishes the pending-key pattern (the `gg` `pendingG` flag is the existing precedent). **Depends on n.3** (the row-context split is what makes `d` available at all).*
> **✅ RESOLVED**
> **How to test:** in nav mode, in the body: `dd` deletes the line · `D` deletes cursor→end of line · `dw` deletes the word forward. **`d` no longer deletes the note while you're in the body** — it deletes the note from a **field row** (title/folder/labels/review/links/save/delete) and from the **notes list**. This is the one thing likely to surprise your fingers.

## events

**e.3 — Feature?: `h` doesn't reach the events nav** — the only way to get to the events nav lh drawer is by hitting `n`. In other apps like tasks and notes you can hit `h` and it puts you in the app nav drawer. However `h` on this one navigates you to the previous day, that makes sense. `H` will switch your month which is also desired. I'm not sure if I want to part with that functionality to make it consistent or just say "calendar/events are different and you've got to use `n` to get there." Open to suggestions on how to fix this. No code change for this one quite yet.
> *The genuine conflict in the "`h` at the edge" family (**n.9**, **n.10**). A suggestion is in Triage — the grid gives us a natural edge to work with.*

**e.4 — Feature: shortcut to today.** It'd be nice if you could jump to today with the `t` key. Assuming it's not already bookmarked for something. We should underline the `t` in the today button next to the month name and year in the header. Maybe make that today button look more like a button in our style.
> *`t` is **completely unbound** — nothing global, nothing in the calendar's key map (`h/l/j/k` · `H/L/J/K` · `i` · `E` · now `v`). So it's free, and `cal.today()` already exists (the button calls it). This is a **binding + a restyle**, not a feature. Small enough to ride along with anything. Note the button underline must wrap its label in a single element — a bare `<u>t</u>oday` next to loose text hits the `.btn` flex-gap trap from **n.8**.*

### Resolved issues

**e.1 — Feature?: think deeply about how the views in the event screen work.** Right now the calendar specific queries don't seem to do anything. Realistically I don't think they should show the calendar view and it might be worth showing it as a list. No decision on this quite yet but I'd like you to look into what/how the code works today and then I can decide what direction we want to go.
> *Blocks **a.2** — mixed-list `j`/`k` can't be finished while event-only views have no list to navigate. This is a **design decision first, code second**.*
>
> **How it works today (investigated — nothing was documented; `calMatchIds` appears in no design doc).** A query on the events screen **filters the grid; it never replaces it.** `calendar.js` runs the query through the unified engine and keeps the matching event ids in `store.calMatchIds`; the grid then draws only events in that set. The **server side is fine** — against the dev DB: `type:event` → 8 · `due:this-week` → 5 · `due:this-month` → 8 · `due:next-month` → 5 · `due:last-week` → 3.
>
> **The grid filters but never *moves*, and it only ever fetches the visible month** (`calendar.js` `load()` → `range`). So:
> - **"this month"** → filters a month grid to that same month: a **literal no-op**.
> - **"next month"** → the matches were never fetched; you get a **silently empty current month**.
> - **"this week" / "last week"** → the only ones that visibly do anything, and they read as a bug rather than a filter.
> - Side effect: while any query is active, **dated tasks vanish from the grid** (`calendar.js:49`, `day-detail.js:33`).
>
> *Diagnosis: the seed views and the filter mechanism were **designed past each other**. A calendar grid **is already a date filter** — the month you're looking at — so a **date-range** query fights it and the grid always wins (it controls what gets fetched). Note what does work: **non-date** predicates (`calendar:`, `label:`, `category:`) narrow the grid meaningfully, because they filter along an axis the grid isn't already filtering.*
>
> **DECIDED — grid/list toggle, with display as VIEW METADATA (not a query term).**
> - **`display` becomes a column on `saved_queries`** (`auto | grid | list`), sitting alongside `glyph` / `color` / `pinned` — which are *already* presentation metadata. The **query language never learns the word "list"**: a `view:list` predicate would drag presentation into the parity-locked engine (`query.ts` ≡ `query.js` + goldens), where it's meaningless for tasks and notes.
> - **The query bar stays generic** — it gains no grid/list control. The **toggle lives on the events screen** (header, by the month nav — like the notes editor's edit/render toggle), plus a key.
> - **Persisting needs no new UI:** flip the toggle → press **`u`** (Update-in-place, §1) → that view opens that way from then on. Same mechanism as editing a view's query text.
> - **`auto` (the default) infers:** a **date-range** predicate → **list**; anything else → **grid**. Toggle + `u` pins an explicit override. Sensible out of the box, never a cage.
> - **Seeds:** the date-range event views (this week / this month / next month / last week) resolve to **list** — which is exactly what stops them being no-ops.
> - **Ad-hoc (unsaved) queries** use the screen's current mode. Nothing to store.
>
> **Fix required regardless of the toggle:** in **grid** mode a date-bounded query must **move the grid to the range** instead of filtering into emptiness — otherwise grid mode stays broken for exactly the queries you'd most want in it ("next month" → blank current month).
>
> **THE DEEPER BUG (found while testing the first cut — the grid still looked unfiltered).** The unified query matches **SERIES**; the grid draws **OCCURRENCES**. Filtering the grid by matched-**id** therefore *cannot express a date range*: a weekly standup that matches `due:this-week` puts its id in `calMatchIds`, and then **all 17 of its July occurrences stay on the grid**. Measured against the dev data for `due:this-week`: the id-only filter drew **62 of 66** occurrences — which is why it read as "no filtering at all," since the recurring events that dominate the grid were exactly the ones surviving intact. This is the same series-vs-occurrence line `2D_APP_SHELL.md:28` drew ("the unified query is series-only → … **not the grid**").
>
> **DECIDED: grid + date query = filter to the matching OCCURRENCES** (not merely navigate). Two composed passes:
> 1. **series-level** — `calMatchIds`, as before (handles `label:` / `calendar:` / `category:` / text).
> 2. **occurrence-level** — the query's `due:` terms evaluated against **that occurrence's own date**, via `Q.evaluate` on the client. No new date interpreter: it's the **same `due:`→occurrence mapping the server already does** (`*AsTask` in `unifiedQuery.ts`), reusing the parity-locked engine.
>
> Composed, they narrow exactly: `due:this-week` now draws **13 of 66** occurrences — the standup keeps only Jul 13/15/17, and Pay rent's Jul 1 correctly disappears. Applied to **both** the month grid (`calendar.js`) and the day-schedule drawer (`day-detail.js`), which had the same bug.
>
> *Cost is small, and it **feeds** the capstone rather than competing with it: the event list is `mixed-list` scoped to events — the component **a.2** already wants to generalize. Backend: one column + migration, threaded through the saved-query service **and** the Fastify response schema (the usual strip-trap).*
> **✅ RESOLVED**
> **How to test:** **Events** still opens on the **calendar** (`type:event` has no date predicate). Pick a date view (**This week / Next month**) → it now renders as an **agenda list** instead of doing nothing. Press **`v`** → back to the grid; a date query now **filters to the matching occurrences** (a weekly standup keeps only the days inside the range) and **jumps the grid** to the range if it's off-screen. Non-date views (`calendar:`, `label:`) stay grids, as they should. On one of *your own* saved views, `v` then `q` `u` pins the choice permanently.

**e.2 — Bug: clicking a second event doesn't switch the right-hand drawer.** When I click on a view like "Everything Work" which returns multiple event items. Clicking on the first event shows the event detail in the right drawer. Clicking a second event does not switch/change the event details that appear in the drawer. This isn't acctually accessible on the events screen, but it shows up in tasks and notes screen whn you select a view that returns multiple items. This does not seem to be a problem with the notes or tasks, they switch/change propperly. This is specifically a mouse only issue, keyboard nav forces you to close the drawer before switching tasks which is fine.
> *Root cause is almost certainly structural and small: the event drawer snapshots the event into a local form object **once, in `data()`**. While the drawer stays open, Vue doesn't re-run `data()`, so a second click updates the store but not the form. Tasks/notes don't have this problem because they read the item reactively instead of snapshotting it. Cheap fix (force a re-mount per event, or watch the selection).*
> **✅ RESOLVED**
> **How to test:** open a view returning several events, click one (drawer opens), then click another — the drawer should now switch to the second. (The drawer snapshotted the event in `data()`, which Vue won't re-run while it stays open; it's now keyed by event id so it remounts.)

**e.5 — Bug: dated tasks on the calendar ignore the `type:` rule (and the query entirely).** Tasks should be filtered out altogether if the query doesn't select tasks. If tasks ARE selected they should respect the calendar/list view (rendered as they are today — no special treatment, just make the queries respect them).
> *Confirmed, and it's **wrong at both ends**. The grid decides tasks by whether **any predicate exists**, never by `type:` (`calendar.js` `tasks: this.store.calMatchIds ? [] : …`; same in `day-detail.js`):*
> - *Default events view is `type:event` → no predicate → `calMatchIds` null → **tasks show anyway**, though the query says events only.*
> - *Add any predicate (`due:this-week`) → **tasks vanish entirely**, even if you wrote `type:task,event` and explicitly asked for them.*
>
> *The task overlay is from D2 2a ("the calendar co-displays events and dated tasks") and **predates the `type:` rule** — it was never brought under it. Note the "settle-for" fallback (**no calendar when tasks are selected**) is already today's behavior by accident: `type:task,event` trips `isMixedView()` and renders the list instead of the grid.*
>
> **DECIDED — the grid obeys the same `type:` rule as everything else:**
> - **Tasks draw on the grid iff the query's types include `task`** (or there's no `type:` at all = everything). Not "iff no predicate exists."
> - **When they draw, the query filters them** (matched task ids from the same unified query) instead of the current all-or-nothing.
> - **Grid mode is available while every requested type is *dateable*** — `task` and `event` both have dates and sit on a grid fine; **`note` cannot**, so any query including notes falls back to the list. A principled line, rather than "tasks force a list."
> - Tasks keep their current rendering on the grid (the small chips under a day's events).
>
> **Consequence — this gives TASKS a calendar view for free.** Once the grid honors `type:`, "show me my dated tasks on a calendar" is just `display:grid` on a task view. So the grid/list toggle (`v`) moves onto the **tasks screen's `{view title} › {query}` row** too, mirroring the events header. The `auto` default stays app-native: **tasks → list**, **events → grid** (unless it's a date-range query, per **e.1**). The two-pass filter from e.1 already accepts this without change.
> **✅ RESOLVED**
> **How to test:** the **Events** calendar no longer shows task chips by default (`type:event` = events only). A **`type:task,event`** query draws **both** on the grid. On **Tasks**, `v` gives you a calendar of your dated tasks — **Today** draws only today's, **Open** draws all open dated ones — and `i` on a day there creates a **task** due that day (not an event). A query touching **notes** can't be a grid, so it falls back to the list.
>
> *Post-test fix: the task filter originally used an **async server match-set**, and "no set yet" had to mean "no filter" — so the grid painted **every** dated task until the fetch landed, which on the Tasks screen was the first thing you saw. Tasks never needed the server (only events do, for recurrence expansion): `taskShows` now evaluates each task **synchronously** through the **same client engine the task list uses**, so the grid and list can't disagree, and the first paint is already correct.*

## tasks
*(none yet)*

## all

**a.2 — Bug: `j`/`k` don't work on mixed item lists.** It seems to still work as designed in task only views. Event only views don't seem to display as lists (see **e.1**) and notes open the note in full screen instead of a rh side drawer. However mixed lists show all items and should be navigatable through `j`/`k` to switch detailed items without closing the rh side bar. Let's make sure we write this in a way that doesn't duplicate the existing logic that works for tasks and find an intelligent way to implement this so we don't have duplicate code. We should resolve this after we're happy with keyboard nav for notes and events.
> *Agreed on the sequencing, and it's the right instinct: this should be the **generalization** of the task-list cursor, not a second copy of it. Depends on **e.1** (events need a list) and **n.3** (notes need the drawer/ladder). Do it last — it's the capstone that proves the model is actually shared.*

a.3 Bug: the view list screens pop you back to the Tasks app if you select an everything list. I would prefer if it kept you in whatever app you're currently in. This would apply to situations where we've searched 2/3 of the types as well. 

### Resolved issues

**a.1 — Bug: no space between the count and the view title in the header.** The header view/query counts like open overdue urgent appear as `13open | 10overdue | 2urgent`. Look into the root cause here don't auto fix it.
> ***This one is mine, and recent.*** *When I gated the count badges (so event/note views don't show a bogus `0`), I wrapped the count in a `<template v-if>` and left the separating space **inside** it — Vue's whitespace condensing then drops that trailing space. Fix is to own the spacing in CSS/markup rather than rely on a text-node space. Same cosmetic bucket as **n.8**.*
> **✅ RESOLVED**
> **How to test:** look at the header — `13 open │ 10 overdue │ 2 urgent`. (My regression: the separating space was a whitespace-only text node inside a `<template v-if>`, which Vue drops at compile time. It's now folded into the interpolation.)

**a.3 — Bug: the ⊞ query button doesn't reveal save / update / clear.** Long-standing. Clicking the query button in the top right opens the builder but shows none of the save/update/close controls — you have to use the `q` shortcut to get them.
> *Root cause: **the mouse and the keyboard were two different implementations of one action.** The button's click handler was a raw state flip, `store.builderOpen = !store.builderOpen` — it opened the builder **panel** but never set `focusPane`. The save / update / clear controls are gated on `focusPane==='query'`, so for a mouse user they could never appear. The `q` key instead calls `enterQuery()`, which sets **both** `builderOpen` **and** `focusPane`, plus seeds the pane's keyboard cursor.*
> **✅ RESOLVED**
> **How to test:** click the **⊞ query** button (any app) — the builder opens **and** `★ save`, `⟳ update` (on one of your own views) and `x` appear, exactly as if you'd pressed `q`. The pane also takes the keyboard, so `s` / `u` / `x` work immediately. Clicking ⊞ again closes the builder and hands the keyboard back to the list.
>
> *Fixed by giving the button **one path**: it now emits `toggle-query`, which the app routes through the same `enterQuery()` / `exitQuery()` the `q` key uses. Closing also collapses the panel — `exitQuery()` alone would have left the builder open with its buttons gone, which is the same class of mismatch as the original bug.*

**a.4 — Bug: the quick-add ⚠ warning fires on every default task view.** The "filter parameters will cause new tasks to land outside the filter" warning shows on **Today / Open / This week** — views where it makes no sense. Seems new.
> *It **is** new, and it's mine. `store.viewWarn()` flags any term whose field isn't in `APPLIED_FIELDS` (`project` · `label` · `status` · `due`) — the fields a quick-add can actually apply to a new task. **`type:` isn't in that set**, and the §3.1 cleanup added **`type:task` to every default task view** — so they all lit up. But a brand-new task **is** a task: it satisfies `type:task` automatically, exactly like it satisfies `has:no-labels` (which was already exempt).*
> **✅ RESOLVED**
> **How to test:** the quick-add prompt on **Today / Open / This week / Overdue** shows `+`, not `⚠`. It still warns where it should: free text (`groceries`), unappliable fields (`priority:high`), a negated `-type:task`, or an events-only query.
>
> *Fixed by exempting terms a new task already satisfies: non-negated `has:no-labels`, and a non-negated `type:` whose token list includes `task`. Negations (`-type:task`) still warn, since those genuinely would exclude the new task.*

**a.5 — Bug: `h` in the query builder doesn't reach the app nav.** Legacy, and independent of the calendar question.
> *The query pane was the one place that never got the **"h at the edge"** rule. `h`/`l` there are KbForm cell moves across the chips, so `h` just dead-ended on the leftmost chip instead of walking out left.*
> **✅ RESOLVED**
> **How to test:** `q` into the builder, `h` until you're on the first chip of a group, then `h` once more → the app nav takes focus (revealing it if collapsed, landing on the active view). Anywhere else, `h` still moves a chip.
>
> *Fixed in `queryKey`: `h` when `kbCell===0` → `enterSidebar()`. Same rule the task list and the recurrence sub-pane already use. **Does not pre-empt e.3** — that's the calendar's own `h` conflict (`h` = previous day), still an open decision.*

---

## Triage — Claude's read + proposed order of attack

**Overall:** this is a coherent list, and it clusters better than it looks. Fourteen items collapse into **five themes**, and the sequence matters more than the individual fixes — three of these items are cheap *only if* the shared model lands first. Two are already effectively resolved (**n.7** fixed in the working tree; **a.1** is a regression I introduced and can undo).

### Theme A — the note editor's normal mode (n.2, n.4, n.5)
Small, additive, low-risk. These are all operators layered on the §6.1 block cursor that already exists; each is a handful of lines in the same `normalKey` switch. **n.4** (list continuation) is insert-mode and slightly different, but equally contained. Good "warm-up" batch — ship them together, they share tests and feel.

### Theme B — cosmetics with known causes (a.1, n.8, n.6)
All three are CSS/markup, no logic. **a.1** is a one-line undo of my regression. **n.8** is the underline pattern (fix once, applies everywhere we underline a hotkey). **n.6** is a restyle of the checkbox — worth doing properly with the system colors, and it does **not** endanger click-to-toggle. Cheap, visible, satisfying; can go anytime.

### Theme C — the "h at the edge" model (n.9, n.10, e.3) ← *do this before the big one*
Not three bugs — **one missing rule**, applied inconsistently. §4.4 already specifies it: `h` collapses/walks up, and only jumps to the deep nav when there's **nothing left to collapse**. Today the notes list jumps too eagerly (**n.10**), the notes list can't get in at all (**n.9**), and the calendar has a real conflict (**e.3**).

For **e.3** my suggestion: keep `h` = previous day, and let the *grid edge* be the trigger — `h` on the **leftmost column** (Sunday/Monday) walks out into the events nav, exactly like `h` at the top of a tree walks out to the deep nav. That preserves the day-nav you want, needs no new key, and makes the calendar consistent with the rule rather than an exception to it. If that feels wrong in the hand, the fallback is your "calendar is different, use `n`" — but I'd try the edge rule first.

### Theme D — the Escape ladder in notes (n.3) ← *the big one*
This is the largest item and the one everything else waits on. It's not really "add field nav to the note editor" — it's **defining the ladder** (insert → text-nav → field-nav → list) and making the note editor a citizen of the same `KbForm` model the task drawer already uses. You're right that we wrote the generic field nav for exactly this; the work is mostly *wiring the note editor into it* and getting the Escape semantics right at each rung, not writing new nav logic. Expect this to be the one that needs live iteration.

### Theme E — the list/drawer model (e.2, e.1, n.11, a.2) ← *last, and in this order*
- **e.2** is an outlier: a small structural bug (snapshot-in-`data()`), fixable immediately and independent of the rest. Do it whenever.
- **e.1** is a **decision, not a task** — until you decide whether event views render as a calendar or a list, **a.2** can't be finished. This is the one I'd want your call on soonest, because it gates the capstone.
- **n.11** (keyboard wikilinks) rides on **n.3**. Cheapest idea that fits your existing vocabulary: since the links already render as spans, give them a **hint-label** overlay (vim-easymotion / Vimium `f` style) — press a key, each visible link gets a letter, press the letter to follow it. That reuses no cursor state and doesn't fight the block cursor. The alternative — `Tab`/`n` cycling through links in the current block — is simpler but clumsier in long notes. No decision needed now.
- **a.2** is the capstone: generalize the task-list cursor into one shared list-cursor used by task, mixed, and event lists. Doing it last means the model has been proven by the others first, which is exactly what stops it becoming a second copy of the logic.

### Sequence
1. ~~**Theme B** (cosmetics) + **e.2**~~ — ✅ **shipped in batch 1** (a.1, n.6, n.8, e.2).
2. ~~**Theme A** (normal-mode operators)~~ — ✅ **shipped in batch 1** (n.2, n.4, n.5, n.12).
3. ~~**Theme D** (**n.3**, the ladder)~~ — ✅ **shipped in batch 1**, together with **n.9**. It came in *smaller* than billed: the fields were already on screen, and `notes.js` was simply the one module that had never adopted `KbForm`. Making the body's lines KbForm rows meant `j`/`k` crossing from the fields into the text needed **no** boundary code — the mixin's own row-clamp does it.
4. **Theme C** (`h` at the edge — **n.10**, **e.3**) — ← **next.** One rule, three call sites. Blocked only on your yes/no to the calendar edge-rule in **e.3**. (**n.9** shipped early because the notes list handler was already open on the bench.)
5. **n.14** (`i` → new note) — a **binding, not a feature**; it can ride along with anything.
6. **n.13** (links keyboard model) — its own slice, but it pays for itself: `linked-items` is **shared**, so one nested KbForm sub-pane fixes links in the task and event drawers too.
7. ~~**e.1**~~ + ~~**e.5**~~ — ✅ **shipped in batch 2.** The event list is `mixed-list` scoped to events, so **a.2** now has the surface it was waiting on. e.5 fell out of it: once the grid honors `type:`, a dated-task view can *be* a calendar.
8. **a.2** (shared list cursor) — ← **next**, now unblocked. Then **n.11**.
9. **n.14** (`i` → new note) + **e.4** (`t` → today) — bindings, not features; can ride along with anything.
10. **n.15** (notes search) — deliberately last: it's a **surface question** before it's a keyboard one (three search surfaces already exist), and it may dissolve into the query bar rather than need a key.

**What I still need from you — one call, design not code:**
- **e.3** — does `h` on the calendar's **leftmost column** walk out into the events nav? (That's what unblocks Theme C.)

**n.15** needs a decision too, but it isn't blocking anything, so it can wait.
