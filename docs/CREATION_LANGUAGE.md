# Creation language — one grammar, one engine, three apps

> **Status: SLICE 1 SHIPPED** — `#` `$` `/` `{…}` on tasks **and** notes, through one engine
> (`frontend/js/create.js` → `window.CL`, golden-tested in `test/create.test.cjs`). Tracked as
> **n.17** in `KEYBOARD_AUDIT.md`. **Deferred:** `%` `*` `^` (the multi-word values) and `@`
> (needs multi-user). **Events are engine-only** — `CL.apply('event', …)` works and is tested, but
> the calendar has no text-entry surface to type into: **e.9**.
>
> **What the build changed in this doc** — three rules the design didn't have, all forced by tests:
> **first-wins** for single-valued fields · **`CL.nameMatch`** (the query engine's own slug-or-substring
> rule) for `/` · and **`parse` must be pure** (`store.addLabel` *creates*; ghost-completion reparses
> every keystroke). Each is written up where it belongs below.

## The idea

Type the thing, don't fill in a form. **Every symbol on the number row is a field**, so a whole item
can be created in one line without leaving the input:

```
Call the plumber /home #errand !2 $friday *thu 9am ^3 {ask about the leak under the sink}
```

Two rules make it learnable rather than a pile of trivia:

1. **A symbol means one idea, everywhere.** `$` is always "the date". `/` is always "where it
   lives". You learn the symbol once, not once per app.
2. **One engine parses it for every type** — exactly like `Q` parses one query language for tasks,
   events and notes. The engine doesn't know what a task is. It parses **abstract fields**, and each
   type maps those onto its own columns.

That second rule is the whole design. Without it, `$` drifts into meaning three slightly different
things and the docs become a matrix nobody reads.

---

## Architecture — the shared engine

**`frontend/js/create.js` → `window.CL`**, the creation-language sibling of `window.Q`.

```
CL.parse(text)            → { title, fields, literal[] }      // type-agnostic
CL.apply(type, parsed, ctx) → a payload for that type          // the only type-aware part
```

**`CL.parse` is pure and knows nothing about tasks.** It scans the line, pulls symbol tokens, and
returns **abstract** fields:

