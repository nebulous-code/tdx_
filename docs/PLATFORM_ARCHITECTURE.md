# Platform Architecture — from "tdx the app" to "a personal-data core"

> Status: **architecture exploration / thinking doc.** Nothing to build yet. The goal is to decide the shape of the backend so tdx, a calendar, and a notes app (and a CLI, and AI agents) can all sit on one well-guarded core — and so the pieces can interlink. Built up incrementally over time, like tdx was.

## The vision in one paragraph
Today tdx is a *fat client* over a *dumb store*: the server dumps the whole user dataset, the browser does all query/validation/creation, then PUTs the whole thing back. To add a **calendar** and an **Obsidian/vim-style notes** app — and to let a **CLI** and **AI agents** participate without bypassing our rules — we want to invert that: a single **core service** owns the data model, validation, query engine, and business logic, and *every* surface (tdx web, calendar, notes, CLI, MCP) is a thin client of the same contract. The three domains share one entity graph so they can interlink: tasks show on the calendar, events show in the to-do list, tasks embed in notes, notes attach to tasks.

## Decisions locked (this round)
- **Core language: TypeScript first.** Reuse `query.js`/`Rec` so the migration moves as few parts as possible — if a query breaks we'll know it was the *API* port, not a *language* port. Rust stays a later option once the contract is proven and daily-driven.
- **Notes content lives in raw files on disk, not in the DB** — intentional, to keep nvim/Obsidian access and adopt an existing vault. The DB *shadows* the files with a rebuildable index (see §4).
- **Links are fully generic, any-item-to-any-item** — one edge table, any type ↔ any type, so new domains (recipes, contacts, …) link to everything for free (see §3).
- **Contract: REST + OpenAPI**, query engine as a first-class endpoint.
- **No big bang across deliverables.** Ship D1 (below), daily-drive it, *then* build D2.

## Deliverables (split — per your call)
This started as one "platform" idea; the sane build order is two deliverables, designed side-by-side but shipped in sequence:
- **Deliverable 1 — Backend rewrite (tasks only).** Re-implement today's task backend as a granular, validated **TypeScript** API with the query engine + recurrence moved server-side; kill the `PUT /api/state` snapshot. Done as **one push** (rewrite → deploy → daily-drive → log any functionality lost), not an incremental snapshot-coexistence. This is the whole near-term focus. (TDD is worth considering here — see open threads.)
- **Deliverable 2 — Notes & events.** Add the `event` and `note` domains, the generic `links` table + the rel taxonomy (§3), the file-backed-notes scanner (§4), and eventually the calendar/notes UIs. *Designed now, alongside D1; built after D1 is solid.*

> **Pinned (separate, larger conversation before any D1 code):** auth / accounts / authorization — multi-user, task sharing, read-only AI tokens. Decide this once so we don't rebuild the backend a third time. One TDX account → all apps is agreed; the rest waits until the D1/D2 design settles.

---

## 1. Where we are (and why the middle layer is the weak point)
- **Transport = whole-state snapshot.** `GET /api/state` returns *all* projects/tasks/labels/savedQueries; `PUT /api/state` deletes-and-reinserts the entire dataset from a client snapshot, guarded by one per-user `state_version` (optimistic concurrency). Granular endpoints exist only for the recent soft-deletes (`POST /api/{projects,tasks}/:id/delete`).
- **Logic lives in the browser.** The query engine (`query.js`), recurrence (`Rec`), input validation, and task creation all run client-side. The server is mostly a typed blob store + auth + backups.
- **Single domain.** The schema knows only tasks/projects/labels/views. Auth is **cookie-only** (browser sessions), so a CLI/agent has no first-class way in.

Consequences that block the vision:
1. **A new frontend or app must re-implement all the logic** (query, validation, recurrence) to be correct.
2. **No safe non-browser client.** A CLI/agent either re-does the snapshot dance or talks to SQLite raw — bypassing every invariant.
3. **No shared model to link across.** Calendar/notes can't reference tasks because there's no entity/link layer, only a tasks-shaped blob.

> The fix isn't "add endpoints to tdx." It's "make the **core** the authority and the apps thin." The snapshot model was the right call for a solo offline-ish app; it's the ceiling for a platform.

---

