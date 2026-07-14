# Keyboard Audit

Some notes about keyboard accessiblity for section 6. (2E §6.4 — the final keyboard/mouse pass.)

> **IDs:** `n.*` notes · `e.*` events · `t.*` tasks · `a.*` all-apps. Cross-references use those ids.
> Claude's assessment + the order of attack live at the bottom under **Triage**.

## Status
**33 of 34 resolved.** Every original audit item (n.1–n.15 · e.1–e.6 · a.1–a.8) is closed; what's left was all spun out during testing. **n.16** is done and user-tested — the vault's base directory is now a folder you can **name** (a user preference, default `Inbox`; blank hides it), which is the last structural gap in notes. **n.17** shipped as something bigger than planned: **one creation engine for all three apps** (`CL`, `docs/CREATION_LANGUAGE.md`) — tasks got their first **typed due date** (`$friday`), notes got the whole grammar. **n.11 is closed as a non-issue** — n.13 made the link chips keyboard-navigable, so every link is already reachable without a mouse. **The notes app has nothing open.** One item left: **e.9**.

| batch | items |
|---|---|
| 1 | n.2 `o`/`O` · n.3 the unified note ladder · n.4 list continuation · n.5 `r` replace · n.6 checkbox styling · n.7 wikilink clicks · n.8 the `o|pen` gap · n.9 `h` → notes nav · n.12 `dd`/`D`/`dw` · a.1 header count spacing · e.2 the event drawer not switching *(plus n.1 closed as standard markdown)* |
| 2 | e.1 grid/list toggle (`display` as view metadata; occurrence-level date filtering) · e.5 the grid obeys the `type:` rule → **tasks got a calendar view** |
| 3 | a.3 the ⊞ query button · a.4 the quick-add ⚠ · a.5 `h` in the query builder · query-bar polish (`c` = clear · `query`⇄`hide Q` · text-only buttons) |
| 4 | e.3 **decided** (`h` stays "previous day"; the nav is reached with `n`) · a.6 `n` enters the app nav, second press closes it |
| 5 | ✅ n.10 · ✅ e.4 · ✅ a.7 · ✅ a.2 (one shared list cursor) · ✅ a.8 (every drawer slides) · ❌ n.13 · ❌ n.14 |
| 6 | ✅ n.13 re-fix (`+ link` as its own ladder rung, entered with `i` **or** space) · ✅ n.14 **redo** (the notes quick-add bar — the phantom "unsaved note" state is gone) · ✅ n.15 (`f` = find text **in this view**; the box was silently searching the whole vault) · ✅ n.18 (`e` peeks a note in the right-hand drawer) · ✅ e.7 (`e` = the day's agenda · `E` = agenda + the day's first item) |
| 7 | ✅ **e.7** (`e` = the day’s agenda · `E` = agenda + the day’s first item) · ✅ **n.16** — the vault's base directory as a folder you can name (`users.notes_root_name`, default `Inbox`, blank = hidden) · `folder:<name>` addresses the vault root · the verbs on that row are inert by construction |
| 8 | ✅ **n.17** — the **creation language**: one engine (`CL`), `#` `$` `/` `{…}` on tasks **and** notes; tasks gain a typed due date · **n.11** closed as a non-issue (the link chips are navigable — n.13) · **e.8** (`J`/`K` jump event-to-event in the agenda) |

**Behavior changes now live:** **`e` on the calendar** opens the day's agenda (that was `E`); **`E`** now opens the agenda *and* the day's first item in your current view. **`f` on the notes list** finds text *within the current folder/view* (it used to search the whole vault, ignoring both). **`d` in the note body** is vim's operator prefix (`dd`/`dw`), not delete-note (that's on the field rows + the notes list). **`n`** enters the app nav rather than just toggling it. **`c`** clears the query (was `x`). **Notes are created from a quick-add bar** (`i`, then a name, then `↵`) — the `＋ new` button and the unsaved-note editor state are gone.

**Outstanding:** **e.9** — the calendar has no creation-language caller (captured, not scheduled). That's the whole list.

## notes

### Open

*Nothing — every notes item is resolved.*

### Resolved issues

**n.1 — Bug: view mode does not show line breaks while insert mode does.** Example in Pragmatic Programmer highlights note. There's a line break between "design." and "See also" when I'm in insert mode but view mode shows them all on a single line. I think this is a single line break versus double line break issue. Let's discuss before you implement a fix so I can understand it better.
> *Root cause is known and cheap to explain — it's a one-word markdown-it option (`breaks: false`), not a bug in our code. Related: **n.4** (both are about how source lines map to rendered output). Discussion below in Triage.*
> Response. Great now that I understand that's just how markdown is I'm willing to accept it. No code change needed here.
> **✅ RESOLVED** — accepted as standard markdown behavior (`breaks: false`). No code change.

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

**n.10 — Bug: collapsing View/Calendars/Folders/Projects/Labels doesn't work with `h`.** Instead I get put into the deep nav menu. I can still collapse those areas with space. I'd like to hit `h` and collapse the area then land in the deep nav if I want to by hitting `h` again. This keeps the `h` to collapse functionality we have in prod today. If someone wants to quick access the deep nav we support `N` to get there so this is collapsing is a more natural flow for users.
> *This is a **regression against the §4.4 spec**, which already says `h` jumps to the deep nav "only when there's nothing left to collapse/walk-up." The implementation is jumping too eagerly. Same family as **n.9** / **e.3**.*
> **✅ RESOLVED** — *verified by the user.*
> **How to test:** in the app nav, `h` on an **expanded** section header (Views / Projects / Labels…) now **collapses that section** and leaves the cursor on it. `h` again — with nothing left to collapse — jumps out to the app rail. `h` on a project still collapses its children, then walks up to its parent. (`Tab` still toggles a section too.)
>
> *One-line fix in `sidebarKey`'s `case 'h'`: on a `head` row, collapse via `toggleSection()` when `!store.navSections[section]`, and only `enterDeepNav()` once it's already collapsed. It now mirrors `case 'l'`, which expands a collapsed header. That is the §4.4 rule verbatim.*

