# Parity harness — Phase 0

Golden-master (characterization) tests that lock today's frontend engine behavior **before** the TypeScript backend rewrite. The current code generates the expected values; the committed `goldens/*.json` then become the exact parity target the TS port must reproduce. Design: `docs/PARITY_HARNESS.md`.

## Run

```sh
npm test            # run all tiers, compare against goldens
npm run test:update # regenerate goldens (after an INTENTIONAL behavior change)
```

Both pin `TZ=UTC`; the suite freezes the clock to **2026-06-18** (`support/clock.cjs`), so results are identical on any machine or CI. No dependencies are installed — `node:test` is built in, Vue's vendored global build and the engines load via a `vm.runInThisContext` global shim (`support/load.cjs`), so **nothing in `frontend/` is modified**.

## What's covered

- **Tier 1 — pure engines** (`rec.test.cjs`, `query.test.cjs`, `create.test.cjs`): `Rec` parse/stringify/summary/compact, `nextOccurrences`/`next`/`matches` with explicit from+anchor, date helpers; `Q` parse + build round-trip, `run` over the task corpus → matching ids, `dueDelta`/`slug`; `CL` (the creation language) parse × apply across all three entity types, the human-date parser, and the rules that keep it honest — first-wins, the `$5` guard, and **parse must not create labels** (`store.addLabel` has a side effect and ghost-completion reparses every keystroke).
- **Tier 2 — store smart rules** (`store.test.cjs`): completion-pill min-one rule, `viewDefaults`, `visibleRoots` (filter/sort/completion), `runSearch` (the text-only query it builds + its stale-response guard), `toggleDone` recurrence spawn (due/reminder-gap/subtree clone), and the real `inferDueFromRecurrence` from `task-detail.js`.
- **Tier 3 — Playwright smokes:** deferred (need a browser + the running app); add ~5–10 later.

## Layout

```
support/   clock (freeze + TZ), load (global-shim loader), golden (write/compare)
fixtures/  crafted corpus: tasks, projects, labels, queries, recurrence cases
goldens/   committed *.json — the parity spec; regenerate with `npm run test:update`
*.test.cjs the three tiers
```

## Workflow note

A failing golden means behavior drifted. If the change was **unintended**, fix the code. If it was **intended**, eyeball the diff (`git diff test/goldens`) to confirm it's what you meant, then `npm run test:update` to re-baseline. When the TS port lands, point its `Rec`/`Q` adapter at these same fixtures/goldens — green = proven behavioral parity.