## 2. Target shape: one core, many thin clients
```
        ┌──────────── clients (thin) ────────────┐
  tdx web   calendar web   notes web   CLI   MCP server (for agents)
        └───────────────┬─────────────────────────┘
                        │  one typed HTTP contract (OpenAPI / shared schema)
              ┌─────────▼──────────┐
              │     CORE SERVICE   │  owns: data model, validation, query engine,
              │  (TypeScript)      │  recurrence, links, auth/scopes, business rules
              └─────────┬──────────┘
                        │
                 SQLite (+ FTS5, + vectors)   [markdown: see §4]
```
The core is the **single place** that knows the rules. Every client — including agents — goes through it, so validation/safeguards/permissions apply uniformly. "Everyone plays the same game" = the contract is the only way in.

---

## 3. Unifying data model: typed entities + a generic link graph
Keep clean per-domain tables; add **one edge table** for cross-domain links.

**Entities** (each `user_id`-scoped, each its own table — tasks/events/notes plus the existing projects/labels/saved_queries):
- `task` (today's tasks; due, recurrence, priority, size, …)
- `event` (calendar: start/end, all-day, location, recurrence)
- `note` (markdown body + title; storage in §4)

**Links — the system is an entity graph.** Your instinct is the right backbone: one generic edge table, **any typed item ↔ any typed item**. New domains (recipe, contact) become linkable to *everything* the moment they exist — link a recipe to tomorrow's calendar event, a note to a meeting event, a task to a note, with the same mechanism.
```
links(user_id, id, src_type, src_id, dst_type, dst_id, rel, data?, created_at)
  rel ∈ { note-of, mentions, scheduled-as, attachment-of, related, … }
```
Indexed both directions (`(user_id,src_type,src_id)` and `(user_id,dst_type,dst_id)`) so "what links to this task?" and "what does this note reference?" are both cheap.

**Rel taxonomy (decided — D2 concern):** a **finite, defined set**, with **one rel per concept-pair regardless of direction** — a task↔note link is the same `rel` whether you made the task from the note or the note from the task. Names are **mechanical: concepts singular, alphabetical** → `event-note`, `event-task`, `note-task` (and later `event-recipe`, etc.). The link row's `t1/t2` are stored in that **same alphabetical order** (so for `event-note`, `t1`=event, `t2`=note always) — canonical storage, no `(A,B)`/`(B,A)` duplication. **Presentation is per-screen**: the `event-note` rel renders as "Meeting Notes" on the calendar/event screen and "Related Events" on the notes screen. Because the set is finite, adding a relationship forces a deliberate decision rather than a sprawl of ad-hoc strings.

Other things to get right so the bare `(t1,id1,t2,id2)` idea holds up:
- **Keep the `rel` column** (the above) + an optional `data` JSON for link-specific extras (e.g. embed position in a note).
- **A tiny type registry / resolver.** "any type" needs the core to resolve `(type,id)` → an entity to render a link target. Each domain registers a resolver (and which `rel`s it participates in). Adding `recipe` = a table + a resolver + its rels; it links to everything for free.
- **Reconciliation / orphans.** Generic links can't be FK-enforced, so the core prunes/repairs edges when an entity disappears. This matters *most* for notes, which live as files that can be deleted or moved in nvim/Obsidian outside the app (§4) — a rescan reconciles dangling `note` edges.

**Why typed tables + one edge table (not a single polymorphic "node" table):** SQLite stays simple, each domain keeps a readable schema and its own constraints, and the edge table handles all cross-domain relationships uniformly. (A polymorphic node table is more "elegant" but makes every query a join soup.)

---

## 4. Notes storage — files of record, DB shadows them (decided)
**Decision: note *content* lives as raw `.md` files on disk; the DB never owns the body.** This keeps nvim/Obsidian editing the same files and lets you point the notes domain at an existing vault. The key reframe that makes this work without giving up search/links/RAG:

> **The DB doesn't wall off the files — it *shadows* them with a rebuildable index.** Files are the source of truth for content; the DB holds derived, disposable metadata that can always be regenerated from the files.

- **Note identity = a frontmatter UID (decided).** Each note carries a machine-managed `id:` in its YAML frontmatter; the DB row keys off that, and `path` is just a mutable attribute. So moving/renaming a note in vim/Obsidian keeps its identity → its `note-task`/`event-note` links survive. (A little managed metadata in the file is an accepted trade.) The `note` row: `note(user_id, id, path, title, mtime, frontmatter?, …)`, body only on disk, `path` relative to a single configured **vault root**.
- **One scan, called different ways (decided).** The atom is `scanFile(path)`: read → parse (frontmatter id, title, `[[links]]`/embeds) → upsert the `note` row → reconcile *that file's* links → refresh its index. `scanVault(mode)` is just a driver that enumerates files and calls `scanFile` on each — modes `incremental` (mtime changed since the row + deletion detection) and `full` (rebuild). Triggers are thin callers: **in-app save → `scanFile(path)`**; **sync button / window-focus → `scanVault(incremental)`**; **nightly → `scanVault(incremental)`**; `full` is a manual "rebuild index." (No live file-watcher daemon for now — manual sync + nightly is the default; add a watcher later only if syncing gets annoying.)
- **Deletions → tombstone (decided).** Only a vault scan can notice a file is gone; when it does, the note is **tombstoned** (not hard-deleted) and its links flagged, so an accidental `rm` in vim doesn't silently nuke a task's attached-note edge. Reconciliation (§3) cleans up.
- **Two axes of "depth" kept separate (decided):** *which files* (changed-since vs all) is independent of *how much work per file*. Cheap work (metadata + links + FTS) runs on every scan; **expensive work (RAG embeddings) is lazy/background** (nightly or a queue), so in-app saves stay instant.
- **Links are partly *derived from file content*.** Parse `[[wikilinks]]`, `[[task:123]]`, and `tdx-query` embeds out of the markdown during the scan and materialize them into the generic `links` table. So editing a note in Obsidian still feeds the graph — elegant, and it means the link table for notes is a cache of what's written in the files (plus app-created edges).
- **You don't actually have to forgo FTS5 / RAG** — you forgo the DB being *canonical*, not search. FTS5 and embedding vectors become **derived indexes** rebuilt from file contents on scan (read file → index → store in DB keyed to `(path, chunk, mtime)`). Stale on external edit only until the next scan; fully rebuildable from the vault. (See §9.)
- **Stay valid-Obsidian:** use Obsidian-native `[[...]]` where possible; our task-embed syntax (`tdx-query` fenced block, `[[task:123]]`) renders as plain text in Obsidian and is resolved by our tooling — files remain ordinary markdown.

**Cost we accept (intentional):** a dual source of truth (file ↔ index) with eventual-consistency on external edits, file-IO mediation in the API, and weaker transactional integrity between a note's body and its links (the body can change behind the API's back). The scanner + reconciliation (§3) is the price. *(Single vault root for D2; multi-vault is a later concern.)*

