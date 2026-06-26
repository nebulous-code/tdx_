#!/usr/bin/env bash
# tools/test_coverage.sh — audit backend test coverage on demand.
#
# Runs the server test suite with Node's built-in V8 coverage (no extra deps), prints
# the per-file table + summary, and enforces a RATCHETING line-coverage floor stored in
# tools/coverage-floor.txt. The floor only ever moves up: a regression below it fails,
# and an improvement can be locked in with --bump.
#
#   tools/test_coverage.sh          # run + report + check against the floor (exits 1 if below)
#   tools/test_coverage.sh --bump   # same, but if coverage improved, raise the floor to it
#
# Coverage is backend-only (server/). The no-build Vue frontend has no test suite, so it
# is not measured here — the floor is a statement about server/ line coverage.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER="$ROOT/server"
FLOOR_FILE="$ROOT/tools/coverage-floor.txt"

bump=0
[ "${1:-}" = "--bump" ] && bump=1

floor="$(tr -dc '0-9.' < "$FLOOR_FILE")"
[ -n "$floor" ] || { echo "error: empty/invalid floor in $FLOOR_FILE" >&2; exit 2; }

echo "running server test suite with coverage (floor: ${floor}% lines)…"
echo

# Capture full output but keep the script alive on test failure so we can show it.
set +e
out="$(cd "$SERVER" && node --import tsx --test --experimental-test-coverage "test/**/*.test.ts" 2>&1)"
status=$?
set -e
echo "$out"

if [ "$status" -ne 0 ]; then
  echo
  echo "✗ tests failed (exit $status) — coverage not evaluated."
  exit "$status"
fi

# Parse the "all files" summary row: file | lines% | branch% | funcs% | uncovered
summary="$(grep -E '\ball files\b' <<<"$out" | tail -1)"
[ -n "$summary" ] || { echo "error: could not find coverage summary row" >&2; exit 2; }
lines="$(awk -F'|' '{gsub(/[^0-9.]/,"",$2); print $2}' <<<"$summary")"
branch="$(awk -F'|' '{gsub(/[^0-9.]/,"",$3); print $3}' <<<"$summary")"
funcs="$(awk -F'|' '{gsub(/[^0-9.]/,"",$4); print $4}' <<<"$summary")"

echo
echo "──────────────────────────────────────────────"
echo " coverage   lines ${lines}%   branch ${branch}%   funcs ${funcs}%"
echo " floor      ${floor}% (lines)"
echo "──────────────────────────────────────────────"

# Gate on line coverage (float-safe compare via awk).
if [ "$(awk -v l="$lines" -v f="$floor" 'BEGIN{print (l+0 >= f+0)?1:0}')" -ne 1 ]; then
  echo "✗ FAIL: line coverage ${lines}% is below the floor ${floor}%."
  echo "  Add tests, or if this drop is intentional lower tools/coverage-floor.txt."
  exit 1
fi

echo "✓ OK: line coverage ${lines}% meets the floor ${floor}%."

# Ratchet: lock in an improvement when asked. New floor = truncated integer of current
# (keeps the sub-point headroom), and only ever increases.
if [ "$bump" -eq 1 ]; then
  newfloor="$(awk -v l="$lines" 'BEGIN{printf "%d", l}')"
  if [ "$newfloor" -gt "$floor" ] 2>/dev/null; then
    echo "$newfloor" > "$FLOOR_FILE"
    echo "↑ ratcheted floor: ${floor}% → ${newfloor}%"
  else
    echo "  floor unchanged (current floor ${floor}% already ≥ truncated coverage ${newfloor}%)."
  fi
elif [ "$(awk -v l="$lines" -v f="$floor" 'BEGIN{print (int(l) > f+0)?1:0}')" -eq 1 ]; then
  echo "  tip: coverage improved — run with --bump to raise the floor to $(awk -v l="$lines" 'BEGIN{printf "%d", l}')%."
fi
