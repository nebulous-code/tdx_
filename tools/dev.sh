#!/usr/bin/env bash
# Launch tdx in DEV mode on :3001 (the TypeScript server in ../server), against
# the dev database (server/data/tdx.dev.db). This NEVER touches prod — prod runs
# from ~/docker/tdx on :3000.
#
#   tools/dev.sh             start the dev server  (Ctrl+C to stop)
#   tools/dev.sh --reseed    rebuild fresh sample data first, then start
#
# Login:  dev / Password123!
#
# Config comes from server/.env (PORT=3001, DB_PATH=data/tdx.dev.db, SESSION_SECRET).
# Reseeding rebuilds the schema from migrations + the sample data — there's no
# seed.db file to keep in sync (see tools/seed-dev.sh).
set -euo pipefail
cd "$(dirname "$0")/../server"            # the TS server lives in server/

# Reseed on --reseed, or automatically if the dev DB doesn't exist yet.
if [[ "${1:-}" == "--reseed" || ! -f data/tdx.dev.db ]]; then
  echo "Seeding fresh dev data (dev / Password123!)…"
  npm run --silent seed:dev
fi

echo "tdx dev → http://localhost:3001"
exec npm run --silent dev
