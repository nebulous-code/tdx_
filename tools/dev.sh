#!/usr/bin/env bash
# Launch tdx in DEV mode on :3001 (the TypeScript server in ../server), against
# the dev database (server/data/tdx.dev.db). This NEVER touches prod — prod runs
# from ~/docker/tdx on :3000.
#
#   tools/dev.sh                  start the dev server  (Ctrl+C to stop)
#   tools/dev.sh --reseed         rebuild the light hand-crafted sample data first, then start
#   tools/dev.sh --reseed-heavy [N]  rebuild a prod-sized synthetic perf dataset (N = scale, default 1)
#
# Light seed = a small readable fixture; heavy seed = ~1000 tasks for performance testing. Both
# are 100% synthetic (no real data) and log in as dev / Password123!.
#
# Config comes from server/.env (PORT=3001, DB_PATH=data/tdx.dev.db, SESSION_SECRET).
# Reseeding rebuilds the schema from migrations + the sample data — there's no
# seed.db file to keep in sync (see tools/seed-dev.sh).
set -euo pipefail
cd "$(dirname "$0")/../server"            # the TS server lives in server/

# Reseed on request, or automatically (light) if the dev DB doesn't exist yet.
case "${1:-}" in
  --reseed)
    echo "Seeding fresh LIGHT dev data (dev / Password123!)…"
    npm run --silent seed:dev ;;
  --reseed-heavy)
    echo "Seeding HEAVY prod-sized synthetic data (dev / Password123!, scale ${2:-1}x)…"
    npm run --silent seed:dev:heavy -- "${2:-1}" ;;
  *)
    [ -f data/tdx.dev.db ] || { echo "No dev DB — seeding light data…"; npm run --silent seed:dev; } ;;
esac

echo "tdx dev → http://localhost:3001"
exec npm run --silent dev
