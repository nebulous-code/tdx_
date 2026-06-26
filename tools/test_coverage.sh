#!/usr/bin/env bash
# tools/test_coverage.sh — audit backend test coverage on demand and in CI.
#
# Runs the server test suite with Node's built-in V8 coverage (no extra deps), prints
# the per-file table + summary, and enforces RATCHETING floors for lines/branches/functions
# stored in tools/coverage-floor.txt. Floors only ever move up: a regression below any of
# them fails (exit 1); improvements can be locked in with --bump.
#
#   tools/test_coverage.sh          # run + report + gate (exits 1 if any metric is below floor)
#   tools/test_coverage.sh --bump   # same, but raise each floor to the new value where it improved
#
# Coverage is scoped to src/ (the running server). One-off operational scripts (scripts/)
# and the tests themselves are excluded. The no-build Vue frontend has no test suite and is
# not measured here.
#
# Note on the branch floor (94, vs 95 for lines/functions): Node's V8 coverage counts some
# NON-executable TypeScript as uncovered "branches" — `interface` field lines and the
# continuation lines of multi-line Kysely query chains — plus the app.ts process-boot/listen
# guard that can't run under a test. Verified against c8 (which agrees at ~94%). 94 is the
# real achievable ceiling for branches; lines and functions sit near 99.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER="$ROOT/server"
FLOOR_FILE="$ROOT/tools/coverage-floor.txt"

bump=0
[ "${1:-}" = "--bump" ] && bump=1

# read floors (key=value); default to 0 if a key is missing
read_floor() { grep -E "^$1=" "$FLOOR_FILE" | head -1 | cut -d= -f2 | tr -dc '0-9.'; }
floor_lines="$(read_floor lines)";     floor_lines="${floor_lines:-0}"
floor_branches="$(read_floor branches)"; floor_branches="${floor_branches:-0}"
floor_functions="$(read_floor functions)"; floor_functions="${floor_functions:-0}"

echo "running server test suite with coverage…"
echo "floors → lines ${floor_lines}%  branches ${floor_branches}%  functions ${floor_functions}%"
echo

# Capture full output but keep the script alive on test failure so we can show it.
set +e
out="$(cd "$SERVER" && node --import tsx --test --experimental-test-coverage \
  --test-coverage-exclude="scripts/**" --test-coverage-exclude="test/**" \
  "test/**/*.test.ts" 2>&1)"
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
branches="$(awk -F'|' '{gsub(/[^0-9.]/,"",$3); print $3}' <<<"$summary")"
functions="$(awk -F'|' '{gsub(/[^0-9.]/,"",$4); print $4}' <<<"$summary")"

echo
echo "──────────────────────────────────────────────"
echo " coverage   lines ${lines}%   branches ${branches}%   functions ${functions}%"
echo " floor      lines ${floor_lines}%   branches ${floor_branches}%   functions ${floor_functions}%"
echo "──────────────────────────────────────────────"

# float-safe compare: is $1 >= $2 ?
ge() { [ "$(awk -v a="$1" -v b="$2" 'BEGIN{print (a+0 >= b+0)?1:0}')" -eq 1 ]; }

fail=0
ge "$lines" "$floor_lines"         || { echo "✗ line coverage ${lines}% < floor ${floor_lines}%"; fail=1; }
ge "$branches" "$floor_branches"   || { echo "✗ branch coverage ${branches}% < floor ${floor_branches}%"; fail=1; }
ge "$functions" "$floor_functions" || { echo "✗ function coverage ${functions}% < floor ${floor_functions}%"; fail=1; }

if [ "$fail" -ne 0 ]; then
  echo "  Add tests, or if a drop is intentional lower the relevant floor in tools/coverage-floor.txt."
  exit 1
fi
echo "✓ OK: all metrics meet their floors."

# Ratchet: lock in improvements when asked. New floor = truncated int of current, only up.
if [ "$bump" -eq 1 ]; then
  set_floor() { # $1=key $2=current%
    local cur; cur="$(awk -v v="$2" 'BEGIN{printf "%d", v}')"
    local old; old="$(read_floor "$1")"; old="${old:-0}"
    if [ "$cur" -gt "${old%.*}" ] 2>/dev/null; then
      # portable in-place edit (no GNU sed assumption)
      awk -v k="$1" -v v="$cur" -F= '{ if($1==k) print k"="v; else print }' "$FLOOR_FILE" > "$FLOOR_FILE.tmp" && mv "$FLOOR_FILE.tmp" "$FLOOR_FILE"
      echo "↑ ratcheted ${1}: ${old}% → ${cur}%"
    fi
  }
  set_floor lines "$lines"
  set_floor branches "$branches"
  set_floor functions "$functions"
fi