**n.11 — Feature: navigate wikilinks with keyboard.** Not sure how I want to implement this. Right now you've got to click any imbedded wikilinks with a mouse. Open to ideas on how to get this one done.
> *Originally blocked on **n.3** (no in-note ladder to hang link-hopping off) and **n.7** (links had to resolve first). Both landed — but so did something that made the feature unnecessary.*
> **✅ CLOSED — not an issue (user's call).** **n.13** made the **link chips keyboard-navigable**: the links row is a KbForm grid, `h`/`l` cross the chips, `space` opens the linked item in the right-hand drawer, and `i`/`space` reaches the `+ link` picker. **Every link a note has is already reachable without a mouse** — just from the links row rather than from inside the prose. *User: "now that link chips are navigatable I can link to them on that… the functionality is there and I don't have any better solutions, so I'm willing to let it lie until I come up with a better idea."*
> *What a future version would add, if an idea shows up: hopping to a link **from where it sits in the text** (a `[[wikilink]]` mid-sentence), rather than from the chip list at the bottom. That's an ergonomic nicety, not a gap in access — which is why it isn't worth an open item.*

**n.12 — Feature: vim delete operators in the note body (`dd`, `D`, `dw`).** None of these exist today — the body's normal mode has exactly one `d` binding (delete the whole note). `dd` deletes the current line, `D` deletes from the cursor to end of line, `dw` deletes a word forward.
> *Spun out of the **n.3** `d` decision, which frees `d` in the body to act as an operator prefix. Same family as **n.2** (`o`/`O`) and **n.5** (`r`) — all normal-mode operators on the §6.1 block cursor, and all cheap once the first one establishes the pending-key pattern (the `gg` `pendingG` flag is the existing precedent). **Depends on n.3** (the row-context split is what makes `d` available at all).*
> **✅ RESOLVED**
> **How to test:** in nav mode, in the body: `dd` deletes the line · `D` deletes cursor→end of line · `dw` deletes the word forward. **`d` no longer deletes the note while you're in the body** — it deletes the note from a **field row** (title/folder/labels/review/links/save/delete) and from the **notes list**. This is the one thing likely to surprise your fingers.

**n.13 — Nav gap: the `links` section can't be navigated (GENUINE DESIGN GAP, not a wiring miss).** Found while testing **n.3**. `linked-items.js` — the component shared by the task, event **and** note detail surfaces — has **no keyboard model at all**: no cursor over the link chips, no way to open a linked item or unlink one. It has always been mouse-only; the ladder just made that visible.
> *Claude proposed a nested KbForm sub-pane; **superseded by the user's call**, which is simpler: treat the links exactly like the **label chips** — **one KbForm `grid` row** (`{type:'grid', items:links, cols:99, select:l => open(l)}`). `j`/`k` skip the row as a unit, `h`/`l` cross the chips, `space` opens the focused one in its drawer. The mixin does h/l + space for free — no `kbDelegate`, no enter/exit protocol. Because `linked-items.js` is shared, it lands in the task, event **and** note drawers at once.*
>
> *Two traps handled: (1) **`$refs` is not reactive** — a `kbRows()` reading `$refs.links.links` evaluates before the child mounts, emits zero nav rows, and (having registered no dependency) never recomputes. The child **emits** its loaded links up into host state instead. (2) The chips are rendered by the **child**, which can't call `kbCls`, so the host passes the focused index down (new `kbCellOf(id)` helper) and the child paints it.*
>
> **❌ FAILED TEST (first pass).** User: *"I can't actually select the links or insert a new one."* **Root cause:** a `grid` row's only verb is `select`, and its `when` clause hides it entirely when there are **zero links** — so converting the row to a grid removed the only keyboard path to the `+ link` picker, and on a note with no links the row wasn't there at all.
> **Re-fixed:** `+ link` got **its own ladder rung** (`addlink`) — the same precedent as `+ new` tag on tasks. It's an `input` row, not a `button`, so **`i` enters it as well as `space`** (matching every other field on the drawer) and it wears the **field** focus ring rather than the button one. Always present while the item exists, so an item with no links still has a keyboard path to add one. The picker itself got ↓/↑/Enter/Tab/Esc so a candidate can be chosen without a mouse.
> **✅ RESOLVED** — user-tested.
> **Not built (deliberately):** keyboard **unlink**. `space` is taken by "open", so there's no key left; unlink stays mouse-only (the chip's ✕). It's destructive with no confirm — not inventing a key without you.

**n.14 — Bug: `i` doesn't create a new note from the notes list.** I'd like to mirror the way you add new tasks on the tasks screen. Right now you have to click the `＋ new` button to create a note; `i` would be much easier.
> *First pass: bound `i` to the existing `newNote()` — treated as a binding, not a feature.*
> **❌ FAILED TEST.** User: *"I can't escape out of the insert note… if you lock my cursor into the title I can't cancel creating the note."*
>
> **Root cause — the binding wasn't the bug, the state it opened was.** `newNote()` opened the editor on a note **that doesn't exist yet** (`creating = true`; nothing is written to the vault until the first save), and it set `mode = 'insert'` — a claim that the *body textarea* owns the keyboard — while actually focusing the **title** input. Escape then had nowhere to go: the title's `@keydown.esc.stop` swallowed the first press, and the second hit `onKey`'s `if (mode === 'insert') return;` short-circuit, so neither the textarea handler (not focused) nor the KbForm ladder ever saw it. The `＋ new` button had the identical trap — `i` just made it reachable by reflex.
>
> **Redesigned (user's call): remove the phantom state, don't defend against it.** Notes now get the **tasks quick-add bar** in the header — `[sync]  + ❯ [note name…]  [search →]`. `i` focuses it, Enter **creates** the note, and only then does the editor open — on a note that exists, via the same `open()` every list row uses. Every "field on a record with no id" edge case disappears with it. Deleted: `newNote()`, the `creating` flag, the `＋ new` button, `save()`'s create branch, and the `if (sel) … else save()` forks. The `⚠` prompt carries over from tasks on a **notes-local** rule (`store.viewWarn()` is task-shaped — it hard-codes `type:` → `'task'`): a new note satisfies `type:` / `folder:` / `has:` / `created:` / `edited:`, so *To review* (`due:today`) warns and the other three seed views don't. Dropped from the header: the "notes" wordmark and the folder chip (a note still files into the folder you're viewing, same as tasks).
>
> **Second fault, caught in your test:** a note created inside a **view** didn't appear until you switched views and back. `rows` is the intersection of two things — the note **list** and `matchIds`, the set of ids the active query matched — and creating a note refreshed only the list, so a stale `matchIds` filtered the new note right back out. Changing the view re-ran `refilter()`, which is why the round-trip appeared to fix it. Both are now refreshed on create **and** on save (an edit can move a note out of the view it's in: labels, review date, folder, title text).
> **✅ RESOLVED** — user-tested.
> **Polish (your note):** the bar's hint now mirrors the task quick-add's — `add note…  (try: Thank You Letter)`, and `add to <folder>…` when you're standing in one (same shape as tasks' `add to <project>…`).
> **Spun out:** **n.16** (no way to see root-folder notes) · **n.17** (creation language in the bar).