---

## 5. The query + embedding layer (the part that makes interlinking real)
Generalize the existing `query.js` grammar into the **canonical, server-side** query engine, and expose it as `POST /api/query`. One engine, every consumer.
- Add `type:task|event|note` to target an entity type; existing predicates (`due:`, `label:`, `project:`, completion, `priority:`, `size:`) apply where they make sense.
- Add cross-entity predicates over the link graph: `has:note`, `linked:task:<id>`, `on:<date>`/`before:`/ `after:` (events), etc.
- The engine returns **entities**, so the same call powers the tdx list, the calendar grid, a CLI `query` command, an MCP `query` tool, and a note's embedded query.

**Note embeds = the query engine surfaced inside markdown.** A fenced block:
~~~
```tdx-query
type:task project:home due:<7d
```
~~~
renders to a *live* list by calling `/api/query`. Embedding also writes `mentions` links, so the reverse lookup ("this task appears in these notes") works from the task side. Wikilinks (`[[note]]`, `[[task:123]]`) create `mentions`/`note-of` edges the same way.

This single mechanism covers everything you described — see §6.

---

## 6. Your four workflows, mapped to the model (proof it holds together)
| Want | How it falls out of the model |
|---|---|
| **To-dos on a calendar, with a per-day count** | Calendar view = `POST /api/query type:task,event in:<month>` grouped by day; the count is `group-by date`. No special integration. |
| **Calendar events in the to-do list** | The to-do list is just `type:task,event …` for the day/range; events and dated tasks come back from the same query. |
| **Embed to-do items in a note** | A `tdx-query` block (§5) resolves live; embedding writes `mentions` edges so it's bidirectional. |
| **Notes attached to a task, opened from task detail** | A `note-of` link (note→task). Task detail does `links where dst=task:<id> and rel=note-of` → shows/opens the notes. Creating a note from the task writes the edge. |
| **Meeting notes on a calendar event** (your add) | Same `note-of`/`mentions` edge, `dst=event:<id>`. The event detail and the note both show the link. Nothing new — it's the any-to-any graph. |
| **Wild new domain** (recipe → tonight's event) | New `recipe` table + resolver; `links(recipe, …, event, …, rel:'related')`. Linking is free the day the type exists. |

Everything is **(typed entity) + (generic link) + (one query engine)**. New cross-app features become new `rel` values and query predicates, not new subsystems.

---

## 7. The middle-layer rewrite: TypeScript first (Rust later, optional)
**Decided: TS first** — isolate the API migration from a language port so a regression is diagnosable, and reuse the crown-jewel logic. The full trade-off is kept below for when/if Rust is revisited. The deciding factor isn't really the language — it's **how much existing logic we reuse vs. rebuild**.

- **TypeScript (Node/Bun/Deno + Fastify/Hono, strict mode, `zod` for runtime validation).**
  - ✅ Reuse `query.js` + `Rec` (recurrence) **almost verbatim** — they're already JS; that's the hardest, most battle-tested logic.
  - ✅ End-to-end types with the web clients (shared `zod` schemas, or tRPC); one language across the stack; fast iteration.
  - ⚠️ Weaker *runtime* guarantees than Rust (mitigated by `zod` at every boundary + strict TS).
- **Rust (axum/actix + `rusqlite`/`sqlx`).**
  - ✅ Strongest correctness for the guard layer you care about; single static binary; great perf/longevity; a clean, deliberate core that many clients can trust.
  - ⚠️ Must **re-port** the query engine + recurrence (real work, but a clean-slate opportunity); two languages in the repo; slower iteration while learning.
  - ✅ A solid long-term-investment / learning play if the core is meant to outlive everything on top.

**My lean:** **TS-first** is the lower-risk path that reuses the crown-jewel logic and ships the multi-client contract fastest; **Rust** is very defensible if you'd rather invest in a rock-solid typed core and treat the port as worth it. Either way the *contract* (below) is language-agnostic, so we could even start the migration in the current Node service and swap the implementation later without breaking clients. **This is open question #1.**

**Contract surface:** **REST + OpenAPI** (language-agnostic → works for CLI, MCP, future apps, and either backend language), with the custom query engine as a first-class `POST /api/query`. tRPC only if we commit to all-TS clients; GraphQL is tempting for the link/embedding flexibility but the query endpoint already gives us that without the weight.

---

## 8. Auth & safety for many clients (the "don't bypass safeguards" requirement)
> Full design in **`AUTH_AND_SHARING.md`** — multi-user ownership, project sharing, task assignment, usergroups/households, revocable API tokens, read-only agents/portfolio. The model is **baked into D1** (it's the scoping layer) with single-user defaults; UX is wired later.
- **Browsers** keep the session cookie. **CLI/MCP/agents** get **API tokens (PATs)** with **scopes** (read-only, per-domain, per-action). Same identity/multi-tenant model, different credential type.
- **Server-side validation at the boundary is the universal safeguard.** Because every client goes through the contract (not SQLite), an agent literally cannot violate an invariant we don't expose. This is the whole reason to wrap agents in an API rather than DB access.
- **Concurrency** moves from one global `state_version` to **per-resource** `updated_at`/ETag optimistic checks on granular writes.

---

## 9. AI: MCP + RAG + the CLI (all the same idea)
- **CLI** = a thin client over the HTTP contract, mirroring how the web app calls it. If the CLI and the web app both work against the same endpoints, the contract is proven and nobody's forced into a UI that doesn't suit them. Auth via a PAT.
- **MCP server** = an adapter that exposes core operations as MCP **tools** (`create_task`, `query`, `link`, `search_notes`, `list_events`, …). It **calls the core API, never the DB**, so validation, scopes, and business rules apply to agents exactly like every other client. This is the safe version of "let an agent use my data."
- **RAG over file-backed notes** = the derived-index pattern from §4. On scan, read each `.md`, chunk + embed, store vectors (`sqlite-vec` in-DB, or an external store) keyed to `(path, chunk, mtime)`; keep an FTS5 keyword index the same way. Both are **rebuildable caches over the vault**, so raw-files-on-disk and RAG coexist — the engineering-around you anticipated is just "(re)index on file change." Agents retrieve via an MCP `search` tool that fuses FTS + vectors — through the core, not around it.

---

## 10. Frontend shape — one shell, lazy app modules (decided)
The three apps are **one SPA** structured as a thin **app-shell** (auth, the API client, a shared cache/store, the left nav, top bar — always mounted) hosting **lazily code-split route modules**: `/tasks`, `/notes`, `/events`. Bookmarkable URLs and deep links come from the routes; perf/bundle-size comes from route-level code-splitting (visiting `/tasks` never loads the calendar bundle); `/` redirects to the account's preferred landing route. We build it this way rather than literally-separate per-page SPAs **because cross-app linking is the point** — sharing one runtime + cache means an embedded task list is already-loaded data and "open the note attached to this task" is a client-side route change, not a reload + refetch. Shared primitives (entity types, the query client, the task-chip / link renderers) live in a common layer so a task looks the same in the list, a calendar cell, or embedded in a note. Convention: plural routes for the collection view (`/events`), singular entity concepts (`event`).

**Real-time: deferred (decided).** With one shared cache, freshness for a solo user is handled by **refresh-on-focus + optimistic updates** — no change feed on day one. The granular D1 API makes per-resource refetch cheap, and per-resource versions/ETags leave the door open to add an SSE feed later if multi-device staleness ever bites.

This is a **D2-era** build (the shell only matters once notes/events exist), but keep D1's task app shell-friendly rather than assuming it owns the whole page.

---

## 11. Incremental migration path (no big-bang rewrite)
Build by deliverable, not by trickle. The recent soft-delete endpoints already point the right way.

**D1 Step 0 — characterization / parity harness (first, before any rewrite).** Lock today's behavior in tests so the port has a target to match. The crown-jewel logic (`Q` query engine, `Rec` recurrence) is already pure / DOM-free — a 1-line dual-export (or a `window` shim) makes it `require`-able in Node, then table-driven + **golden-master** tests (generate the expected outputs from the *current* code) pin it down. The entangled "smart rules" (spawn-next-on-complete, due-date inference, view-inheritance, `visibleRoots` filter/sort) get headless store tests. The TS rewrite then must reproduce the same goldens = the parity spec. **Recurrence is done test-first** (it's the riskiest piece — capture behavior as tests, port until green).

**Deliverable 1 — backend rewrite (tasks), one push.** Port `query.js`/`Rec` server-side; build the granular validated TS task API (CRUD + `POST /api/query`); bake in the **auth/ownership model** (`AUTH_AND_SHARING.md`) with single-user defaults; **remove the `PUT /api/state` snapshot** entirely (per-resource concurrency replaces the global `state_version`). Rewrite → deploy → daily-drive → log losses. No long snapshot-coexistence period — clean cutover for the task domain.

**Deliverable 2 — notes & events.** Add `event` + `note` tables, the generic `links` table + rel taxonomy, the file-backed-notes scanner, then the CLI/MCP/RAG and the calendar/notes UIs. Designed alongside D1, built after.

**Later / pinned:** real-time multi-client sync (SSE/WebSocket change feed); the full auth/accounts/sharing/AI-token model (its own conversation, before D1 code).

---

## Decisions & open threads (after your answers)
**Decided this round**
- **D1 = one-push backend rewrite** for tasks (kill the snapshot, granular TS API), then daily-drive and log losses. TDD worth weighing (open thread).
- **Two deliverables** (above): D1 backend rewrite (tasks); D2 notes & events.
- **One TDX account → all apps.**
- **Link rels: a finite, mechanical set**, alphabetical singular concepts, canonical `t1/t2` order, per-screen presentation (§3) — a D2 detail.
- *(Carried from before: TS-first, files-of-record notes, REST+OpenAPI.)*

**Captured**
- **Auth / accounts / authorization** → **`AUTH_AND_SHARING.md`** (multi-user ownership, sharing, assignment, usergroups, revocable tokens, read-only agents/portfolio). Foundational model baked into D1; UX later. *(All design decisions resolved — UUID ids, viewer/editor/owner, default-private, per-domain PAT scopes, admin user-creation endpoint, fixed owner.)*

**Threads status:**
1. ~~File-backed notes scan strategy (D2)~~ — **settled** (§4): frontmatter-UID identity, `scanFile`/`scanVault(mode)`, tombstone deletions, cheap-vs-expensive split.
2. ~~App / frontend architecture~~ — **settled** (§10): one shell + lazy route modules; routes for bookmarking + code-splitting for perf; real-time deferred to focus-refresh.
3. ~~The "recurrence spike" line~~ — **settled**: recurrence is ported **test-first** as part of a broader **D1 Step 0 characterization/parity harness** (§11) — capture today's behavior in golden tests, then port until green.
