# Scoping: Canonical schema + backend validation (toward multi-frontend & t_320 sharing)

> Status: **reference / scoping — not scheduled.** Captures what a single canonical data model
> + backend-enforced validation would look like, so a second frontend (and eventually cross-account
> sharing, t_320) can't drift the data. Nothing built. Open decisions at the bottom.

## Why this exists
Two goals push the same direction:
1. **A second frontend** (e.g. a mobile "unicorn" UI for a second account) pointed at the same API.
2. **t_320 cross-account sharing** — pulling up each other's tasks / sharing across the two apps.

Both require that **all clients store data in exactly one canonical shape**. Today that shape is
defined *implicitly by the current frontend*; the backend stores whatever it's handed. The moment a
second, independently-built client exists, it can write divergent data (wrong priority encoding,
unparseable recurrence, dangling project references) and there's nothing to stop it. The fix is to
make the **backend the schema authority**.

> Key reframe (the priority example): `priority` is already stored as an **integer 0–5**; the
> `v.low … v.high` text is just how the current frontend *renders* it. So the rule is **store the
> canonical value, render per-frontend.** Sharing is safe as long as the backend guarantees the
> stored value is the int — then "1–5" vs "v.low–v.high" is purely a display choice, never a
> data-compat problem.

## What the backend validates today (≈ nothing)
`writeState` (`backend/src/state.js`) does light **coercion**, not validation:
- booleans → `0/1` (`done`, `collapsed`, `system`)
- `priority`: `Number.isInteger(p) ? p : 0` — coerces non-ints to 0, **no range check**
- `title ?? 'untitled'`, other nulls defaulted
- one real guard: a task→label link is inserted only if that label id is in the same payload

**Not** checked: priority range, `due`/`reminder` formats, `recurrence`/`query` parseability,
`projectId`/`parentId` referential integrity, id formats, color/glyph values, name/title lengths.
(User prefs — `theme`, `week_start`, `sort_prefs` — *are* validated in `routes/auth.js`; that's the
pattern to extend to the entity data.)

## Canonical schema (the single source of truth to enforce)

### task
| field | type / rule |
|---|---|
| `id` | `^t_[0-9]+$` (or a seed id); unique per user; ideally **server-generated** (Phase 2) |
| `projectId` | references an existing project (same user); never dangling (default → `p_inbox`) |
| `parentId` | `null` or references an existing task; **no cycles**; parent is a root/task, not self |
| `title` | string, trimmed, 1–500 chars (empty → `untitled` or reject) |
| `done` | boolean |
| `due` | `null` or `YYYY-MM-DD` that is a real calendar date |
| `reminder` | `null` or `YYYY-MM-DDTHH:MM` |
| `recurrence` | `''`/`null` or a string `Rec.parse()` accepts (not `type:'invalid'`) |
| `notes` | string, length cap (e.g. ≤ 10k) |
| `priority` | integer **0–5** |
| `createdAt` | `YYYY-MM-DD` (or ISO) date |
| `completedAt` | `null` or a date; non-null iff `done` (consistency) |
| `labels` | array of existing label ids (deduped) |

### project
| field | type / rule |
|---|---|
| `id` | `^p_[0-9]+$` / seed; unique per user |
| `parentId` | `null` or existing project; no cycles |
| `name` | string, trimmed, 1–100 |
| `color` | one of `COLORS` (palette) or a valid `#rrggbb` |
| `glyph` | one of `GLYPHS` or a single grapheme |
| `collapsed` | boolean |
| `position` | integer (array order) |

### label
| field | type / rule |
|---|---|
| `id` | `^l_[0-9]+$` / seed; unique per user |
| `name` | lowercased; **slug-unique** (no two labels with the same `Q.slug(name)`) |

### saved_query (view)
| field | type / rule |
|---|---|
| `id` | `^sv_[0-9]+$` / seed; unique per user |
| `name` | string, 1–100 |
| `glyph` / `color` | as project |
| `query` | a string `Q.parse()` accepts |
| `system` | boolean (preserve the built-in views) |
| `position` | integer |

### task_labels
Derived from `task.labels`; both ids must exist for the user (already half-guarded).

