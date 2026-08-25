# Frontend engine perf harness (Milestone 0)

Headless benchmark for the store/query hot paths, per `docs/PERFORMANCE_PLAN.md`. It seeds the real reactive store at a chosen scale and drives the same derivations the Vue components call, counting invocations of the expensive primitives. No production code is involved — it only reads/drives what's already there (`test/support/load.cjs` `freshStore`, frozen clock).

## Run

```
tools/perf_bench.sh            # gate: op-counts vs tools/perf-budget.json (fails on a regression)
tools/perf_bench.sh --update   # re-baseline the budget after an INTENTIONAL improvement
tools/perf_bench.sh --audit    # scaling report at N = 100 / 1000 / 5000 (counts + wall-clock), no gate
```

## What it measures

Op-counts, not milliseconds, are the gate — they're deterministic (the seeder is index-derived and the clock is frozen), so they don't flake, and they catch the real bug class: re-running full scans per interaction. Wall-clock is reported by `--audit` as a scaling trend only; a growth ratio far above the data-growth ratio means a super-linear (O(n^2)) path.

Scenarios (each models one user action):

- `openView` — load/switch to the open task list.
- `navKey` — one `j`/`k` keypress (rebuilds the flattened row list).
- `searchKeystroke` — one keystroke in the query bar (list re-derives + pinned badges recount).
- `toggleDone` — complete one task + the save cost `persist()` pays (full-store snapshot + diff).
- `sidebarRender` — a badge count per saved view + per label + per project.

The counters (`Q.run`, `visibleRoots`, `visibleRows`, `queryCount`, `projectCount`, `subtasks`, `taskById`, `Sync.snapshot`/`diff`) count nested calls too, so e.g. `navKey` surfaces the ~300 `subtasks` scans a single keypress triggers today.

## The budget (`tools/perf-budget.json`)

Per-scenario op-count **ceilings**, ratcheting **down** (opposite of the coverage floors). The gate fails if any count exceeds its ceiling. After an intentional perf change (Milestones 1–2), review the drop and `--update` to lock the lower numbers in — so the win is guarded forever and an accidental regression trips the gate.

## Not covered here (later Milestone-0 slices)

Server DB query-plan/timing checks, bootstrap-payload composition budgets, and the Playwright browser interaction-latency audit (render + reactivity cost) — see `docs/PERFORMANCE_PLAN.md`.
