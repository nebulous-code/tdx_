# Keyboard Audit

Some notes about keyboard accessiblity for section 6. (2E §6.4 — the final keyboard/mouse pass.)

> **IDs:** `n.*` notes · `e.*` events · `t.*` tasks · `a.*` all-apps. Cross-references use those ids.
> Claude's assessment + a proposed order of attack live at the bottom under **Triage**. Nothing below has been changed in code except where explicitly marked.

## notes

**n.1 — Bug: view mode does not show line breaks while insert mode does.** Example in Pragmatic Programmer highlights note. There's a line break between "design." and "See also" when I'm in insert mode but view mode shows them all on a single line. I think this is a single line break versus double line break issue. Let's discuss before you implement a fix so I can understand it better.
> *Root cause is known and cheap to explain — it's a one-word markdown-it option (`breaks: false`), not a bug in our code. Related: **n.4** (both are about how source lines map to rendered output). Discussion below in Triage.*
> Response. Great now that I understand that's just how markdown is I'm willing to accept it. No code change needed here.

**n.2 — Feature: `o` and `O` in vim style.** `O` opens a line above the cursor and `o` opens a new line below the cursor.
> *Same family as **n.5** (`r`) — both are normal-mode editing operators on top of the §6.1 block cursor.*

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

**n.4 — Feature: continue lists on Enter.** It'd be nice if bulletted lists and numbered lists inserted a bullet/number at the same indention level if you hit enter on a bulletted row. Basically the logic would be: if the first non-whitespace character is a `-`/`*`/`#`. then the new line will inherit the white space and the bullet leader or increase the number if it's a number.
> *Insert-mode behavior; independent of the normal-mode operators (**n.2**, **n.5**). Related to **n.1** only in that both concern markdown source semantics.*

**n.5 — Feature: `r` for vim style replace.** Basically if you're in nav/normal mode and you hit `r` the next key replaces where your cursor is with the key you pressed. Super helpful for updating checkboxes in place.
> *Pairs with **n.2** (normal-mode operators) and is the keyboard counterpart to the click-to-check behavior discussed in **n.6**.*

**n.6 — Bug: styling of `- [ ]`.** I'd be interested in what we could do with this. Right now it looks like it's just a default interactive checkbox. this might be necessary because I do want the clicking to check functionality to work on notes. However it looks a little out of place. If we could figure out how to style it with the default system colors that would be ideal. The checked state looks good and on brand so if we could inherit some style from that it'd be nice.
> *Pure CSS — the click-to-toggle behavior does **not** depend on the native checkbox appearance, so we can restyle it freely. Related: **n.5** (toggling the same checkboxes from the keyboard).*

**n.7 — Bug: task linking doesn't work on notes via clicking.** On the Standup notes file the first line has `[[t_0009]]` at the end of it. When I click on it I get the error that the note is not found. I suspect this is because it's only searching for notes and this is a task. The Links under the note text area does successfully link the task and clicking that works just fine so I suspect this is either something about how the link is inserted into the text area. This may not be a code bug but a note creation bug. Look into it but don't make any code changes until we understand the root cause.
> ***Your diagnosis was exactly right, and this is already fixed in the working tree*** *(uncommitted, from the readable-id sweep). Root cause: the frontend markdown renderer had no concept of readable ids, so `[[t_0009]]` fell through to the "note by name" branch and searched notes **by title** → "note not found." Nothing wrong with the note or how the link was inserted — the **backend** resolved it correctly all along, which is why the Links section worked. The renderer now recognizes readable ids, resolves them through the store, and hands the click the real uuid. **Needs your smoke test to confirm.** Related: **n.11** (keyboard access to these same links).*

**n.8 — Bug: gap between "o" and "pen" in the `open fully` button** on the right-hand drawers. This is likely an artifact of the o being underlined, we see this often so it should be fixed not to have the gap.
> *Cosmetic, and it's the shared accesskey-underline pattern (`<u>o</u>pen`), so the fix applies everywhere we underline a hotkey letter — not just this button. Same cosmetic bucket as **a.1**.*

**n.9 — Bug: can't get to the notes nav (left-hand drawer) with `h`** when navigating a list of notes. Landing in there with `n` works fine but I'd like to be able to get in there with a normal `h` nav like I can with tasks.
> *One of the three "`h` at the edge" items: **n.9**, **n.10**, **e.3**. Fix them together as one model, not three patches.*

**n.10 — Bug: collapsing View/Calendars/Folders/Projects/Labels doesn't work with `h`.** Instead I get put into the deep nav menu. I can still collapse those areas with space. I'd like to hit `h` and collapse the area then land in the deep nav if I want to by hitting `h` again. This keeps the `h` to collapse functionality we have in prod today. If someone wants to quick access the deep nav we support `N` to get there so this is collapsing is a more natural flow for users.
> *This is a **regression against the §4.4 spec**, which already says `h` jumps to the deep nav "only when there's nothing left to collapse/walk-up." The implementation is jumping too eagerly. Same family as **n.9** / **e.3**.*

**n.11 — Feature: navigate wikilinks with keyboard.** Not sure how I want to implement this. Right now you've got to click any imbedded wikilinks with a mouse. Open to ideas on how to get this one done.
> *Depends on **n.3** (there's no in-note field/nav ladder to hang link-hopping off of yet) and on **n.7** (links have to resolve before they're worth navigating to). Ideas in Triage — no decision needed now.*

