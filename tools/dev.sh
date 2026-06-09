#!/usr/bin/env bash
# Run tdx in DEV mode via node on :3001 (NOT docker), against a sample/snapshot database
# so nothing here can touch prod (~/docker/tdx on :3000).
#
#   tools/dev.sh                 start the dev server  (Ctrl+C to stop)
#   tools/dev.sh --refresh       rebuild fresh sample data (tools/seed-dev.js), reset data/tdx.db, start
#   tools/dev.sh --refresh NAME  reset data/tdx.db from snapshot data/snapshots/NAME.db, then start
#
# The dev DB is data/tdx.db — the SAME filename prod uses (db.js default, compose
# DB_PATH=/data/tdx.db) — so restore steps are identical to production. This repo
# holds dev data only; prod runs from ~/docker/tdx.
#
# Snapshot the current DB before a test with:   tools/snapshot.sh NAME
#
# Dev login:  username  dev     password  DevPass!23
#
set -euo pipefail
cd "$(dirname "$0")/.."            # repo root (this script lives in tools/)

DB=data/tdx.db

# (Re)build/restore the dev DB on --refresh, or the first time if it's missing.
if [[ "${1:-}" == "--refresh" || ! -f "$DB" ]]; then
  SNAP="${2:-}"
  if [[ -n "$SNAP" ]]; then
    SRC="data/snapshots/${SNAP}.db"
    [[ -f "$SRC" ]] || { echo "✗ no snapshot at $SRC  (list them: tools/snapshot.sh --list)"; exit 1; }
    echo "Resetting $DB from snapshot '$SNAP'…"
  else
    echo "Building sample data (data/seed.db) and resetting $DB…"
    node tools/seed-dev.js
    SRC=data/seed.db
  fi
  rm -f "$DB" "$DB-wal" "$DB-shm"   # clear any stale WAL/shm so the copy can't be corrupted
  cp "$SRC" "$DB"
fi

export PORT=3001 HOST=0.0.0.0 TZ=America/Chicago
export DB_PATH="$PWD/$DB"
# reuse the prod cookie secret so cookies validate; the dev DB has no matching
# session, so you'll land on the login screen — log in as  dev / DevPass!23
export SESSION_SECRET="$(grep -E '^SESSION_SECRET=' .env 2>/dev/null | cut -d= -f2- || true)"
: "${SESSION_SECRET:=dev-only-secret}"

echo "tdx dev → http://localhost:3001  (LAN: http://192.168.0.150:3001)"
echo "   DB: $DB · login: dev / DevPass!23 · Ctrl+C to stop"
exec node backend/src/server.js
