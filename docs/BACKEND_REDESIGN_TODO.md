# Backend Redesign — TODO / Plan of Attack

> Living checklist for the platform backend rewrite. Design lives in `PLATFORM_ARCHITECTURE.md`, `AUTH_AND_SHARING.md`, `PARITY_HARNESS.md`. Update this as we go.

## Kickoff decisions

**Resolved — final stack**
- **Base:** **Node + Fastify + TypeScript (strict).** Type safety is the top priority.
- **Validation + contract:** **TypeBox** — schemas are JSON Schema → Fastify-native validation + typed handlers (`@fastify/type-provider-typebox`) + OpenAPI (`@fastify/swagger`) from one source, zero glue.
- **DB access:** **Kysely** — type-safe SQL query builder over `better-sqlite3`; keeps the existing numbered `.sql` migrations.
- **Approach:** **fresh TS service** (not in-place). Salvage the frontend (untouched, just repointed), the SQLite **data + schema + `.sql` migrations**, and the query/recurrence logic (re-specified by the parity goldens). Stand beside the current backend; cut over when goldens pass. `better-sqlite3` driver + data untouched.
- **Frontend is in D1 scope:** killing the snapshot means repointing the Vue app onto the granular API — expected.
- **DB id change is expected + recoverable:** backups exist (older ones may not reload — fine), nothing irreplaceable. Migration gets a **CI test**.
- **Defaults:** dev `tsx` + build `tsc`; lint/format **Biome**; tests **`node:test`**; ids `crypto.randomUUID()`; hashing keep `@node-rs/argon2`.

---

## Phase 0 — Parity harness (before any rewrite) — see `PARITY_HARNESS.md`
- [ ] `node:test` scaffolding + `test/` dir
- [ ] Dual-export `query.js` + `recurrence.js` (1 line each, no browser impact)
- [ ] Fixture corpus — crafted edge cases + anonymized real-data slice
- [ ] Golden tests: `Rec` (parse, next-occurrences, date math)
- [ ] Golden tests: `Q` (parse + `run` over the corpus)
- [ ] Headless store tests: spawn-on-complete, due-inference, `viewDefaults`, `visibleRoots`/completion
- [ ] (optional) ~5–10 Playwright critical-path smokes
- [ ] Wire corpus/goldens so the TS port can be checked against them

## Phase 1 — D1: TypeScript backend rewrite (tasks only)
**Foundation**
- [ ] Lock the stack picks (above); scaffold the TS Fastify service + OpenAPI contract
- [ ] Schema/migrations: UUID ids · `owner_id` · `creator_id`/`assignee_id` · `grants` · `groups`/`group_members` · `api_tokens` · (events/notes columns reserved)
- [ ] One-time data migration: prod DB → UUIDs + `owner_id`=current user, no grants
- [ ] **CI migration test:** seed a DB with old prefixed ids → run migration → assert row/link survival + counts

**Core logic (port, parity-tested)**
- [ ] Port `Rec` (recurrence) — **test-first** against goldens
- [ ] Port `Q` (query engine) against goldens; add `assignee:` predicate
- [ ] Boundary validation on every input (via the chosen schema lib)

**Auth / ownership foundation** (single-user defaults; contract-complete; mostly UI-less)
- [ ] Sessions (port) + API tokens (PATs) with per-domain scopes
- [ ] `canAccess` authorization middleware on every resource route
- [ ] Admin-only `POST /api/admin/users` (replaces `add-user.js`)
- [ ] Endpoints: grant/revoke share, set/clear assignee, token create/revoke, "shared with me", group CRUD

**API surface + cutover**
- [ ] Granular CRUD (tasks/projects/labels/views); complete spawns recurrence server-side
- [ ] `POST /api/query`
- [ ] Remove `PUT /api/state`; per-resource concurrency (ETag/`updated_at`)
- [ ] Repoint the Vue app onto the granular API (thinner client; keep working + shell-friendly for D2)

**Ship**
- [ ] Deploy → daily-drive → log functionality lost (goldens as safety net)

## Phase 2 — D2: notes & events (later)
- [ ] `event` + `note` domains; `links` table + rel taxonomy; file-backed notes scanner (frontmatter UID, `scanFile`/`scanVault`, tombstones); app-shell + lazy route modules; calendar/notes UIs; CLI; MCP; RAG