**n.15 — Nav gap: the notes list's own search box can't be reached by keyboard.** The global `/` find works, but the notes screen's search input — which searches within the current folder/list — is mouse-only. Not sure how I want to handle this yet.
> **The box didn't do what the item says it does.** `rows` returned `this.hits` **raw**, short-circuiting *both* the folder filter and the query's `matchIds` — so typing in it searched the **whole vault**, not the folder/view you were standing in. That accident was also the entire argument against keeping it: as a vault-wide text search it half-duplicates `/`.
>
> *The two engines are genuinely different, which is why the box is worth keeping once it's scoped: **`/`** matches literal words, AND-ed, over title + body across **tasks · events · notes** through the client query engine; **the box** is the server's **FTS5 index** — tokenized, prefix-matched, ranked, notes-only. Better at finding prose, narrower corpus.*
>
> **DECIDED (user): bind `f`, and make the box mean what it says.** Two changes:
> 1. **`f`** on the notes list focuses it (verified free — nothing binds `f` globally or in any app; `/` stays the global find and `?` stays help).
> 2. **`rows` is now `folder ∩ query ∩ hits`** — the find narrows *what you're looking at*. Each surface now has a one-sentence job: `/` finds anything anywhere · `f` finds notes **in this view** · `q` filters by category.
>
> **Esc is two-step, mirroring the global find (your note).** The first pass made `esc` clear the find outright — which threw the results away the instant you tried to *look* at them. It now copies `/`'s `commitSearch` → `clearSearch` pair: **1st `esc`** (in the box) commits — blur, keep the term, keep the filtered list, so `j`/`k` walk the hits; **2nd `esc`** (on the list) clears the term and restores the underlying view. `f` returns to the box with the **last term still in it**. `↵` in the box commits too, same as `/`.
>
> *The box is relabelled **`find text…`** with the `f` underlined. That hint has to be an **overlay span**, not the `placeholder` attribute — a placeholder is plain text and can't underline a letter. Same trick as the quick-add's tag ghost: a span painted over the empty input, `pointer-events: none`. (Kept clear of the **n.8** trap — that gap came from `.btn`'s flex `gap` splitting `<u>o</u>` and `pen` into two flex items; this span isn't a flex container.)*
> **✅ RESOLVED** — user-tested.
> **How to test:** on the notes list, `f` → the cursor lands in the box → type → the list narrows. **Stand in a folder (or a view like *Created this week*) and find something that exists only outside it — it should NOT appear.** That's the scope fix; before, it would have. Then the Esc ladder: **`esc` once** → you're out of the box but the list is still filtered, `j`/`k`/`o` walk the hits · **`f`** → back in the box, term intact · **`esc` again** (from the list) → the find is gone and the full view is back. The box reads `find text…` with the `f` underlined. Also new: the help modal (`?`) finally has a **notes list** section.

