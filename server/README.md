# tdx-server (D1 backend)

The fresh TypeScript service for the D1 rewrite. It stands **beside** the legacy `backend/` (which keeps running until cutover); the frontend hasn't been repointed yet. Design: `docs/PLATFORM_ARCHITECTURE.md`, `docs/AUTH_AND_SHARING.md`, `docs/BACKEND_REDESIGN_TODO.md`.

## Stack
Node + Fastify 5 (strict TS) · TypeBox (schema → validation + OpenAPI) · Kysely over better-sqlite3 · @node-rs/argon2 · tsx/tsc · Biome · `node:test`.

## Run
```sh
npm install
SESSION_SECRET=dev npm run dev   # -> http://localhost:3002  (Swagger UI at /docs)
npm test                         # integration tests (fastify.inject) + parity goldens
npm run typecheck                # tsc --noEmit (strict)
npm run lint                     # biome
npm run migrate                  # apply migrations/*.sql to a dev DB (data/tdx.dev.db)
SESSION_SECRET=dev npx tsx scripts/add-user.ts <user> <email> <password> [--admin]
```
`SESSION_SECRET` is required to boot (signs the session cookie). For dev, put it in a gitignored `server/.env` (dotenv is loaded).

## Foundation
- `migrations/001_init.sql` — D1 schema: global UUID ids + `owner_id`; `creator_id`/`assignee_id`; `grants`/`groups`/`group_members`/`api_tokens`; `updated_at` (ETag) on tasks/projects.
- `src/db.ts` — Kysely typed schema + idempotent numbered-`.sql` migration runner; `openDatabase()`.
- `src/rec.ts`, `src/query.ts` — recurrence + query engines ported from `frontend/js/`, **proven byte-for-byte equal** to the Phase 0 goldens (`test/parity.test.ts`).

## API (all behind auth; `buildApp(opts)` is DB-injectable for tests)
- **Auth** — `auth.ts` (argon2id sessions + rate-limit), `routes/auth.ts` (login/logout/me/account), `tokens.ts` + `routes/tokens.ts` (PATs via `Authorization: Bearer`, read/write scopes), `routes/admin.ts` (`POST /api/admin/users`).
- **Authorization** — `authz.ts` `canAccess` (owner / grants / groups; a task inherits its project); `plugins/auth.ts` guards `authenticate` / `authenticateAdmin` / `requireWrite`.
- **Reads** — `GET /api/bootstrap` (the SPA's startup read), `POST /api/query` (server-side `Q.run`).
- **CRUD** — tasks / projects / labels / saved-queries (`services/` + `routes/`); `POST /api/tasks/:id/complete` (server-side recurrence spawn), `/assign`, `POST /api/labels/merge`, archive-cascade soft delete.
- **Concurrency** — `services/concurrency.ts`: ETag = `updated_at`, `If-Match` → 412 on tasks/projects (labels/saved-queries are unconditional — no `updated_at` column).

## Not here yet (cutover step)
Repointing the Vue app onto this API (and retiring the legacy snapshot) · grant/share + group-management endpoints + "shared with me" collection aggregation · the `assignee:` query predicate.

## Tests
`test/parity.test.ts` reuses the **same** `../test/fixtures` + `../test/goldens` the JS harness produced (clock frozen to 2026-06-18, `TZ=UTC`). The rest drive the real Fastify stack via `fastify.inject` on a fresh in-memory DB (`test/support/app.ts`): auth, admin, tokens, authz, read, crud, concurrency, spawn — plus the legacy-migration test.
