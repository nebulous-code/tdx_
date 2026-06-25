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

## Phase 0 — Parity harness (before any rewrite) — see `PARITY_HARNESS.md` — **DONE** (`test/`, `npm test`)
- [x] `node:test` scaffolding + `test/` dir + root `package.json` (zero installed deps)
- [x] ~~Dual-export `query.js` + `recurrence.js`~~ → **global-shim loader** (`vm.runInThisContext`), zero frontend changes — handles cross-file globals (`Rec` in query.js, `Vue` in data.js) the dual-export couldn't
- [x] Deterministic clock (freeze `new Date()`) + pinned `TZ=UTC`; golden write/compare helper
- [x] Fixture corpus — crafted edge cases (recurrence flavors, due/status, weekday windows, labels, subtasks) — real-data slice deferred (synthetic corpus sufficed)
- [x] Golden tests: `Rec` (parse/stringify/summary/compact, next-occurrences, matches, date math)
- [x] Golden tests: `Q` (parse + build round-trip, `run` over the corpus, dueDelta/slug)
- [x] Headless store tests: spawn-on-complete, due-inference (real `task-detail.js` method), `viewDefaults`, `visibleRoots`/`searchRoots`/completion — Vue loads headlessly, **no jsdom needed**
- [ ] (optional, deferred) ~5–10 Playwright critical-path smokes
- [x] Goldens are plain JSON → the TS port reuses the same corpus/goldens as its parity target
- [x] Sensitivity-checked (perturbed value → golden fails) + deterministic across repeat runs

## Phase 1 — D1: TypeScript backend rewrite (tasks only)
**Foundation** — **DONE** (lives in `server/`; `npm test`, `npm run migrate`, `npm run dev`)
- [x] Stack locked + fresh TS Fastify service scaffolded (`server/`: TypeBox provider + `@fastify/swagger` OpenAPI at `/docs`, `GET /health`); Kysely over better-sqlite3; tsx/tsc/Biome; 0 npm vulns (Kysely bumped to 0.29).
- [x] Schema/migrations (`server/migrations/001_init.sql`): UUID ids · `owner_id` · `creator_id`/`assignee_id` · `grants` · `groups`/`group_members` · `api_tokens` · `updated_at` on shareable resources. (events/notes columns deferred to D2.) Idempotent runner ported from `backend/src/db.js`.
- [x] One-time data migration (`server/scripts/migrate-from-legacy.ts`): prefixed ids → UUIDs, refs rewired, `owner_id`=`creator_id`=user, no grants, archived rows preserved. Verified on a **copy** of the real DB (counts match exactly, zero dangling refs).
- [x] **CI migration test** (`server/test/migration.test.ts`): legacy-shaped seed → migrate → asserts survival (incl. archived) + ref integrity + prefs carried.

**Core logic (port, parity-tested)**
- [x] Port `Rec` (recurrence) → `server/src/rec.ts` — verified against the Phase 0 goldens (`server/test/parity.test.ts`).
- [x] Port `Q` (query engine) → `server/src/query.ts` — verified against the goldens. `assignee:` predicate **deferred** to the API-surface step (ported verbatim so goldens match exactly).
- [~] Boundary validation: TypeBox toolchain wired + proven on `/health`; full per-input validation lands with the granular endpoints.

**Auth / ownership foundation** — **DONE** (single-user defaults; contract-complete; UI-less)
- [x] Sessions (ported `auth.ts`: argon2id + rate-limit + signed cookie) + API tokens (PATs) with per-domain scopes (`tokens.ts`, Bearer; read/write enforced, domain prefixes reserved)
- [x] `canAccess` (`authz.ts`: owner / grants / groups; task inherits project) on every resource route via `accessLevel`/`denyStatus` (404 vs 403)
- [x] Admin-only `POST /api/admin/users` + `scripts/add-user.ts` (replaces `add-user.js`)
- [x] Endpoints: set/clear assignee (`/api/tasks/:id/assign`), token create/list/revoke. Grant/revoke-share, "shared with me", group CRUD **deferred** (machinery + single-resource access tested; collections owner-scoped for now)