## What lands in `writeState` (Phase 1, concrete)
Add a validation/normalization pass before the inserts in `writeState`:
1. **Coerce + clamp** scalars to the table above (priority → `0..5`, booleans, trimmed strings, length caps, date-format checks → null on bad format or reject — decision #1).
2. **Reuse the pure grammars:** `require()` `recurrence.js` (`Rec.parse`) and `query.js` (`Q.parse`) on the backend to validate `recurrence` and saved-view `query` strings with the *same code the frontend uses*. (These are currently browser globals — small task to make them `require()`-able; see decision #4.)
3. **Referential integrity:** drop/repair dangling `projectId` (→ `p_inbox`), `parentId`, and `task.labels` ids; reject parent cycles.
4. **Slug-dedupe** labels.
5. **Policy** (decision #1): on a bad entity, either **reject the whole PUT** with a field-pointed 400 (surfaces client bugs loudly) or **sanitize/clamp and accept** (never bricks saves in the snapshot model) — possibly returning a "what we changed" report.

This alone makes a second frontend **safe to build**: no client can poison the store, and display
encodings (1–5 vs v.low–v.high) become irrelevant to compatibility.

## Shared-core boundary (don't duplicate the rules)
- **Already portable:** `query.js` (filter grammar/matcher) and `recurrence.js` are **pure JS, zero
  DOM/Vue**. Both the backend (validation) and any frontend can use them.
- **New `core/schema.js`** — the canonical field rules + validators/normalizers in one module,
  imported by **both** the backend (authority) and the frontends (instant UX feedback). One place to
  change a rule.
- **Extract pure helpers from `data.js`** (sort comparator, quick-add parse, due-window math, the
  CRUD-on-plain-arrays operations) into the shared core too, so a second frontend gets identical
  behavior instead of reimplementing it. (Overlaps the "second frontend" discussion.)
- **Module-format wrinkle:** the frontend loads these as `window.Q`/`window.Rec` via `<script>`; the
  backend uses CommonJS `require`. To share cleanly, give them a dual export (UMD-ish:
  `typeof module!=='undefined' ? module.exports : window.X = …`) or a thin Node shim. Small but real.

## Phasing toward t_320 (sharing)
Sharing is **more than validation** — the current **whole-state snapshot PUT** (delete-all-my-rows,
re-insert) can't host rows two people both edit. So:

1. **Phase 1 — canonical schema + `writeState` validation** (small–medium). Prereq for *any* second
   frontend. Makes the data model authoritative and display-independent. **The cheap, high-value step.**
2. **Phase 2 — granular, server-authoritative API** (medium): per-entity `POST/PATCH/DELETE` with
   server-owned ids/timestamps and per-mutation validation; reads can stay snapshot-style at first.
   Needed for robust multi-client and as the foundation for sharing.
3. **Phase 3 — ownership + sharing/permissions** (large, t_320): rows owned by a user or a shared
   "space," with read/write grants and attribution, on top of Phase 2.

## Effort
- Phase 1: ~1–2 days (validators + wiring `Rec.parse`/`Q.parse` server-side + the dual-export tweak).
- Phase 2: meaningfully larger (new endpoint surface, id/timestamp ownership, client rework off the blob).
- Phase 3: its own project (data model + permissions + UI).

---

## Open decisions
1. **Validation policy:** strict **reject-the-PUT** (loud, great for catching client bugs) vs
   **sanitize-and-accept** (never blocks a save; return a change report). The snapshot model leans
   sanitize; a future granular API leans strict-per-mutation. Could do: sanitize now, strict later.
2. **Server-owned ids/timestamps?** Move id generation + `createdAt`/`completedAt` authority to the
   backend (prevents collisions/spoofing, needed for sharing) — or keep client-generated for now.
3. **Where the canonical constants live** (`COLORS`, `GLYPHS`, sort keys, priority range): in the
   shared `core/schema.js` imported by both sides, so front and back can't drift.
4. **Make `query.js`/`recurrence.js` dual-export** now (so the backend can validate with them), or
   keep a separate backend copy? (Separate copy risks drift; dual-export is the clean answer.)
5. **Scope of Phase 1:** validate everything up front, or start with the highest-risk fields
   (priority range, due/reminder format, recurrence/query parseability, referential integrity) and
   grow?
6. **Is this worth doing before the second frontend, or alongside it?** Phase 1 is cheapest *before*
   a second client exists (no migration of bad data to clean up later).
