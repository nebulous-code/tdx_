# Deploying the Events & Notes release

The runbook for shipping the second big feature wave — the **Events (calendar) app**, the **Notes app**, and everything that came with them — to prod. This supersedes `docs/DEPLOY.md`, which is the *first* cutover's runbook (legacy → TypeScript, tasks-only) and is now stale.

> **This is not a legacy import.** Prod already runs the TypeScript backend. This release is an **in-place schema + code upgrade** of a DB that already holds real data. `migrate-from-legacy` plays no part.

---

## What this release adds

- **Events app** (calendar grid + agenda, event drawer, recurrence builder).
- **Notes app** (file-backed vault, folders, the vault "base directory" as a named row).
- **The creation language** — one quick-add grammar (`#label $date /category {notes}`) across tasks, notes and events.
- **Glyph enforcement** — the 40-glyph picker is now the source of truth (an off-list glyph 400s).
- **"All calendars"** nav row + the two new user preferences (`notes_root_name`, `calendars_all_name`).
- **Schema migrations 002 → 011** (events, links, notes, calendars/folders, readable ids, saved-query `display`, the Inbox rename, glyph normalization, the calendars-all name).
- A **CI change**: both the server *and* frontend test suites now gate the image; CI runs on every branch, not just `main`.

---

## Verified prod state (read-only probe, 2026-07-15)

Prod is the `tdx` container (`ghcr.io/nebulous-code/tdx:latest`) on `watchet-server`, reachable at `http://<host>:3000` over the LAN / tailnet.

| | |
|---|---|
| **Backend** | TypeScript rewrite. `/health` → `{status:'ok', service:'tdx-server', …}`. The legacy→TS cutover already happened. |
| **Deployed image** | built **2026-06-18** — predates all of this release. |
| **Frontend** | tasks-only. `recurrence-builder.js` served; `calendar.js` / `notes.js` / `create.js` / `glyphs.js` / `day-detail.js` all **404**; `index.html` mounts only `<task-list>`. |
| **DB migrations applied** | **`001_init` only.** |
| **Tables** | `users · projects · tasks · labels · saved_queries · task_labels · sessions · api_tokens · grants · groups · group_members · backup_config`. **No `events` / `notes` / `calendars` / `folders` / `links` / `note_links`.** |
| **Live data** | **1 user · 24 projects · 468 tasks · 36 labels · 9 saved queries.** Real, non-trivial. |
| **User pref columns** | `sort_prefs`, `fib_sizing`. **No** `notes_root_name` / `calendars_all_name`; `saved_queries.display` absent (007 not applied). |
| **Mounts** | `/home/watchet/docker/tdx/data → /data` (the DB) · `/the_agency/home_lab/tdx_backups → /backups`. **No vault mount.** |
| **Env** | `DB_PATH=/data/tdx.db`, `PORT=3000`, `NODE_ENV=production`, `SESSION_SECRET` set. **No `VAULT_DIR`.** |

---

## What the migration actually does to prod's DB

On the new image's first boot, `applyMigrations` (server/src/db.ts) runs every `.sql` not yet in `schema_migrations`, in order, **each in its own transaction**. Against prod's current DB that's 002 → 011:

| migration | effect on prod's real data |
|---|---|
| 002 events · 003 links · 004 notes+note_links · 005 calendars+folders | **CREATE TABLE** — empty; the 468 tasks are untouched. |
| 006 readable ids | **ADD COLUMN** `readable_id` (nullable) to tasks/events/…; existing rows get `NULL` until touched (see caveat). |
| 007 saved-query display | `ADD COLUMN display TEXT NOT NULL DEFAULT 'auto'` — your 9 views all become `'auto'`. |
| 008 notes_root_name | `ADD COLUMN … DEFAULT 'Inbox'` on `users` — your 1 user gets it. |
| **009 capitalize inbox** | **`UPDATE projects SET name='Inbox' WHERE name='inbox'`** — touches your real Inbox project if it's lowercase. |
| **010 glyph source-of-truth** | `UPDATE projects SET glyph='❯' WHERE glyph='⌂'`, then normalizes any off-list glyph on projects/calendars/folders/saved_queries to that entity's default. **Touches your real projects + saved views.** |
| 011 calendars_all_name | `ADD COLUMN … DEFAULT 'Everything'` on `users`. |

**A failed migration mid-run = the server throws at boot = the container crash-loops**, and Watchtower keeps trying. This has **never been run against prod's real data** — hence the rehearsal below is non-negotiable.

> **`readable_id` caveat:** existing tasks/projects will show no `t_####` id until they're next saved (the id is allocated on write). If you want them all backfilled at cutover, that's a small one-time script to run after migrating — decide during the rehearsal whether you care.

---

## 🛑 Blockers — do these before merging to `main`