**n.12 — Feature: vim delete operators in the note body (`dd`, `D`, `dw`).** None of these exist today — the body's normal mode has exactly one `d` binding (delete the whole note). `dd` deletes the current line, `D` deletes from the cursor to end of line, `dw` deletes a word forward.
> *Spun out of the **n.3** `d` decision, which frees `d` in the body to act as an operator prefix. Same family as **n.2** (`o`/`O`) and **n.5** (`r`) — all normal-mode operators on the §6.1 block cursor, and all cheap once the first one establishes the pending-key pattern (the `gg` `pendingG` flag is the existing precedent). **Depends on n.3** (the row-context split is what makes `d` available at all).*

## events

**e.1 — Feature?: think deeply about how the views in the event screen work.** Right now the calendar specific queries don't seem to do anything. Realistically I don't think they should show the calendar view and it might be worth showing it as a list. No decision on this quite yet but I'd like you to look into what/how the code works today and then I can decide what direction we want to go.
> *Blocks **a.2** — mixed-list `j`/`k` can't be finished while event-only views have no list to navigate. This is a **design decision first, code second**; I'll write up how it works today when you want it, not before.*

**e.2 — Bug: clicking a second event doesn't switch the right-hand drawer.** When I click on a view like "Everything Work" which returns multiple event items. Clicking on the first event shows the event detail in the right drawer. Clicking a second event does not switch/change the event details that appear in the drawer. This isn't acctually accessible on the events screen, but it shows up in tasks and notes screen whn you select a view that returns multiple items. This does not seem to be a problem with the notes or tasks, they switch/change propperly. This is specifically a mouse only issue, keyboard nav forces you to close the drawer before switching tasks which is fine.
> *Root cause is almost certainly structural and small: the event drawer snapshots the event into a local form object **once, in `data()`**. While the drawer stays open, Vue doesn't re-run `data()`, so a second click updates the store but not the form. Tasks/notes don't have this problem because they read the item reactively instead of snapshotting it. Cheap fix (force a re-mount per event, or watch the selection).*

**e.3 — Feature?: `h` doesn't reach the events nav** — the only way to get to the events nav lh drawer is by hitting `n`. In other apps like tasks and notes you can hit `h` and it puts you in the app nav drawer. However `h` on this one navigates you to the previous day, that makes sense. `H` will switch your month which is also desired. I'm not sure if I want to part with that functionality to make it consistent or just say "calendar/events are different and you've got to use `n` to get there." Open to suggestions on how to fix this. No code change for this one quite yet.
> *The genuine conflict in the "`h` at the edge" family (**n.9**, **n.10**). A suggestion is in Triage — the grid gives us a natural edge to work with.*

## tasks

*(none yet)*

## all

**a.1 — Bug: no space between the count and the view title in the header.** The header view/query counts like open overdue urgent appear as `13open | 10overdue | 2urgent`. Look into the root cause here don't auto fix it.
> ***This one is mine, and recent.*** *When I gated the count badges (so event/note views don't show a bogus `0`), I wrapped the count in a `<template v-if>` and left the separating space **inside** it — Vue's whitespace condensing then drops that trailing space. Fix is to own the spacing in CSS/markup rather than rely on a text-node space. Same cosmetic bucket as **n.8**.*

**a.2 — Bug: `j`/`k` don't work on mixed item lists.** It seems to still work as designed in task only views. Event only views don't seem to display as lists (see **e.1**) and notes open the note in full screen instead of a rh side drawer. However mixed lists show all items and should be navigatable through `j`/`k` to switch detailed items without closing the rh side bar. Let's make sure we write this in a way that doesn't duplicate the existing logic that works for tasks and find an intelligent way to implement this so we don't have duplicate code. We should resolve this after we're happy with keyboard nav for notes and events.
> *Agreed on the sequencing, and it's the right instinct: this should be the **generalization** of the task-list cursor, not a second copy of it. Depends on **e.1** (events need a list) and **n.3** (notes need the drawer/ladder). Do it last — it's the capstone that proves the model is actually shared.*

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

### Suggested sequence
1. **Theme B** (cosmetics) + **e.2** — an afternoon; visible wins, no design risk.
2. **Theme A** (normal-mode operators) — contained, improves daily feel immediately.
3. **Theme C** (`h` at the edge) — one rule, three call sites; needs your yes/no on the calendar edge-rule suggestion in **e.3**.
4. **Theme D** (**n.3**, the Escape ladder) — the big one; budget iteration time.
5. **e.1 decision** → then **a.2** (shared list cursor) → then **n.11**.

**What I need from you, and when:** the **e.1** direction (calendar vs list for event views) is the only thing that blocks planning — everything else I can sequence without you. **n.1** you asked to discuss before I touch it; short version is that it's not our bug at all, it's markdown's "a single newline is not a line break" rule (we render with `breaks: false`, which is standard/CommonMark behavior — Obsidian's default too). The real question is whether *your* notes should follow that rule or be more WYSIWYG, and that's a taste call worth making deliberately since it changes how every existing note renders.
