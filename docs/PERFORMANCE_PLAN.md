# tdx Performance Plan

High-level roadmap for making tdx fast again as the dataset grows, and for proving — automatically — that each change helps and that we don't regress over time. Milestones are ordered but the benchmark foundation (Milestone 0) is built first and runs alongside everything after it. Detail is deliberately light here; each milestone gets its own implementation plan when we pick it up.

## Why

The app has gotten slower as prod has grown, to the point where keyboard commands lag and the mouse feels faster. Current prod scale (for reference):

- ~963 tasks loaded at boot, **~70% of them done**; ~101 notes; 35 projects, 67 labels.
- ~520 KB bootstrap payload, parsed and made reactive on every load.
- ~200–300 task completions per month, and completed tasks never leave the working set — so the load grows without bound.

Two things drive the slowness: **everything is loaded at once** (the whole DB into a deeply-reactive store), and **everything is recomputed from scratch on every interaction** (no memoization, no index, no virtualization — a single keypress re-derives the full filtered/sorted list and re-runs every badge count). The data size is what makes each of those recomputations expensive, and it only grows.

## Root causes (what the milestones attack)

- The server ships all non-archived tasks at boot, done included; the client holds them all as reactive proxies.
- Navigation and search re-run the full query + sort on every keypress; nothing is cached between mutations.
- Sidebar/header badge counts re-scan all tasks on every render.
- Saving diffs the whole store (O(n) serialize of every task) on every change.
- No parent→children / id index (subtask and lookup helpers scan all tasks), and no list virtualization.
- Completed tasks accumulate forever, so the working set never stops growing.

## Milestone 0 — Benchmark & audit foundation

Built first so every later change is measurable and self-verifying. The guiding principle: **gate on deterministic operation counts, not wall-clock time** (CI runners are too noisy for millisecond thresholds, and the real bugs are algorithmic). Wall-clock is tracked as a trend/audit, not a hard gate.

- A parametrized, deterministic dataset seeder (N tasks with realistic shape: done/open ratio, subtree nesting, labels, projects), reused by every other layer.
- Deterministic "perf-invariant" tests that count expensive operations and assert the design contract — e.g. a keypress triggers zero extra full queries, one save serializes only changed entities, a badge is computed once per render, subtask/lookup helpers are O(1). These are the regression backbone; each perf fix ships with the invariant that locks it in.
- Scaling microbenchmarks: time the hot operations at increasing N and assert the growth stays roughly linear (catch accidental O(n^2)); record raw numbers against a ratcheting baseline file, the same pattern as the existing coverage floors.
- Payload / reactivity budgets: assert what bootstrap ships and how many reactive objects the store holds after load.
- Server DB checks: query-plan assertions that common queries use their indexes (no full-table scans), plus timing on a large seeded DB.
- A periodic browser-latency audit (real app, large dataset, measured interaction latency) that produces a report/trend rather than blocking a build — the closest thing to "how it feels."

How it runs: fast deterministic checks on every change; the wall-clock scaling and browser-latency audits on a schedule (or on demand) as a report. Exact CI shape is flexible — we'll use whatever keeps the deterministic guards honest and the audits informative without flaky failures.

## Milestone 1 — Responsiveness (quick wins, no data-model change)

Goal: keyboard commands feel instant at today's scale. Lowest risk, highest bang for the buck, touches only the client's compute paths.

- Memoize query results and the visible-list derivation, keyed on the query plus a task-version counter, so navigation and repeated views are cache hits between edits.
- Add parent→children and id→task indexes to replace the O(n) subtask/lookup scans.
- Debounce the search input so typing doesn't re-query on every keystroke.
- Cache the sidebar/header badge counts so they don't re-scan all tasks on every render.

## Milestone 2 — Bound the working set and its growth

Goal: cut what we load by roughly 70% today and keep it bounded as completions pile up. Medium effort, well contained.

- Stop loading done tasks at boot; lazy-fetch them only when a view actually needs them (showing completed, or an explicitly done/history query).
- Auto-archive old completed tasks (with attention to completed recurring occurrences, which dominate the growth) so the live dataset stops growing without limit.

## Milestone 3 — Structural (only if 1–2 aren't enough)

Goal: scale smoothly to many thousands of tasks. Larger, riskier changes — pursue only if the earlier milestones don't hold up as data keeps growing.

- Virtualize the task list so only visible rows render.
- Move tasks to shallow reactivity with explicit invalidation, to drop the deep-watch traversal cost per mutation.
- Make sync incremental (diff only changed entities) instead of serializing the whole store per save.
- Endgame option: server-side query per view, so the client holds only the current view's results instead of the whole dataset. Biggest change; trades some instant client-side interactivity and complicates undo/offline/counts — a last resort.

## Sequencing

Milestone 0 first (the harness), then Milestone 1 (fixes the felt keyboard lag), then Milestone 2 (shrinks and bounds the load). Re-measure with the benchmarks after each. Milestone 3 is held unless the numbers say we still need it. Every perf change lands with the invariant/benchmark that proves it and guards it going forward.