### 1. Mount the vault (or notes are lost on every redeploy)
Notes are **file-backed**. With no `VAULT_DIR` and no volume, the vault lands inside the container's ephemeral layer and Watchtower's next auto-pull **deletes every note**. No notes exist yet, so nothing is lost *today* — but the moment the notes frontend ships and you create one, it's on borrowed time. Add to `compose.yaml`:
```yaml
    environment:
      VAULT_DIR: /vault
    volumes:
      - ./vault:/vault          # host path on a backed-up dataset (like ./data)
```
Create the host dir first. This is a ~10-minute change and it is the highest-severity item here.

### 2. Rehearse migrations 002 → 011 on a COPY of the live DB
```sh
# on the host, with the container still running the OLD image:
cp /home/watchet/docker/tdx/data/tdx.db /tmp/tdx-rehearsal.db      # + -wal/-shm if present
# then, from a checkout of THIS branch:
cd server && DB_PATH=/tmp/tdx-rehearsal.db npx tsx -e "import('./src/db.js').then(m=>m.openDatabase(process.env.DB_PATH))"
# confirm: schema_migrations now lists 001..011, the 468 tasks survive, the Inbox project is
# renamed + reglyphed, and NO migration threw.
```
This is where a real-data surprise (an unexpected glyph, a name collision, a constraint) surfaces **on a copy**, not on prod. Do not skip it.

### 3. Add a container healthcheck
Watchtower auto-deploys `:latest` with nothing verifying the app actually came up. A crash-loop is silent. Add to `server/Dockerfile` (or `compose.yaml`):
```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://localhost:'+ (process.env.PORT||3000) +'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```
The `/health` endpoint already exists (`app.ts`).

---

## The deploy runbook (this release)

