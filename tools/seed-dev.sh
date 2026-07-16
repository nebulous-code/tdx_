#!/usr/bin/env bash
# Rebuild the dev database (server/data/tdx.dev.db) from scratch with generic
# sample data. Only touches the dev DB — prod (~/docker/tdx on :3000) is never
# touched.
#
#   tools/seed-dev.sh
#
# How it stays current: this DELETES the dev DB and rebuilds it by (1) running
# every migration in server/migrations/ on a fresh file, then (2) inserting the
# sample data via the server's own service layer. So the schema is always whatever
# the migrations say — there is no checked-in seed.db to keep up to date.
#
# Login:  dev / Password123!
set -euo pipefail
cd "$(dirname "$0")/../server"
exec npm run --silent seed:dev