**n.16 — Design: there's no way to see the notes at the vault ROOT.** A note with no folder (`folderId: null`) only shows up in the unfiltered "all notes" list, mixed in with every foldered note — there's no nav entry that means "the root". *(User's first instinct: an **inbox-style default folder**, mirroring how tasks handle a project-less task.)*
>
> **A real Inbox folder is the WRONG fix, and the user spotted why before it got built.** Folders here are **not** an app concept — they are **derived from the vault's directories** (`reconcileFolders()` walks the on-disk dirs; `folderIdForPath()` is literally `dirname(rel) === '.' → null`). So `folderId: null` doesn't mean "unassigned", it means **the file sits at the top of the vault**, and it's already a real writable destination (`folderBaseRel(null)` → `''`). An `Inbox/` folder would be a **real directory**, and a real directory **cannot capture a file the user drops at the vault root** — so you'd end up with *two* kinds of unfiled note (the ones in `Inbox/` and the ones actually at root), and the root ones would still be homeless. It adds a folder and fixes nothing.
>
> **DECIDED (user) — expose the root AS a folder, with a name the user picks.** It's a display + naming change, not a data change: the notes already live there and the server already writes there.
> - **New preference: "base directory" name** (account screen, free-text). **Defaults to `inbox`** — same word tasks use for its project-less home, so the two apps agree and the cross-app categorizer can match them by name. Someone who thinks in filesystems can type `root`; someone else can type whatever they like. The code just paints that name over the `''` directory. **Blank = hidden**, which is exactly today's behavior — so the feature is opt-in and the off-switch is the status quo. Hint text in the empty field, plus an info badge (same pattern as the sizing preference).
> - **It is NOT part of the hierarchy: no children, no parent.** The user's reason is the right one — folders mirror directories, so if root could have children you couldn't tell an app-level child from a plain sub-directory. *Stronger still:* on disk **every top-level folder already IS a child of root**, so honoring the hierarchy would nest the whole tree one level deeper for zero gain. (The tasks inbox escapes this only because it's pure DB with no filesystem to answer to.)
> - **The folder verbs are stripped on that row** — no `e` (rename), no `x` (delete), no `a` (add child). In their place, an **info icon** explaining that this is the vault's base directory, that it's configured in preferences, and **why it can't have children**. That gives the user somewhere to go to rename or hide it.
>
> **`folder:` in the query language.** A bare **`folder:`** already meant "unfiled" before this feature, in both engines: a note's `category` **is** its folder name, a root note's was `null`, and `catNameMatch` slugs both sides — `slug(null) === '' === slug('')`, so the equality arm fires, while the substring arm is guarded by `want.length > 0` so an empty value can't match everything. n.16 adds the **alias**: `folder:<base name>` finds the same notes.
>
> > **⚠ The trap this feature walked into — caught by the new tests, not by the plan.** Naming the base directory gives root notes a **category**, which *silently broke the bare `folder:` token*: it only ever worked because that category was `null`. The "durable, rename-proof spelling" was destroyed by the very feature that promised it. **Fix: rewrite the TERM, not just the category.** When the alias is live, a bare `folder:` is rewritten to `folder:<base name>` before evaluation (`unifiedQuery.ts`), so both spellings keep meaning "the root" and the parity-locked matcher never learns about any of this. **`category:` is deliberately NOT rewritten** — its empty-value arm falls through to `resolveProjects`, where an empty string matches *every* project.
>
> *Two assumptions checked and corrected while designing this: (1) **`folder:` does not support comma lists** — only `label:` splits on commas, so `folder:a,b` slugs to `ab` and matches nothing. Not an edge case to protect; a separate feature, **tracked by the user outside this doc**. (2) **Multi-word names need no convention** — the tokenizer respects quotes and `slug()` strips every non-alphanumeric, so `My Notes` / `my-notes` / `mynotes` all slug the same; you just quote it: `folder:"my notes"`.*
>
> **The collision rule.** A user with a real `inbox/` directory *and* a base directory named `inbox`:
> - The nav tags the synthetic row **`inbox (base)`** — `inbox (base)` is `./`, `inbox` is `./inbox` — so the two are distinguishable on sight, and the ⓘ says which to rename.
> - **Data beats label:** on a collision the **alias switches off** — root notes go back to `category: null`, so `folder:inbox` means the **real directory**, and the base isn't addressable *by name* until the user renames one of them. Bare `folder:` still finds the root, always.
> - *Why not the suffixed spelling (the user's first idea, and my first plan):* `catNameMatch` matches on **substring**, so a base labelled `inbox (base)` slugs to `inboxbase` and `folder:inbox` would match it **anyway** (`'inboxbase'.includes('inbox')`). A label containing the word cannot be excluded by the word — the suffixed spelling can't be made targeted without changing the shared, parity-locked matcher. Switching the alias off is the honest degrade, and it costs zero engine change.
>
> **Base-name uniqueness validation.** `PUT /api/auth/account` rejects a base name whose slug collides with **any live folder, at any depth** (the query matches by name, not by path — a nested `Work/Meetings` collides just as badly as a top-level one; verified against the dev vault). It's the cheap guard that makes the feature safe — it's what stops "rename the base to `groceries`" from quietly capturing grocery queries. It can't be airtight (a colliding directory can appear *later*, via sync — the vault is the user's filesystem, not ours), which is exactly what the `(base)` tag + the data-beats-label rule are for.
>
> **Explicitly NOT in this item** (the user is tracking both in the tdx prod tracker): **renaming a folder doesn't rewrite `folder:` terms in saved views** — a **pre-existing, general bug**, not something n.16 introduces (`updateFolder()` does `fs.renameSync()` and touches no queries, so renaming *any* project/label/calendar/folder already breaks saved views that name it) · **multi-folder queries** (`folder:a,b`). A consequence to accept: the base name is query-visible, so a saved view saying `folder:inbox` goes stale if the preference is later renamed. **Bare `folder:` is the durable spelling** — use it in a saved view you care about.
>
> **Built:** migration `008_notes_root_name.sql` (`users.notes_root_name`, default `'inbox'`) · the **five** hand-written places a user column must be added — the auth routes carry **no TypeBox schema**, so the strip points are the `SessionUser` interface, `resolveSession`'s select list, `tokens.ts`'s **duplicate** list (PAT path), and `publicUser`'s **fresh literal** (`??`, not `||` — `''` must survive), plus the hand-built response literal in `PUT /api/auth/account` that never re-reads the row · the account-screen row + ⓘ + `blank = hide vault root` hint · a synthetic nav row (`store.rootFolder()`, kept **out** of `store.folders` or diff-sync would POST it) with its own `kind`, so the folder verbs are inert **by construction** · a **sentinel view id** (`__base__`) because `folderId: null` is already "all notes" · the alias + collision rule in `unifiedQuery.ts` (**never** `query.ts`).
> **✅ RESOLVED** — user-tested: the row shows and `j`/`k` land on it · `h` returns the cursor to it · the collision error surfaces · the note editor's folder picker reads `⌂ Inbox` instead of `— none (root) —`.
> **Follow-up (your call): "Inbox", not "inbox"** — every other categorizer on screen is capitalized (they're user-typed, so nearly always Title Case), and the one name the *app* chooses should match. Capitalized in **both apps** (the tasks Inbox project too). Migration `009_capitalize_inbox.sql` renames rows still holding the seeded default; a user-renamed one is untouched. Renaming is query-safe — the engine matches categorizer names through `slug()`, which lowercases, so `project:inbox` keeps working. **The trap:** migrations run against the **empty** target *before* `migrate-from-legacy` inserts anything, so 009 can't reach a legacy import — the importer normalizes the name itself. That's the path a prod cutover actually takes.
> **Tests:** 399 backend (was 390). The nine new ones include the **first coverage `folder:` has ever had** — bare token · the alias · blank/hidden · the collision where the real directory wins — plus the account branches (accept, blank, over-length, collision → 400) and the `me` round-trip that would catch a forgotten response literal.

**n.17 — Feature: creation language in the notes quick-add, mirroring tasks.** The bar is there now (**n.14**) but it takes a bare title. Tasks let you type `#label` and `!priority` inline; notes should get the same treatment. Not urgent — logging it because the bar is the natural home for it. *(User: "I think it will play nice.")*
> **⇒ Superseded in scope by [`docs/CREATION_LANGUAGE.md`](CREATION_LANGUAGE.md) — read that first.** n.17 started as "port the task grammar to notes" and turned into something better: **one creation engine for all three apps** (`CL.parse` / `CL.apply`), the sibling of the shared query engine. A symbol means one *idea* everywhere (`$` = the date · `/` = where it lives), and each type maps the abstract field onto its own column — exactly as the query language already does (`due:` is a task's due date **and** a note's review date; `category:` unifies project · calendar · folder). **Notes can't be done in isolation any more, and shouldn't be:** the same slice gives tasks their first **typed due date** (`$friday`), which is the highest-daily-value token in the grammar. What follows is the notes-specific detail.
>
> *The task grammar is **smaller than the name suggests**: `parseQuickAdd` (`tasklist.js:213`) parses exactly **two** tokens — `#label` and `!N` priority. Everything else that feels like creation language is **view-defaults inheritance** (`store.viewDefaults()`, `data.js:586`): a new task silently inherits the project / labels / due / done-state implied by the **view you're standing in**, parsed from the active query, not from what you typed.*
>
> *So the **1:1 cutover is exactly one token: `#label`*** (same field, same `store.addLabel`, same wire shape — and it brings the **`#` ghost-completion**, `tagGhost` + `acceptTag`, which is what makes the syntax discoverable at all). **`!priority` does not port** — notes have no priority field, and inventing one means schema + migration + sort keys + UI for something nobody asked notes to have. A **review-date** token and a **folder** token are *net-new grammar*, not a cutover — tasks have no typed date or project token either. See CREATION_LANGUAGE.md for the proposed spellings (`$` = due/review, one shared **categorizer** symbol across project/folder/calendar).*
>
> *The **highest-value half needs no symbols at all**: give notes a view-defaults sibling. Today a note inherits only the folder, so creating one in a `label:work` view yields an unlabeled note that vanishes from the list — exactly what the quick-add's `⚠` is there to warn about. Porting the inheritance makes the `⚠` fire **less**, because the new note would satisfy the view it was made in. Related: **n.16** — the base directory now has a **name**, so a folder token finally has something to say.*
>
> **✅ READY TO TEST** — shipped as slice 1: **`#` `$` `/` `{…}`**, on tasks **and** notes, through one engine (`frontend/js/create.js` → `window.CL`). `%` `*` `^` `@` deferred (they're the tokens whose values contain spaces). Events are **engine-only** — `CL.apply('event', …)` works and is golden-tested, but the calendar has nowhere to type: **e.9**.
>
> **Three things the goldens caught that the design didn't:**
> 1. **`!0 … !5` gave priority 5.** `parseQuickAdd`'s `!` replace was **non-global**, so the *first* `!N` won and later ones stayed in the title. The rewrite took the last. Now **first-wins for every single-valued field** (`!` `$` `/`), and a second one is literal — the only rule that stays predictable while you edit a half-typed line.
> 2. **`/tdx` didn't find `tdx-app`.** `project:tdx` does, because the query engine matches categorizer names on **slug OR substring** (`catNameMatch`). `CL.nameMatch` is now that same rule — *typing* a categorizer and *querying* one must never disagree about what a name is.
> 3. **`parse` must be pure, and it's a real trap:** `store.addLabel()` **creates** the label it looks up, and ghost-completion re-parses on **every keystroke** — a resolving parser would litter the label list with `#b`, `#br`, `#bra`… So `parse` returns label **names**; `apply` resolves them. There's a test asserting `store.labels` doesn't grow during a parse.
>
> **How to test:** **Tasks** — `Call plumber /home #errand !2 $friday` files it in *home*, tagged, priority 2, **due Friday** (none of which could be typed before). `pay Bob $5` keeps its five dollars in the title; `Ship it !!!` keeps its bangs. **Notes** — `Standup /Work #meeting $tomorrow {agenda}` lands in *Work*, labeled, review date tomorrow, body seeded; **`!3` in a note stays in the title** (a note has no priority). **Ghost** — type `/ho` or `#err` or `$fr` and Tab/→ accepts the grey completion (notes had no completion at all before). **Inheritance** — make a note while standing in a `label:work` view; it now **stays in the list**, and the `⚠` no longer fires.

**n.18 — Feature: `e` peeks a note in the right-hand drawer.** Came out of testing **n.15**: on every note-specific list the only way to look at a note is to open it **full-screen**, which is a heavy way to answer "is this the one?" — especially while walking find results. The note peek drawer already exists (links and mixed results open it); the notes app just never used it. `↵`/`o` = go **in** (full editor), `e` = **peek**.
> *Wiring, as you called it — no new surface. `store.openNoteDrawer()` already exists, and `note-detail.js` already handles `o` (promote the peek to the full editor) and `J`/`K` (walk the list, swap what the drawer shows). **The one real gap:** `J`/`K` in the drawer go through `store.listSwap()`, which reads whatever list **registered the shared cursor** (a.2) — and the notes list never registered one, so those keys would have been dead. It registers now (`rows`/`index`/`go`, with `go` re-peeking), so J/K walk the notes list exactly like they walk tasks and mixed results.*
> **✅ RESOLVED** — user-tested.
> **How to test:** on the notes list (or in `f` results), `e` → the note opens in the **right-hand drawer**, list still visible. `J`/`K` → walk the list, the drawer follows. `o` in the drawer → promotes it to the full editor. `esc` → closes the drawer, cursor back on the list. `↵`/`o` from the list still go straight to the full editor.

## events

### Open

**e.9 — Gap: the calendar has no caller for the creation language.** The creation-language engine (`CL`, `docs/CREATION_LANGUAGE.md`) ships knowing how to build an **event** — `date → startAt`, `category → calendarId`, `body → notes` — and it's golden-tested. **Nothing calls it**, because the calendar has no text-entry creation surface at all: `i` on a day opens the event **drawer**, and there is nowhere to type `Retro /Work $friday`. Tasks and notes both got the grammar; events are the odd one out. *(Filed as a deliverable of the creation-language build; **no code** — this is a design call.)*
> *The engine half is **done and free**: `CL.apply('event', …)` is implemented and pinned by a golden, so this item is a **UI** question, not an engine one. What needs deciding:*
> - **Where does the bar live?** The calendar's main surface is a **grid**, not a list — there's no natural strip above a list of rows the way there is on tasks/notes. Candidates: a bar in the calendar header · a bar inside the **day-agenda drawer** (`e`), which *is* a list and already has an `i` that creates at the focused hour.
> - **What wins, the cursor or the token?** The grid cursor already implies a date (`i` creates on the focused day). If you also type `$friday`, one of them has to lose. Consistent with the rest of the grammar, **typed should beat implied** — the cursor is a default, exactly like a view's `due:` is on tasks.
> - **`type:` rule (e.5).** On a **tasks** calendar, `i` creates a *task*. A quick-add bar there should create a task and parse the **task** grammar (`!priority` becomes a symbol again) — the bar's type follows the app, not the surface.
> - *Cheapest first step, if you want one: put the bar in the **day-agenda drawer** only. It's already a list with a cursor and an `i`, so it needs no new layout thinking, and it's where you're standing when you actually schedule something.*

### Resolved issues

**e.8 — Feature: the agenda's SHIFT keys — `J`/`K` jump event-to-event, `H`/`L` change the day.** Started as *"`J`/`K` should jump event-to-event, not hour-by-hour"* (walking an empty day one hour at a time to reach the 3pm is tedious) and **generalized on the user's call** into the agenda's whole shift layer: *"in a similar vein of extending the navigation… `H`/`L` should switch days forward and back."*
>
> **The rule the agenda now follows, end to end: lowercase steps, uppercase jumps.**
>
> | | fine (lower) | jump (UPPER) |
> |---|---|---|
> | **vertical** | `j`/`k` — every stop, **including empty hours** | `J`/`K` — the next thing that's **actually there** |
> | **horizontal** | `h`/`l` — across overlapping events + the all-day / task chips | `H`/`L` — **previous / next day** |
>
> *That's the same shape as the calendar grid behind it (`h`/`l` = day, `H`/`L` = month): lowercase is the fine move, uppercase is the coarse one. Both new bindings were **unbound** in this drawer, so nothing was taken away — which is exactly why `h`/`l` keep crossing columns instead of being repurposed for days.*
>
> **`J`/`K` — DECIDED (user):** stop on **everything that has content** — the all-day strip, the dated-tasks strip, and each hour holding events (every `navCell` whose `type !== 'slot'`). One rule: *jump to the next thing that's actually there.* And **clamp, don't wrap** — `J` on the last item stays put, matching `j`/`k` here and `store.listSwap` everywhere else. A `J` that teleports you to the top of the day is a surprise, not a shortcut.
> *Built as a `jump(d)` index walk over the existing `navCells`, reusing `move()`'s arrival behavior (`cursor.col = 0` + `scrollFocusIntoView()`) — it differs from `move()` only in **which index it lands on**. `J`/`K` are **additive**: `j`/`k` still stop on every empty hour, because `i` on one is how you create at that hour.*
> ***The collision to stay aware of:*** `J`/`K` elsewhere mean "swap what the drawer shows" via `store.listSwap()` (**a.2**) — the agenda isn't a list-cursor consumer, so there's no conflict today, but if it ever registers one, this binding must still win while it has the keyboard.
>
> **`H`/`L` — the day switch.** *The trap here is ownership:* the **calendar** owns the cursor, and the drawer is a *view* of it (`store.dayDetailYmd`). Moving only the drawer's day would strand the grid cursor on the old date — `Esc` would drop you back on the wrong day, and `e` would reopen it. So the drawer **emits `shift-day`** and the app moves the calendar (`cal.moveCursor(±1)`, which already syncs year/month and reloads events across a month boundary) then re-points the drawer (`cal.openDay()`). The drawer's existing `ymd` watcher resets the cursor to the top and scrolls to morning, so a new day arrives clean.
>
> ***The `h`/`l` question this raised, and why it went the way it did:*** the user's first framing was `h`/`l` **and** `H`/`L` switching days — but `h`/`l` are **already bound** here (crossing overlapping events, and the chips on the all-day/task strips). Making them switch days would have deleted that. The alternative — `h`/`l` switch days only when there's nothing to cross — was rejected for the same reason **e.7**'s first build was: a key whose meaning depends on where the cursor happens to sit is unpredictable from the keyboard.
>
> **✅ READY TO TEST**
> **How to test — `J`/`K`:** open a day with a **9am and a 2pm and nothing else** (`e` on the day). `J` from the top → the all-day strip if there is one, else the dated-tasks strip, else the **9am** — **never an empty hour**. `J` again → the **2pm**, skipping the empties between. `K` walks back up. `J` on the **2pm** (nothing after it) → **stays put**; same for `K` at the top. `j`/`k` still crawl **every** hour, and `i` on an empty slot still creates at that hour. An **empty day** → `J`/`K` do nothing; `j`/`k` still walk it.
> **How to test — `H`/`L`:** in the agenda, `L` → **tomorrow's** agenda, `H` → **yesterday's**; the cursor lands at the top of the new day and the view scrolls to morning. **Watch the grid behind it: the calendar's day cursor moves too** — `Esc` leaves you on the day you navigated to, not the one you started on, and `e` reopens *that* day. Cross a **month boundary** (`H` from the 1st, `L` from the 31st) — the grid flips month and loads it. `h`/`l` still cross overlapping events and the all-day/task chips, unchanged.

**e.7 — Feature: `e` on the calendar was a dead key; make it open the agenda, and `E` open the day's one item.** Noticed after living with it: `E` (shift) opening the agenda is unintuitive when plain `e` does nothing at all.
> *Research first — **it was intentional, not an oversight.** `2E_UI_POLISH.md` §4.2: "**`E` = day schedule; `e` = event detail.** `e` is already 'edit/detail' for tasks … so `e` stays 'this item's detail' and **`E`** is 'this day's schedule.' The `E`-vs-`e` split is intentional but not yet fully designed." `e` **is** wired one level down — inside the day drawer it opens the focused event's detail. It was dead on the **grid** because the grid's cursor selects a **day**, not an item: there was no "focused item" for it to open.*
>
> **DECIDED (user):** swap the weight of the two keys and give `E` the smarter job.
> - **`e` → the agenda** (what `E` did). The common act gets the plain key.
> - **`E` → the agenda *plus* the day's item, opened beside it.**
>
> *First build gated that on the day having **exactly one** item in the view. **User rejected it after living with it:** "shift+E opens the agenda only occasionally and details other times and that's confusing because it's inconsistent." Correct — a key whose behavior depends on how many things happen to be on the day is unpredictable from the keyboard, which is the very complaint e.7 exists to fix.*
>
> **`E` now always opens the day's FIRST item** in the current view (only a genuinely **empty** day falls back to the agenda alone). "In the current view" is still the **filtered grid** — on a *birthdays* calendar the 4th's items are its birthdays, even if the 4th is otherwise packed — and the **agenda still shows the whole day** regardless (**e.6**: it's context, not a query result). **"First" = the agenda's own reading order**, so the two surfaces can never disagree: **all-day events → dated tasks → timed events by start**, with **title (alphabetical)** as the tiebreak for anything with no clock. Two birthdays on one day → the alphabetically-first one, deterministically.
>
> *Small, because both halves existed: `cursorItems` is built from `cells` — the same filtered sets the grid paints, so it already honors the query, the `type:` rule and the selected calendar — and `openEvent`/`openTask` are the day drawer's own methods. Works on a **tasks** calendar too (the first item is a task, and its drawer opens).*
> **✅ RESOLVED** — user-tested.
> **How to test:** on the calendar, `e` on any day → the agenda opens (as `E` used to). `E` on **any day with anything on it** → the agenda opens **and** the day's first item opens beside it — every time, no "sometimes". Two birthdays on one day → you get the alphabetically-first; a day with a 9am and a 2pm → the 9am. The agenda beside it still lists everything on the day, filter or no filter. `E` on a day the view shows nothing on → the agenda alone.

**e.6 — Bug: the day-schedule drawer renders blank and won't go away.** I put the app in a state where the day-detail drawer shows blank and won't go away. I think it happens when I press `i` on the item. It might just be opening the right-hand detail drawer with the **spacer** to make room for the hour drawer if it's there (and it's not, so it shows as blank). Biggest issue is that **the spacer doesn't go away when the task is saved/cancelled**.
> **Root cause — three separate faults, not one:**
> 1. **The "spacer" IS the day drawer, rendered empty.** It stacks (`.day-detail.stacked { right: var(--detail-w) }`, keyed off `eventDetailOpen || detailOpen`), so opening a detail drawer slides it left and you get two panels. An empty one reads exactly as leftover chrome.
> 2. **Why it's empty — a regression from e.5 (mine).** `dayOccs()` opens with `if (!store.gridShowsEvents()) return [];`. On a **tasks** calendar (`type:task`), that is always false → the day drawer shows **zero events, forever**: 24 empty hour rows. I applied the `type:` rule to the day drawer without noticing it turns that drawer into a permanently blank shell. The month grid degrades gracefully there (it still has task chips); the day drawer doesn't.
> 3. **Why it won't close.** `closeDrawers()` deliberately does **not** clear `dayDetailOpen` (that's what lets the day drawer persist *under* an event drawer — the §4.2 two-level stack), **and** the global Escape ladder has **no branch for it**. Escape only reaches the drawer via `dayKey`, which is gated behind `store.showsGrid()` — so whenever the grid isn't the active surface, or `focusPane==='detail'` grabs keys first, **Escape can never close it** and the `✕` is the only exit.
>
> *Bonus inconsistency: `i` **inside** the day drawer always creates an **event**, even on the tasks calendar where `i` on the grid creates a **task** (e.5). The drawer disagrees with the surface it sits on.*
>
> **DECIDED (user) — option A: the day drawer is a "what's actually on this day" surface, NOT a query result.**
> - It shows **everything scheduled that day — events *and* dated tasks — regardless of the current calendar or filter.** *"If you're at the point of inputting an event/task you probably want to see what else is happening that day with regards to the events/tasks you've already scheduled, regardless of if they're on your current calendar or filter."* So the `gridShowsEvents()` / `calShows()` / `calFilter` gates come **off** the day drawer. The **grid** answers the query; the **day drawer** shows the truth, because it's context for scheduling. This alone kills the blank.
> - **`i` creates what the app is about** — a task on Tasks, an event on Events — matching the grid (e.5).
> - **Inserting opens the day drawer**, with the target time-slot highlighted (the slot cursor + `createAt(hour)` already exist, so this is a small lift).
> - **Plug the leaks regardless:** give the global Escape ladder a day-drawer branch (Escape always closes it, in any state), and clear `dayDetailOpen` when the grid stops being the active surface.
>
> **✅ RESOLVED** — user-tested.
> **How to test:**
> - **The blank is gone.** On a **tasks** calendar (`v` from a task view), `E` on a day → the drawer shows that day's **events AND dated tasks**, not an empty hour grid. Same on the events calendar with a narrow filter (`label:…`) or a single calendar selected in the nav — the drawer always shows the **whole day**, because it's context, not a query result.
> - **Insert opens the day.** `i` on a grid day now **opens the day drawer** alongside the new item's drawer, so you can see what's already scheduled while you fill it in. On **Tasks** `i` makes a **task** (due that day); on **Events** an **event**. Inside the drawer, `i` on an hour slot does the same — task on Tasks, event on Events at that hour (it used to always make an event).
> - **It always closes.** `Esc` closes the day drawer from **any** state now (it was previously reachable only while the grid was the active surface — that's why it got stuck). It also closes itself if the grid goes away (you flip to the agenda list, or the query broadens to a mixed list).
>
> *Note: creating still uses the nav's selected calendar for a new event — the calendar filter now only affects what you CREATE, never what you SEE.*
>
> **Follow-up found while testing (fixed):** `i` on the tasks calendar **persisted a task immediately** — `addTask()` defaults an empty title to `'untitled'` — so every stray `i` left a junk row *and* a detail drawer sitting open on it. **Decided (user): don't persist until it has a name**, matching the notes editor (nothing hits the vault until it's named). `i` now opens the drawer on a **draft** that lives OUTSIDE `store.tasks` — so it never syncs, never shows in a list, and `J`/`K` can't land on it — and is committed only once it has a title. Backing out discards it. The drawer also lands the cursor **in the title** so you can just type.
>
> **Stack order:** the agenda sitting LEFT of the detail drawer is the original §4.2 model (*"opens the event detail drawer to its right"*) — confirmed as intended, left as-is.

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

**e.3 — Feature?: `h` doesn't reach the events nav** — the only way to get to the events nav lh drawer is by hitting `n`. In other apps like tasks and notes you can hit `h` and it puts you in the app nav drawer. However `h` on this one navigates you to the previous day, that makes sense. `H` will switch your month which is also desired. I'm not sure if I want to part with that functionality to make it consistent or just say "calendar/events are different and you've got to use `n` to get there." Open to suggestions on how to fix this. No code change for this one quite yet.
> *The genuine conflict in the "`h` at the edge" family (**n.9**, **n.10**). A suggestion is in Triage — the grid gives us a natural edge to work with.*
>
> **DECIDED — `h` stays "previous day" on the calendar; the events nav is NOT reachable with `h`.** The grid-edge rule was declined: `h`/`H` day/month nav is worth more than cross-app `h` symmetry, and the nav doesn't need a second door.
>
> *Instead, the door itself got better — a change that is **generic across every app, present and future** (see **a.6**): **`n` now takes you INTO the app nav** (landing on the project/view/calendar/folder/label you're currently on, exactly like `h` does), and **`n` again — while you're in it — closes it.** So on Events, `h` keeps the day cursor and `n` is the one-key way into the nav. Nothing is lost.*
> **✅ RESOLVED**
> **How to test:** on the calendar, `h`/`l` still walk days and `H`/`L` still walk months — `h` never leaves the grid. `n` drops you into the events nav on the calendar you're viewing; `n` again closes it.

**e.4 — Feature: shortcut to today.** It'd be nice if you could jump to today with the `t` key. Assuming it's not already bookmarked for something. We should underline the `t` in the today button next to the month name and year in the header. Maybe make that today button look more like a button in our style.
> *`t` is **completely unbound** — nothing global, nothing in the calendar's key map (`h/l/j/k` · `H/L/J/K` · `i` · `E` · now `v`). So it's free, and `cal.today()` already exists (the button calls it). This is a **binding + a restyle**, not a feature. Small enough to ride along with anything. Note the button underline must wrap its label in a single element — a bare `<u>t</u>oday` next to loose text hits the `.btn` flex-gap trap from **n.8**.*
> **✅ RESOLVED** — *verified by the user.*
> **How to test:** on the calendar, `t` jumps to today (from any month). The header's `today` control is now a real button reading `today` with the **t** underlined — and it renders cleanly, with no `t oday` gap (its label is wrapped in a single span; `.btn` is `inline-flex` with a gap, the **n.8** trap).

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

### Resolved issues

**a.1 — Bug: no space between the count and the view title in the header.** The header view/query counts like open overdue urgent appear as `13open | 10overdue | 2urgent`. Look into the root cause here don't auto fix it.
> ***This one is mine, and recent.*** *When I gated the count badges (so event/note views don't show a bogus `0`), I wrapped the count in a `<template v-if>` and left the separating space **inside** it — Vue's whitespace condensing then drops that trailing space. Fix is to own the spacing in CSS/markup rather than rely on a text-node space. Same cosmetic bucket as **n.8**.*
> **✅ RESOLVED**
> **How to test:** look at the header — `13 open │ 10 overdue │ 2 urgent`. (My regression: the separating space was a whitespace-only text node inside a `<template v-if>`, which Vue drops at compile time. It's now folded into the interpolation.)

**a.2 — Bug: `j`/`k` don't work on mixed item lists.** It seems to still work as designed in task only views. Event only views don't seem to display as lists (see **e.1**) and notes open the note in full screen instead of a rh side drawer. However mixed lists show all items and should be navigatable through `j`/`k` to switch detailed items without closing the rh side bar. Let's make sure we write this in a way that doesn't duplicate the existing logic that works for tasks and find an intelligent way to implement this so we don't have duplicate code. We should resolve this after we're happy with keyboard nav for notes and events.
> *Agreed on the sequencing, and it's the right instinct: this should be the **generalization** of the task-list cursor, not a second copy of it. Depends on **e.1** (events need a list) and **n.3** (notes need the drawer/ladder). Do it last — it's the capstone that proves the model is actually shared. **e.1 shipped, so this is unblocked.***
>
> **CLARIFIED (user) — it's `J`/`K` (SHIFT), not `j`/`k`.** The escalated pair is the whole point, and it got lost in the original write-up:
> - **`j`/`k`** navigate the **fields of the right-hand drawer** (the KbForm ladder).
> - **`J`/`K`** walk the **list underneath** and swap which item the drawer is showing — **without closing it**. That's the behavior in prod today for tasks, and it must carry through to mixed/event lists.
>
> *Confirmed in code: `detailSwap(dir)` (`index.html`) walks `store.visibleRows()` and reassigns `store.selectedTaskId`, bound to `J`/`K` and gated on `focusPane==='detail'`. It is **task-only** — hard-wired to `selectedTaskId` and the task list's rows. `mixedKey` has **no `J`/`K` at all** (only `j`/`k`/`l`/`e`/Enter/`h`).*
>
> *So the generalization is precisely: one list cursor + one "swap the open drawer to row N" that works per-type (task → task drawer · event → event drawer · note → the note **peek drawer**, per §4.3 — not the full-screen editor it opens today).*

a.3 Bug: the view list screens pop you back to the Tasks app if you select an everything list. I would prefer if it kept you in whatever app you're currently in. This would apply to situations where we've searched 2/3 of the types as well. 
> **✅ RESOLVED** — *verified by the user.*
> **How to test:** on a **mixed** list (or an **event** list), open any item, then press **`J`/`K`** — the drawer swaps to the next/previous item in the list **without closing**, and it works **across types** (task → event → note, each in its own drawer). `j`/`k` still drive the open drawer's fields. It clamps at both ends. With **unsaved edits** in the event/note drawer it asks before discarding them.
>
> *Built as one **shared list cursor**, not a second copy: whichever list is on screen (`tasklist` or `mixed-list`) **registers** `{rows, index, go}` with the store, and every drawer calls the single `store.listSwap(dir)`. `detailSwap` — which was hard-wired to `visibleRows()` + `selectedTaskId` — is **deleted**; the task list now registers that same logic behind the shared interface. `J`/`K` had to be added **inside** the event/note drawers (`kbDelegate`), because they are KbForm takeovers with their own key listener and the app's `onKey` bails while they're open. A dirty guard was added: those drawers snapshot their entity and are remounted on id change, so a swap would otherwise **silently bin unsaved edits**.*

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

**a.6 — Feature: `n` should take you INTO the app nav, and close it on a second press (all apps).** Right now I hit `n` twice — once to close it, once to reopen and land in it. Short-circuit that: if the nav is open, `n` puts me in it on whatever project/view/calendar/folder/label I'm on (just like `h` does); pressing `n` while inside it toggles it closed. Same for **`N`** and the app rail — consistency with muscle memory matters more to me than keystroke count. *(This is what makes **e.3** acceptable: if the nav is one key away, it doesn't matter that `h` can't reach it on the calendar.)*
> *Confirmed, and the asymmetry was real: **`N` already worked this way** (`toggleDeepNav` branches on "am I IN it?"), but **`n` branched on VISIBLE vs HIDDEN** — so on a visible-but-unfocused nav (the normal state) it just collapsed the thing, forcing the double-press. Generic across every app, present and future: the nav is one key away everywhere.*
> **✅ RESOLVED**
> **How to test:** from any app (Tasks / Events / Notes), press **`n`** → the nav takes focus, landing on the **project/view/calendar/folder** you're currently viewing (same landing rule as `h`). Press **`n`** again → it closes and hands the keyboard back to the list. If the nav was collapsed, `n` reveals it *and* enters it in one press. **`N`** does the same for the app rail. On mobile, `n` reveals/hides the slide-in.
>
> *One-line change: `toggleNav()` now branches on `showing && focusPane==='side'` — mirroring `toggleDeepNav()` exactly — instead of on `navCollapsed`. `n`/`N` are intercepted before the pane dispatch, so they still fire from inside the nav (which the close case needs).*

**a.7 — Bug: opening a multi-type view (e.g. "Everything") always dumps you back in the Tasks app.** Long-standing, noticed for a while. Select an "Everything"-style view from the **Events** or **Notes** nav and you get yanked to the **Tasks** app instead of staying where you were. **Captured only — no code yet.**
> *Root cause confirmed, and it's structural rather than a slip. `store.openQueryView` (`js/data.js`) routes a saved view to a screen **purely by the view's own `type:` tokens**, and never considers **which app you're standing in**:*
> - *exactly one type, `event` → the calendar screen*
> - *exactly one type, `note` → the notes screen*
> - ***everything else → `kind:'query'`, which is the Tasks screen***
>
> *So any view spanning **more than one** type falls into that last branch by construction — Tasks is the catch-all. Meanwhile `store.viewMatchesApp` deliberately surfaces such a view in **every** nav whose type it includes (a `type:task,event` view appears in both the Tasks and Events navs). The two rules disagree: **the nav offers it to you from Events, and the router then moves you to Tasks.***
>
> **DECIDED (user) — "don't boot me to Tasks: keep me in the app I'm already in."** Approved to fix.
>
> *Implementation follows the spec directly: `openQueryView` keeps its type-derived routing as the **fallback**, but first — if the view's `type:` tokens **include the current app's native type** — it stays put (`store.currentApp()`). An "Everything" view opened from Events stays on Events; from Notes stays on Notes; from Tasks stays on Tasks. Only a view that genuinely can't be shown in the current app (e.g. a notes-only view opened from Events) falls back to the type-derived screen.*
>
> *Interacts with **e.1**/**e.5** in our favour: a `type:task,event` view is grid-capable, so "stay in Events" correctly renders it on the **calendar**, drawing both events and dated tasks.*
> **✅ RESOLVED** — *verified by the user.*
> **How to test:** open an **"Everything"** (multi-type) view from the **Events** nav → you **stay in Events** (and it renders on the calendar, drawing both events and dated tasks); from the **Notes** nav → you stay in Notes. A view that genuinely can't be shown where you are (a notes-only view opened from Events) still routes to its own app. Switching apps via the rail, `#/tasks`, the calendar toggle, or a fresh load still lands on **Tasks** as before.
>
> *`openQueryView(sv, forceApp)`: `forceApp` wins → else stay in the current app when the view's types include its native type → else the old type-derived routing. **The trap:** five call sites use this function as "go to the Tasks app" (the app rail, `switchApp`, `toggleCalendar`, `#/tasks`, boot). A naive "stay put" rule would have stranded you in Events when you explicitly asked for Tasks — they now pass `'tasks'` explicitly.*

**a.8 — Bug: only the task drawer animates; the others pop in.** The task right-hand drawer slides out with a clean animation, the event/note drawers don't. I assumed they'd all share the same appearance logic since that's the efficient way to code it.
> *Right assumption, wrong reality — they **do** share the CSS, they just never get to use it. `.detail` carries `transform: translateX(100%)` + `transition: transform .16s ease`, and the **task drawer is ALWAYS MOUNTED**, toggling a `.hidden` class — so it slides both ways. The event, note and **day-schedule** drawers are `v-if`, so they mount already at their final position (no slide in) and are ripped out of the DOM on close (no slide out). Same stylesheet, zero animation.*
> **✅ RESOLVED** — *verified by the user.*
> **How to test:** the **event**, **note** and **day-schedule** drawers now slide in/out exactly like the task drawer. Opening a *second* item while a drawer is open swaps its contents **in place** (no re-slide, no flicker) — including a `J`/`K` swap.
>
> *Fixed with one `<transition name="drawer">` per v-if drawer, reusing the **same** transform + transition `.detail` already had — one appearance model, not a second one. It also forced a real improvement: the `:key` remount added for **e.2** reads as a leave+enter to `<Transition>`, so it would have flickered the drawer on every swap. Both drawers now **re-seed in place from a watcher** (`store.editingEvent` / `store.selectedNoteId`) instead of being remounted — cheaper, keeps scroll position, and e.2 still holds (verified: pointing the drawer at a second event re-seeds the form and resets its dirty baseline).*

---

## Triage — what's left

**24 items raised · 22 resolved · 2 gated.** Nothing is blocked, and nothing is in flight.

### ⛔ GATED ON THE USER — suggestions only, NOT approved to build
- **n.11 — keyboard-navigable wikilinks.** Rides on **n.3** (shipped). Suggestion for *discussion*: a **hint-label overlay** (Vimium `f` style) — press a key, each visible link gets a letter, press the letter to follow it. Reuses no cursor state and doesn't fight the block cursor. Alternative: `Tab`-cycling links in the current block — simpler, clumsier in long notes.
- **n.15 — the notes search box is mouse-only.** A **surface question before a keyboard one**: it's a *third* search surface next to the global `/` find and the query bar. The real question is whether it should exist at all, given `folder:` is already a query field. It may dissolve into the query bar rather than need a key.

**These two are the user's call.** Do not implement either until explicitly approved — the ideas above are conversation starters, not a plan.