1. **Land the three blockers above** on this branch (vault volume, healthcheck; rehearsal is a dry-run, not a commit).
2. **Back up prod's DB** out-of-band: `cp .../data/tdx.db …/tdx.pre-events-notes.db`. (The backup service also snapshots it, but take an explicit named copy.)
3. **Pause Watchtower** so the deploy is deliberate, not a surprise mid-work: `docker stop watchtower` (or drop the container's watchtower label).
4. **Merge to `main`.** CI runs both test suites, builds the image (migrations 001–011 baked in), pushes `:latest` + `:<sha>`.
5. **Rotate `SESSION_SECRET`, then pull + restart deliberately.** This restart is deliberate anyway, so fold the secret rotation in here and it costs no extra restart or re-login: generate a new value (`openssl rand -base64 48`) and replace `SESSION_SECRET` in prod's env, then `docker compose pull tdx && docker compose up -d tdx`. Watch the logs — `applyMigrations` prints each version as it applies. Confirm it reaches 011 and the server logs "listening" (not a boot throw). *(See "Deliverable: rotate `SESSION_SECRET`" below for the why.)*
6. **Smoke test** at `http://<host>:3000`:
   - Log in — you'll be **logged out by the secret rotation**, so this is the one expected re-login (same credentials). With a single user that re-login is the entire cost of rotating.
   - **Tasks intact:** all 468 there, the Inbox project reads **Inbox** with the `❯` glyph.
   - **Events app** loads (the calendar), **Notes app** loads, the creation-language quick-add works.
   - Create a note → confirm it lands in the **mounted** vault dir on the host (`ls ./vault/<owner>/`).
7. **Un-pause Watchtower** once you've confirmed the release is healthy: `docker start watchtower`.
8. **Roll back if needed:** `docker compose down`, restore `tdx.pre-events-notes.db` over `data/tdx.db`, pin the old image (`ghcr.io/nebulous-code/tdx:<old-sha>`), `up -d`. The DB copy is the real safety net — migrations are one-way.

---

## Release solidity — the tests to add (not blocking, but do it soon)

The **entire Vue UI layer is untested** — zero component/browser/e2e tests. The golden suite covers the engines (`Rec`, `Q`, `CL`, store rules, sync-diff) well, but every component, drawer, the `KbForm` keyboard model, the calendar, the note editor is verified only by hand. The frontend functions-coverage floor sits at an honest-but-low **52%** for exactly this reason.

**Recommendation:** stand up **Playwright** with a handful of critical-path smokes — login → create & recur a task → create an event via the builder → create a note → the core keyboard loops. This is the long-deferred "Tier 3" (`docs/PARITY_HARNESS.md`), and it's the highest-leverage safety net before trusting hands-off auto-deploy. Add it as a third CI job gating `build-push`.

---

## Deliverable: designer-ready API docs (not blocking, but the point of the rewrite)

The whole reason for the backend rewrite was a clean, documented API a designer can build a second frontend against (a simpler app for the household). **The good news: the API already documents itself.** `@fastify/swagger` is wired up (`app.ts`), serving live **Swagger UI at `/docs`** and the raw **OpenAPI JSON at `/docs/json`** — both are already up on prod. A designer can browse `/docs` or consume `/docs/json` today.

**The gap is completeness + prose, not creation.** As probed 2026-07-15:
- **Schema coverage:** **26 of 58 routes** carry a `schema:` block → the other ~32 are missing or thinly typed in the spec. Add request/response schemas (the TypeBox entity schemas in `server/src/schemas.ts` already exist to reuse) so all 58 appear with real shapes.
- **Human docs:** only **1 of 36 operations** has a summary/description, and **none** have examples. A designer needs `summary` + `description` + a request/response **example** on each — that's the difference between "a wall of JSON" and "build UI for these endpoints."
- **Auth:** document the two modes as OpenAPI `securitySchemes` — the **session cookie** (login flow) and the **PAT bearer** (`/api/auth/tokens`) — so the designer knows how to authenticate.
- **Grouping:** add `tags` per resource (tasks · events · notes · calendars · folders · labels · saved-queries · links · auth · admin · backup) so `/docs` is navigable instead of a flat list.
- **Metadata:** `info` still reads title `tdx API`, version `0.0.0`, description **"D1 backend"** — update it to describe the current surface.
- **Handover:** either point the designer at the live `/docs` (needs LAN/tailnet access or a login), or add a build step that exports a static `openapi.json` to hand over standalone.

Scope it as its own pass after the box is updated — like the Playwright suite, it makes the release *solid* and *usable by others*, but it isn't a gate on getting the container upgraded.

---

## Bugs to fix before shipping (not gates, but wanted before release)

Not release dependencies — the container can be upgraded without them — but these are things to clear before calling the release done. All three are already tracked in the `tdx_` project on tdx; they're surfaced here because this release is what makes them matter (or makes them worse).

- **Renaming a project/calendar/folder/label breaks queries.** Saved queries reference their categorizer by *name*, so renaming one silently breaks every query that filters on it. Today it's a project-only bug; **this release widens the blast radius** by adding calendars and folders as new shared-name categorizers, so the same break now spans four entity types. The fix is a generic rename-propagation pass that rewrites the affected filters when a project/calendar/folder/label is renamed. This is the highest-value of the three.
- **Note query doesn't support multiple-folder search.** `folder:inbox,grocery` isn't supported, even though the comma-list form works for other filters. A parser gap in the notes feature this release ships.
- **Calendar date styling.** The calendar/date controls still render with the browser's default format and styling instead of the app's own CSS — cosmetic, but it's the new headline app so it should match the rest of the UI.

---

## Deliverable: rotate `SESSION_SECRET` (done during the deploy restart)

`SESSION_SECRET` is the key the server uses to sign session cookies — effectively a forge-any-login key, so it's a higher-value secret than a read token. It's set and required in prod today (the server won't boot without it). It very likely **passed through a prod-probing debugging session** on 2026-07-15, which puts it in the same transcript-exposure class as the read PAT that was already rotated — but rotating that PAT did **not** touch this; it's a separate secret living in prod's env, not in the database.

Do it as **step 5 of the runbook**, timed with the deliberate restart so it's free: `openssl rand -base64 48` → replace `SESSION_SECRET` in prod's env → the restart you're already performing loads it. The only effect is that existing session cookies are invalidated, so the post-deploy smoke-test login (step 6) is the single re-login. No data is touched. The reason it lives here rather than as a standalone chore is timing — the right moment to rotate a cookie-signing key is exactly when you're already restarting the container and about to log in anyway.

## Scope decisions & things intentionally left out

- **Sharing / multi-user is built server-side but dormant** — grants, "shared with me", group CRUD, PATs, `/complete`·`/assign`·`/labels/merge`. Ship v1 **single-user** (the app doesn't drive any of it) and leave the surface asleep. Building the UI for it is a separate initiative.
- **Yearly/annual recurrence** — parked; tracked in the prod tdx task list. A monthly-every-12 covers a birthday until the grammar is expanded.
- **HTTPS / `secure` cookie** — the session cookie is `secure:false` (fine on plain-HTTP LAN/tailnet). If this ever goes behind TLS, that flag needs flipping and there's no env toggle for it yet.
- **The vault is not covered by the DB backup service** — that service snapshots SQLite only. The vault (the note `.md` files + any binaries) needs its own backup; the design for that is [`VAULT_BACKUP.md`](VAULT_BACKUP.md) (a scheduled git snapshot into a separate git dir under `/backups`), with the user-facing history/restore and permanent-delete features deferred to [`VAULT_VERSION_CONTROL.md`](VAULT_VERSION_CONTROL.md). The vault *mount* (Blocker 1 above) is the deploy gate; the git backup is the MVP target to land with the release.

---

## Housekeeping (low priority)

- **`SESSION_SECRET` rotation** is now a deploy deliverable — see "Deliverable: rotate `SESSION_SECRET`" above; it's folded into runbook step 5.
- Doc status, reconciled against the probe: `docs/DEPLOY.md`'s cutover **did happen** (stamped ✅ COMPLETED there) — `docs/BACKEND_REDESIGN_TODO.md`'s "cutover executed" line was *correct*, not aspirational. What's stale in that TODO is the **test counts** and the "multi-user gate DONE" framing (multi-user is built-but-dormant, not shipped). This file is the source of truth for the Events & Notes deploy.
