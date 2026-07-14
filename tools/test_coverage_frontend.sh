#!/usr/bin/env bash
# tools/test_coverage_frontend.sh — the frontend twin of test_coverage.sh.
#
# Runs the golden-master suite (test/*.test.cjs) with Node's built-in V8 coverage — no extra
# deps, no jsdom, no bundler — prints the per-file table, and enforces RATCHETING floors from
# tools/coverage-floor-frontend.txt. Floors only move up: a regression fails (exit 1);
# improvements are locked in with --bump.
#
#   tools/test_coverage_frontend.sh          # run + report + gate
#   tools/test_coverage_frontend.sh --bump   # same, but ratchet the floors up where they improved
#
# WHY THIS EXISTS: CI ran only the SERVER suite, so the frontend engines were untested in CI —
# which is how a store test stayed red from June 30 (da7dac6 deleted store.searchRoots) until
# someone happened to run `npm test` locally. The creation language (frontend/js/create.js) is
# frontend-ONLY: without this gate, breaking `$friday` parsing ships to prod green.
#
# SCOPE — the code the harness actually drives:
#   included: create.js · query.js · recurrence.js · data.js · sync.js
#   excluded: vue.global.prod.js (vendored third-party) and task-detail.js (a Vue COMPONENT —
#             only one pure method, inferDueFromRecurrence, is reachable headlessly, so its 3%
#             would drag the aggregate into meaninglessness). Components need Playwright, which
#             docs/PARITY_HARNESS.md defers on purpose.
#
# Note on the FUNCTIONS floor (52, vs 81 lines): data.js is a Vue store, and a large share of it
# is UI glue (drawer openers, modal flows, toasts) that no headless test calls. The engines
# themselves sit at 93-100%. The floor measures the aggregate, so it's honest rather than
# flattering — and it still fails on any real regression.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLOOR_FILE="$ROOT/tools/coverage-floor-frontend.txt"

bump=0
[ "${1:-}" = "--bump" ] && bump=1

read_floor() { grep -E "^$1=" "$FLOOR_FILE" | head -1 | cut -d= -f2 | tr -dc '0-9.'; }
floor_lines="$(read_floor lines)";         floor_lines="${floor_lines:-0}"
floor_branches="$(read_floor branches)";   floor_branches="${floor_branches:-0}"
floor_functions="$(read_floor functions)"; floor_functions="${floor_functions:-0}"

echo "running frontend golden suite with coverage…"
echo "floors → lines ${floor_lines}%  branches ${floor_branches}%  functions ${floor_functions}%"
echo

# TZ=UTC + the frozen clock (test/support/clock.cjs) are what make the goldens deterministic.
# The engines are loaded via vm.runInThisContext with ABSOLUTE filenames (test/support/load.cjs)
# — that's what lets V8 attribute coverage to them at all.
set +e
out="$(cd "$ROOT" && TZ=UTC node --test --experimental-test-coverage \
  --test-coverage-exclude="test/**" \
  --test-coverage-exclude="frontend/js/vue.global.prod.js" \
  --test-coverage-exclude="frontend/js/task-detail.js" \
  "test/**/*.test.cjs" 2>&1)"
status=$?
set -e
echo "$out"

if [ "$status" -ne 0 ]; then
  echo
  echo "✗ tests failed (exit $status) — coverage not evaluated."
  exit "$status"
fi

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

ge() { [ "$(awk -v a="$1" -v b="$2" 'BEGIN{print (a+0 >= b+0)?1:0}')" -eq 1 ]; }

fail=0
ge "$lines" "$floor_lines"         || { echo "✗ line coverage ${lines}% < floor ${floor_lines}%"; fail=1; }
ge "$branches" "$floor_branches"   || { echo "✗ branch coverage ${branches}% < floor ${floor_branches}%"; fail=1; }
ge "$functions" "$floor_functions" || { echo "✗ function coverage ${functions}% < floor ${floor_functions}%"; fail=1; }

if [ "$fail" -ne 0 ]; then
  echo "  Add tests, or if a drop is intentional lower the relevant floor in tools/coverage-floor-frontend.txt."
  exit 1
fi
echo "✓ OK: all metrics meet their floors."

if [ "$bump" -eq 1 ]; then
  set_floor() { # $1=key $2=current%
    local cur; cur="$(awk -v v="$2" 'BEGIN{printf "%d", v}')"
    local old; old="$(read_floor "$1")"; old="${old:-0}"
    if [ "$cur" -gt "${old%.*}" ] 2>/dev/null; then
      awk -v k="$1" -v v="$cur" -F= '{ if($1==k) print k"="v; else print }' "$FLOOR_FILE" > "$FLOOR_FILE.tmp" && mv "$FLOOR_FILE.tmp" "$FLOOR_FILE"
      echo "↑ ratcheted ${1}: ${old}% → ${cur}%"
    fi
  }
  set_floor lines "$lines"
  set_floor branches "$branches"
  set_floor functions "$functions"
fi
