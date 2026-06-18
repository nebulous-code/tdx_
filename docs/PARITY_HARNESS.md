# Parity Harness — characterization tests for the D1 rewrite

> Status: **plan for review.** This is **D1 Step 0** (`PLATFORM_ARCHITECTURE.md` §11): before rewriting anything, lock today's behavior in tests so the TypeScript port has an exact target to match. Doubles as the "log any functionality lost" safety net when daily-driving.

## The core insight: a fat frontend isn't an untestable one
The riskiest, gnarliest logic — `Q` (query engine, `query.js`) and `Rec` (recurrence, `recurrence.js`) — is already **pure and DOM-free**: it runs on plain task objects, no Vue, no browser. It only *looks* trapped because each file ends in `window.Q = {…}` / `window.Rec = {…}` instead of a normal export. Unlock that and it's testable in Node today — so the highest-value coverage is also the easiest.

The strategy is **golden-master (characterization) testing**: feed a corpus of fixtures through the *current* code and record its outputs as "golden" files. We don't hand-write expected values — the current code generates them. The TS port must then reproduce the same goldens exactly = behavioral parity, proven rather than hoped.

## Three tiers (easiest / highest-value first)

### Tier 1 — the pure engines (`Q`, `Rec`) — do first, most of the value
- **Make them `require`-able** with a one-line dual-export at the bottom of each file: `if (typeof module !== 'undefined' && module.exports) module.exports = Q;`. The browser ignores `module` (undefined there) → zero impact on the running app; Node can now `require('../frontend/js/query.js')`.
- **Golden tests:** run the corpus (task fixtures × queries; recurrence rules × anchor dates) through the current `Q.run` / `Rec.nextOccurrences`/parse/date-math and snapshot the outputs. This pins every edge case (weekday windows, month boundaries, "every Nth weekday," overdue math, due:none/set, comparators) without enumerating them by hand.

### Tier 2 — the entangled "smart rules" — medium effort, where the relocation risk lives
The non-pure behaviors in `data.js` that lean on Vue `reactive` + the globals: **spawn-next-occurrence on complete**, **due-date inference**, **`viewDefaults` inheritance**, **`visibleRoots` filter/sort**, the completion filter. Test headlessly: load `vue.global.prod.js` + `recurrence.js` + `query.js` + `data.js` into a Node context (a small `window` shim, or jsdom), build a `store`, drive it, assert — e.g. "create a recurring task → toggle done → next occurrence exists with the correct due date." Same golden-master idea, over the store instead of a pure function. This is where recurrence's *behavioral* move (client→server) is riskiest, so it earns the setup.

### Tier 3 — a few true end-to-end smokes — sparing
Playwright/Puppeteer driving the real app for ~5–10 critical-path workflows (add recurring task → complete → see next; filter; search; soft-delete). Highest fidelity, highest cost — for smokes, not coverage.

## Tooling
- **`node:test`** (Node's built-in runner, zero new dependencies, runs `*.test.js`) — matches the no-build ethos and needs nothing installed.
- The only frontend change is the two **1-line dual-exports**. (Tier 2 needs the Vue global build loadable in Node, which it already is.)

## The corpus
Mix **hand-crafted edge cases** (one task of every recurrence flavor; overdue/today/future; subtasks; labels; each completion state; priority/size) with an **anonymized slice of real prod data** — your real tasks are the best characterization input because they cover what you actually do. Keep the corpus as committed fixtures so goldens are reproducible.

## How it plugs into the rewrite
The exact corpus + goldens run **unchanged** against the TS port (the port adds a thin adapter so the same fixtures feed `Rec`/`Q` in TS). Green = parity. **Recurrence is ported test-first**: write/confirm its goldens, then port until they pass, before wiring it into endpoints.

## Step-0 checklist — **DONE** (lives in `test/`, run with `npm test`; see `test/README.md`)
- [x] Add `node:test` scaffolding (a `test/` dir, a root `package.json` `test` script, zero deps).
- [x] ~~Dual-export `query.js`/`recurrence.js`~~ → **global-shim loader** (`vm.runInThisContext` with `window=globalThis`), zero frontend edits. It naturally resolves the cross-file globals (query.js's bare `Rec`, data.js's `Vue`) that a dual-export alone wouldn't, and `var Vue` in the vendored global build (which `require` would hide). Determinism comes from a frozen clock + `TZ=UTC` (`support/clock.cjs`).
- [x] Assemble the fixture corpus (crafted edge cases; the store seeds its own deterministic data for Tier 2). Anonymized real-data slice deferred — the synthetic corpus covered the predicates and the store seed is realistic.
- [x] Golden tests: `Rec` (parse/stringify/summary/compact, next-occurrences, matches, date math).
- [x] Golden tests: `Q` (parse + build round-trip, `run` over the corpus battery, dueDelta/slug).
- [x] Headless store tests: spawn-on-complete, due-inference (the real `task-detail.js` method), `viewDefaults`, `searchRoots`/`visibleRoots`/completion. Vue's global build loads in Node with no DOM, so **no jsdom** was needed.
- [ ] (Optional, deferred) Playwright smokes for the handful of critical workflows.
- [x] The same corpus/goldens (plain JSON) become the TS port's parity target.

## First concrete move
Add the two dual-export lines, drop in one `node:test` file, and golden the `Rec` + `Q` outputs over a starter corpus. That alone de-risks the scariest 80% before a single line of the new backend exists.
