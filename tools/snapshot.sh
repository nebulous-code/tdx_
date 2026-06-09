#!/usr/bin/env bash
# Snapshot the current dev database so you can reproduce a bug after poking the UI.
# Uses SQLite's online backup API → a consistent standalone .db even while tools/dev.sh
# is running and writing. Snapshots live in data/snapshots/ (gitignored).
#
#   tools/snapshot.sh NAME     save data/tdx.db → data/snapshots/NAME.db
#   tools/snapshot.sh          save with a timestamp name (snap-YYYYmmdd-HHMMSS)
#   tools/snapshot.sh --list   list saved snapshots (newest first)
#
# Restore a snapshot into the dev server with:   tools/dev.sh --refresh NAME
#
set -euo pipefail
cd "$(dirname "$0")/.."            # repo root (this script lives in tools/)

SNAPDIR=data/snapshots
mkdir -p "$SNAPDIR"

if [[ "${1:-}" == "--list" || "${1:-}" == "-l" ]]; then
  echo "Snapshots in $SNAPDIR (newest first):"
  ls -1t "$SNAPDIR"/*.db 2>/dev/null | sed 's#.*/##; s#\.db$##' || echo "  (none yet)"
  exit 0
fi

SRC=data/tdx.db
[[ -f "$SRC" ]] || { echo "✗ no $SRC yet — start it once with tools/dev.sh"; exit 1; }

NAME="${1:-snap-$(date +%Y%m%d-%H%M%S)}"
DST="$SNAPDIR/${NAME}.db"
[[ -e "$DST" ]] && echo "(overwriting existing snapshot '$NAME')"

# Online backup: consistent even with the dev server mid-write (reads through the WAL).
python3 - "$SRC" "$DST" <<'PY'
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
s = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
d = sqlite3.connect(dst)
with d:
    s.backup(d)
d.close(); s.close()
PY

echo "✓ snapshot saved → $DST"
echo "  restore it later with:   tools/dev.sh --refresh $NAME"
