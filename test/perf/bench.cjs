'use strict';
/* Milestone 0 perf benchmark runner (docs/PERFORMANCE_PLAN.md).

   Modes:
     (default)  gate   — run each scenario at the reference N, compare op-counts to the
                         committed budget (tools/perf-budget.json), fail if any EXCEEDS it.
     --update          — same, but rewrite the budget to the current counts (re-baseline
                         after an INTENTIONAL change; counts should only ever ratchet DOWN).
     --audit           — sweep N = 100 / 1000 / 5000, print counts + wall-clock + the growth
                         ratio per scenario. Report only, no gate (wall-clock is a trend).

   Op-counts are the gate because they are deterministic; wall-clock is noisy and reported,
   never gated. Run via tools/perf_bench.sh (sets TZ=UTC). */

const fs = require('fs');
const path = require('path');
const { seedStore, installSpies, resetCounters, readCounters, scenarios, SCENARIO_NAMES, WARM, HOT } = require('./support.cjs');

const BUDGET_FILE = path.resolve(__dirname, '../../tools/perf-budget.json');
const REF_N = 1000;
const SWEEP = [100, 1000, 5000];
const K = 7; // wall-clock samples per scenario (median taken)

const mode = process.argv.includes('--update') ? 'update' : process.argv.includes('--audit') ? 'audit' : 'gate';
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// counts are deterministic → one measured run; wall-clock → median of `samples`.
// WARM scenarios run once first (uncounted) so the measured run reflects the cache-hit steady
// state — the realistic cost of repeated interaction with no task change.
function runScenario(name, ctx, samples = K) {
  if (WARM.has(name)) scenarios[name](ctx);
  resetCounters();
  scenarios[name](ctx);
  const counts = readCounters();
  const times = [];
  for (let k = 0; k < samples; k++) {
    const t0 = process.hrtime.bigint();
    scenarios[name](ctx);
    const t1 = process.hrtime.bigint();
    times.push(Number(t1 - t0) / 1e6);
  }
  return { counts, ms: median(times) };
}
function seedAndSpy(N) { const ctx = seedStore(N); installSpies(ctx.store); return ctx; }
const nonzero = (counts) => HOT.filter((k) => counts[k] > 0);

function fmtCounts(counts) { return nonzero(counts).map((k) => `${k}=${counts[k]}`).join('  ') || '(none)'; }

// ---- gate / update ----
function gate(update) {
  const ctx = seedAndSpy(REF_N);
  const results = {};
  for (const name of SCENARIO_NAMES) results[name] = runScenario(name, ctx);

  if (update) {
    const budget = { referenceN: REF_N, note: 'op-count ceilings; ratchet DOWN via --update. see docs/PERFORMANCE_PLAN.md', scenarios: {} };
    for (const name of SCENARIO_NAMES) budget.scenarios[name] = results[name].counts;
    fs.writeFileSync(BUDGET_FILE, JSON.stringify(budget, null, 2) + '\n');
    console.log(`updated ${path.relative(process.cwd(), BUDGET_FILE)} (reference N=${REF_N})\n`);
  }

  if (!fs.existsSync(BUDGET_FILE)) {
    console.log('no budget file — run: tools/perf_bench.sh --update');
    process.exit(2);
  }
  const budget = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
  console.log(`perf gate — op-counts at reference N=${REF_N} (ceilings from ${path.basename(BUDGET_FILE)})\n`);

  let failed = 0;
  for (const name of SCENARIO_NAMES) {
    const { counts, ms } = results[name];
    const bud = (budget.scenarios || {})[name] || {};
    const over = HOT.filter((k) => (counts[k] || 0) > (bud[k] === undefined ? Infinity : bud[k]));
    const flag = over.length ? 'FAIL' : ' OK ';
    if (over.length) failed++;
    console.log(`  [${flag}] ${name.padEnd(16)} ${fmtCounts(counts)}   (${ms.toFixed(2)}ms)`);
    for (const k of over) console.log(`         ${k}: ${counts[k]} > budget ${bud[k]}`);
  }
  console.log('');
  if (failed) {
    console.log(`FAIL: ${failed} scenario(s) exceeded budget. If intentional, re-baseline: tools/perf_bench.sh --update`);
    process.exit(1);
  }
  console.log('OK: all scenarios within their op-count budget.');
}

// ---- audit (scaling report, no gate) ----
function audit() {
  console.log(`perf audit — scaling sweep N = ${SWEEP.join(' / ')} (op-counts are deterministic; ms is a noisy trend)\n`);
  const data = {}; // name -> N -> {counts, ms}
  for (const N of SWEEP) {
    const ctx = seedAndSpy(N);
    const samples = N <= 1000 ? 5 : 2; // fewer wall-clock samples at large N so the sweep stays quick
    for (const name of SCENARIO_NAMES) {
      (data[name] || (data[name] = {}))[N] = runScenario(name, ctx, samples);
    }
  }
  for (const name of SCENARIO_NAMES) {
    console.log(`  ${name}`);
    for (const N of SWEEP) {
      const { counts, ms } = data[name][N];
      console.log(`    N=${String(N).padStart(5)}  ${ms.toFixed(3).padStart(9)}ms   ${fmtCounts(counts)}`);
    }
    const lo = data[name][SWEEP[0]].ms;
    const hi = data[name][SWEEP[SWEEP.length - 1]].ms;
    const nRatio = SWEEP[SWEEP.length - 1] / SWEEP[0];
    console.log(`    ms growth ${SWEEP[0]}->${SWEEP[SWEEP.length - 1]}: ${(hi / Math.max(lo, 1e-6)).toFixed(1)}x  (data grew ${nRatio}x → ~linear if similar, super-linear if higher)\n`);
  }
}

if (mode === 'audit') audit();
else gate(mode === 'update');