| abstract field | produced by | value shape |
|---|---|---|
| `labels` | `#` | `['home', 'errand']` (names, not ids — resolution is `apply`'s job) |
| `priority` | `!` | `0`–`5` |
| `assignee` | `@` | a username |
| `date` | `$` | `YYYY-MM-DD` |
| `recurrence` | `%` | the raw phrase, validated by `Rec` |
| `reminder` | `*` | `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM` |
| `size` | `^` | a Fibonacci value |
| `category` | `/` | a name (`home`, `dev/tdx`) |
| `body` | `{…}` | free text |

**`CL.apply(type, …)` is the only place a type is named.** It's a small table, not a pile of `if`s:

| abstract | **task** | **note** | **event** |
|---|---|---|---|
| `labels` | `labels` | `labels` | `labels` |
| `date` | **`due`** | **`reviewAt`** | **`startAt`** |
| `category` | **`projectId`** | **`folderId`** | **`calendarId`** |
| `body` | `notes` | **`body`** | `notes` |
| `priority` | `priority` | — | — |
| `assignee` | `assigneeId` | — | — |
| `recurrence` | `recurrence` | — | `recurrence` |
| `reminder` | `reminder` | — | `reminder` |
| `size` | `size` | — | — |

**This is not a new idea — it's the one the query engine already proved.** `due:` already means a
task's due date *and a note's review date*; `category:` already unifies project · calendar · folder
(`query.ts:236`). The creation language mirrors the query language's own mapping, so the two halves
of the app agree about what a field *is*.

**A `—` means the type has no such field.** The symbol is then **not parsed at all** for that type —
it stays **literal title text**. A note titled `Ship v2 !!!` keeps its exclamation marks; `!` is not
a dead symbol on notes, it's simply not a symbol there. The engine never silently drops what it
can't use.

### Where the engine lives

Client-side only, to start: the quick-add is a frontend surface, and every creation path already
posts a fully-formed payload. **If it ever needs a server twin** (an API that accepts raw text, a
mail-drop, a CLI), it follows the query engine's convention exactly — `server/src/create.ts` ≡
`frontend/js/create.js`, **parity-locked with goldens**. Design it now as a pure function with no
DOM and no store access (`ctx` is passed in) so that port is mechanical when it comes.

---

## The symbol table

| Symbol | Idea | Tasks | Notes | Events |
|---|---|---|---|---|
| `#` | label | **shipped** | **port (1:1)** | port |
| `!` | priority | **shipped** | — | — |
| `$` | **date** | **NEW — due date** | **NEW — review date** | **NEW — start date** |
| `/` | **category** | **NEW — project** | **NEW — folder** | **NEW — calendar** |
| `{…}` | body | NEW — inline note | **NEW — body** | NEW — notes |
| `%` | recurrence | NEW | — | NEW |
| `*` | reminder | NEW | — | NEW |
| `^` | size | NEW | — | — |
| `@` | assignee | **reserved** | — | reserved |

Unclaimed on the number row: `&` `(` `)` `-` `_` `=` `+`. **Keep at least one free** — a grammar with
no spare symbols can't grow without breaking muscle memory.

### `$` — due date on tasks (the reason this is worth doing now)

Tasks have **no typed date token today**. A task's due date comes from *view-defaults inheritance*
(below), which is invisible and only works if you happen to be standing in the right view. `$friday`
is the single most useful thing this grammar adds, and it's what makes the shared engine pay for
itself immediately rather than being an abstraction waiting for a second caller.

### `/` — the categorizer

One symbol, per-app meaning: **project** (tasks) · **folder** (notes) · **calendar** (events). It's
path-shaped, which is *literally true* for notes (folders are directories), it reads nested
(`/dev/tdx`), and it stays off the number row so it doesn't compete with the field symbols. Resolve
by the same `slug()` match the query engine uses, so `/tdx` finds `tdx-app` exactly the way
`project:tdx` does.

---

## Parsing rules

**Everything unrecognized is title text.** The grammar must never eat what it doesn't understand.
The fallback is always "this was part of the name" — and `CL.parse` returns a `literal[]` of spans it
deliberately left alone, so the UI can show what it did and didn't claim.

**FIRST WINS for every single-valued field.** A second `!N` / `$date` / `/category` is **literal**, not
an overwrite: `Priority zero !0 and five !5` → priority **0**, and the `!5` stays in the title. (Labels
are the only repeatable field.) This is what the original `parseQuickAdd` did — its `!` replace was
non-*global* — and it's the only rule that stays predictable while you're editing a half-typed line.

**A `/` matches names exactly as the query engine does** — `CL.nameMatch` is `catNameMatch`: slug
equality **or substring**. So `/tdx` finds `tdx-app` precisely the way `project:tdx` does. Typing a
categorizer and querying one must never disagree about what a name is.

**`parse` is pure; `apply` owns every side effect.** `store.addLabel()` **creates** the label it looks
up, and ghost-completion re-parses on **every keystroke** — a parser that resolved labels would litter
the label list with `#b`, `#br`, `#bra`… So `parse` returns label **names** and `apply` resolves them.
A test asserts the label list doesn't grow during a parse.

**Dates (`$`, `*`).** Parse as many human formats as we reasonably can:

- **Prefer American order** — `6/7/2026` is **June 7, 2026**.
- **Fall back to the only possible reading** — `13/7/2026` can only be **July 13, 2026** (there is no
  13th month). The rule: *month-first when both readings are possible; the possible one when only
  one is.*
- **ISO always wins** — `2026-07-13` is never ambiguous, and it's the format to document.
- **Separators** — `/`, `-`, `.` (`6.7.2026`). *(Note `/` is also the categorizer — a date is only
  read after `$`/`*`, so there's no ambiguity: `$6/7/2026` is a date, `/6` is a category.)*
- **Relative + named** — `today`, `tomorrow`, `friday`, `next mon`, `eom`.
- **Times only where a time is meaningful** — reminders (`*thu 9am`, `*17:30`) and timed events. A
  due date is day-grained, matching `due:` in the query language.

**Multi-word values need a terminator, and that's the hard part.** `#home` ends at whitespace, but
`%every 3 days`, `*thu 9am` and `$next monday` **contain spaces**. In preference order:

1. **Hand the span to the real grammar and let it consume greedily** — `Rec` for `%`, the date parser
   for `$`/`*` — stopping at the first token it can't take. One source of truth for recurrence
   syntax, and no new punctuation to learn.
2. Run to the **next symbol token** or end-of-line and hand over the whole span.
3. **Braces as an escape hatch** for the pathological case: `%{every 2nd tuesday}`.

**Collisions to guard** — the ones that will actually bite:

- **`$5`** — "pay Bob $5" must not become a due date. Guard: `$` opens a date **only if what follows
  parses as one**; otherwise it's text. (Same shape as the existing `!N` guard, which already keeps
  `Hello!` and `!10` as text.)
- **`50%`** — safe: `%` is a *prefix*, so only `%`-then-recurrence counts.
- **`10/6` in a title** — safe: bare `/` opens a category, and `10/6` has no leading `/`.
- **markdown** (`*`, `#`, `{}`) — only the **quick-add line** is ever parsed, never the body. Still
  worth an escape (`\#`) for the person who wants a literal.

---

## The part that isn't grammar at all — and matters more

Most of what *feels* like creation language on tasks is **view-defaults inheritance**
(`store.viewDefaults()`, `data.js:586`): a new task silently inherits the project, labels, due date
and done-state implied by **the view you're standing in**, parsed from the active query — not from
anything you typed.

**Notes inherit only the folder.** Create a note while standing in a `label:work` notes view and you
get an unlabeled note that vanishes from the list the moment you escape — exactly the case the
quick-add's `⚠` exists to warn about. **Porting the inheritance makes the `⚠` fire *less*, because
the new note would actually satisfy the view it was made in.** `store.viewDefaults()` is task-shaped
(`project:`/`status:`/`due:`), so it needs a per-type sibling — and once `CL.apply` exists, that's
the natural home for it:

> **Precedence: what you TYPED beats what the view IMPLIED.** `$today` in a `due:friday` view means
> today. The view only fills what you left blank.

That's the highest-value half of this work, and it needs no new symbols.

---

## Suggested order of work

1. **`CL.parse` + `CL.apply` + `#` and `$`, on tasks and notes together.** Ships the engine, ships
   the one token that's a true 1:1 port, and ships **typed due dates on tasks** — the thing with the
   most daily value. Tasks keep `!` (already shipped) as the engine's first "task-only field" case,
   which proves the `—` rule works.
2. **View-defaults through `CL.apply`**, with typed-beats-implied precedence, and the notes-shaped
   sibling of `viewDefaults()`. Shrinks the `⚠` rule instead of fighting it.
3. **`/` categorizer**, across all three apps at once — it's one decision and it should land as one.
4. **`%` `*` `^`** on tasks (and `%`/`*` on events), once the greedy-consume approach has been proven
   by `$`.
5. **`@` assignee**, whenever multi-user lands.

**Ghost-completion travels with the grammar, not with `#`.** `tagGhost`/`acceptTag` (Tab/→ to accept)
is what makes the syntax discoverable at all — the same affordance should complete `/projects` and
named dates, or half the grammar stays invisible.
