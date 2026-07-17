# D1 cutover — running the TypeScript server in prod

> **✅ COMPLETED — this cutover has already happened.** Verified by read-only probe of prod on **2026-07-15**: the box runs the TypeScript `server/` (`/health` → `tdx-server`) on the migrated UUID DB (1 user · 24 projects · 468 tasks · 36 labels · 9 saved queries, all in the new schema). This document is now **historical** — the record of the legacy → TS switch.
>
> **It is tasks-only.** The deployed image (built 2026-06-18) predates the Events & Notes work and its DB sits at migration `001_init`. **For the next release — deploying the Events/Notes apps, the creation language, and migrations 002–011 — follow [`DEPLOY_EVENTS_AND_NOTES.md`](DEPLOY_EVENTS_AND_NOTES.md).**

This was the one-time switch from the legacy `backend/` service to the new `server/` (TypeScript) service. The new server runs the D1 (UUID) schema and **will not start against the legacy DB**, so the prod database had to be converted first.

## What changes
- `compose.yaml` + `.github/workflows/docker.yml` build from `server/Dockerfile` (was `backend/Dockerfile`). Same image name (`ghcr.io/nebulous-code/tdx:latest`), same env (`PORT`/`HOST`/`DB_PATH`/`TZ`/`SESSION_SECRET`), same volumes (`./data`, `./backups`), same port (`3000`). The new server serves the API **and** the static frontend.
- The prod `data/tdx.db` is rewritten: prefixed ids → UUIDs, ownership columns, etc. (`migrate-from-legacy`).
- **Everyone is logged out** (sessions aren't migrated) — log back in with the same credentials.
- The **backup config resets to your old values** (carried over by the migration); re-verify the backups screen after cutover.

## The hazard to respect
The host runs **Watchtower**, which auto-deploys `:latest` the moment CI publishes it. If the new image deploys while `data/tdx.db` is still legacy, the container crash-loops. So: **pause Watchtower, migrate the DB, deploy manually, then re-enable Watchtower.**

## Runbook (on the host)

```sh
cd <repo>

# 1. BACK UP the database (and ideally trigger a UI backup too).
cp data/tdx.db data/tdx.legacy-$(date +%F).db

# 2. Pause Watchtower so nothing auto-deploys mid-cutover.
docker stop watchtower            # (or remove the com.centurylinklabs.watchtower.enable label)

# 3. Merge this branch to main → CI builds & pushes the new server image to GHCR.
#    (Watchtower is paused, so nothing deploys yet.) Wait for the build to finish.

# 4. Pull the new image and stop the running (legacy) app.
docker compose pull
docker compose stop tdx

# 5. Convert the DB with the NEW image (legacy opened read-only → new file).
docker compose run --rm tdx node dist/scripts/migrate-from-legacy.js /data/tdx.db /data/tdx.new.db
#    It prints {users, projects, tasks, labels, taskLabels, savedQueries}. Sanity-check
#    those against the legacy DB, e.g.:
#      sqlite3 data/tdx.db 'SELECT count(*) FROM tasks;'

# 6. Swap in the migrated DB.
mv data/tdx.db data/tdx.legacy.db
mv data/tdx.new.db data/tdx.db

# 7. Start the new server.
docker compose up -d
docker compose logs -f tdx        # confirm it boots (no migration/schema errors)

# 8. Smoke test: open http://<host>:3000, log in (same credentials), confirm your
#    data loads; create/rename/check-off/delete persist across a reload; completing
#    a recurring task spawns the next; the backups screen (admin) shows your config.

# 9. Re-enable Watchtower once you're satisfied.
docker start watchtower
```

## If a user creates a task and it 500s on the LAN
The client mints UUIDs with a `crypto.getRandomValues` fallback for plain-HTTP LAN access (where `crypto.randomUUID` is undefined). If you instead front the app with HTTPS, `randomUUID` is used directly. Either path is fine.

## Rollback
> **Note:** the legacy `backend/` directory has since been **removed** from the repo (the follow-up below is done), so the "revert to `backend/Dockerfile`" path no longer applies. This section is retained as the historical record of the D1 cutover. To roll back a *current* deploy, use the image-pinning + DB-restore procedure in [`DEPLOY_EVENTS_AND_NOTES.md`](DEPLOY_EVENTS_AND_NOTES.md); `git revert` of the cutover commit would still restore `backend/` from history if it were ever truly needed.

At the time of the cutover, the legacy `backend/` was untouched and still worked against the legacy schema:
```sh
docker compose stop tdx
mv data/tdx.legacy.db data/tdx.db                 # restore the pre-migration DB
git revert <the cutover commit>                   # compose/CI back to backend/Dockerfile
docker compose pull && docker compose up -d --build
docker start watchtower
```
Keep `data/tdx.legacy-*.db` until you've daily-driven the new server for a while.

## Follow-ups (not blocking)
- ~~Once the new server is proven in prod, delete `backend/` and the `tools/` CLI (superseded by `server/scripts/`).~~ **Done** — `backend/` and the legacy `tools/add-user.js` + `tools/reset-password.js` were removed after the Events & Notes cutover.
- The granular API also exposes `/complete`, `/assign`, `/labels/merge`, grants/groups, and PATs (`/api/auth/tokens`) for a future CLI / agents / portfolio — not used by the app yet.
