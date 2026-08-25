#!/usr/bin/env bash
# tools/perf_bench.sh — frontend engine performance benchmark (docs/PERFORMANCE_PLAN.md,
# Milestone 0). Headless, deterministic, no production code involved — it drives the store
# derivations at scale and counts the hot primitives.
#
#   tools/perf_bench.sh            # gate: op-counts vs tools/perf-budget.json (fails on regression)
#   tools/perf_bench.sh --update   # re-baseline the budget after an INTENTIONAL change
#   tools/perf_bench.sh --audit    # scaling report (N = 100/1000/5000), counts + wall-clock, no gate
#
# Op-counts are the gate (deterministic); wall-clock is a reported trend, never gated.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export TZ=UTC
exec node "$ROOT/test/perf/bench.cjs" "$@"