**API surface + cutover**
- [x] Granular CRUD (tasks/projects/labels/saved-queries); `POST /api/tasks/:id/complete` spawns recurrence server-side (parity-checked vs `store.spawn` golden); archive cascade; label merge
- [x] `POST /api/query` (server-side `Q.run` over the owner's live tasks) + `GET /api/bootstrap`
- [x] Per-resource concurrency: `updated_at` ETag + `If-Match` → 412 (tasks/projects; labels/saved-queries unconditional, no `updated_at`).
- [x] **Repoint the Vue app onto the granular API** — diff-sync (`frontend/js/sync.js`): the autosave watcher now diffs the store vs the last-synced baseline and emits granular `POST/PUT/DELETE`. `uid()`→UUID (client-authoritative ids; server accepts client `id`/`position`/`done` on create); `hydrate`→`GET /api/bootstrap`; soft-delete→`DELETE` + re-bootstrap. Snapshot `PUT /api/state` and `version/seq/409` are gone. The new server also serves the frontend statically (same-origin) for dev on :3001.

- [x] **Backups ported** — `server/src/backup.ts` + `routes/backup.ts` (admin-only config/run/list/browse/download, `sqlite.backup()` online copy, daily scheduler armed on real boot; `backup_config` singleton seeded in `001_init.sql`, legacy settings carried over by `migrate-from-legacy`). The app is now feature-complete on the new server.

> Server is integration-tested via `fastify.inject` (**47 tests**); the diff engine is unit-tested (`test/sync.test.cjs`). **D1 is functionally complete** and the app runs entirely on `server/`. Remaining is the user's daily-drive on :3001, then the prod cutover.
>
> The app doesn't yet drive `/complete`·`/assign`·`/labels/merge`·grants/groups·PATs — that's the CLI/agent/portfolio surface, available but unused by the UI.

**Ship** — deployment **prepped** (working tree, not deployed)
- [x] `server/Dockerfile` (multi-stage tsc build → slim runtime; serves API + frontend); `compose.yaml` + `.github/workflows/docker.yml` point at `server/Dockerfile`; `FRONTEND_DIR`/`MIGRATIONS_DIR` env overrides for the image.
- [x] `docs/DEPLOY.md` — ordered cutover runbook (back up → pause Watchtower → migrate prod DB with the new image → swap → deploy → verify → re-enable; rollback to legacy documented). ⚠️ Must migrate `data/tdx.db` **before** the new image goes live.
- [x] **Cutover executed** — prod runs the TS server on the migrated UUID DB (verified: counts match, restarts=0). Backups bind-mounted to a ZFS dataset. `backend/` + `tools/` retired = follow-up.

## Phase 2 — D2: notes & events (on the `feat/backend_redesign` branch; dev-only, not merged)
Roadmap (planned in `docs/PLATFORM_ARCHITECTURE.md`): **2a** events+calendar · **2b** generic `links` + rel taxonomy · **2c** file-backed notes (app-managed fresh vault, frontmatter UID, `scanFile`/`scanVault`, tombstones, FTS) · **2d** app-shell + lazy `/tasks` `/notes` `/events` routes (rebuild the calendar as the events module; unify list/calendar onto `POST /api/query type:task,event`) · **2e** CLI / MCP / RAG.
- [x] **2a — Events + Calendar.** `events` domain server-side (mirrors the task pattern; `migrations/002_events.sql`; CRUD + If-Match + owner-only authz; **`GET /api/events?from=&to=`** expands recurring events virtually via `Rec`, not spawned). 4 integration tests (CRUD, range expansion, concurrency, authz); 51 server tests green. Frontend `js/calendar.js` (month grid showing events **and** dated tasks, + an event-editor modal), bolted into the SPA via `store.view.kind==='calendar'` (a "📅 cal" toggle); events use the granular API directly (not the diff-sync). **Intentionally rebuilt in 2d as the proper `/events` module.**
- [ ] 2b–2e — to be planned when reached. Vault decision: **app-managed fresh vault** (plain `.md`, frontmatter UIDs).
