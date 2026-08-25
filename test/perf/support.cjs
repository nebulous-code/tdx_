'use strict';
/* Milestone 0 perf harness — deterministic seeder, op-count spies, and scenario
   definitions for the frontend engine benchmark (docs/PERFORMANCE_PLAN.md).

   Headless and zero-production-change: it reuses the golden loader (freshStore) and the
   frozen clock, seeds a realistic store at any scale N, and DRIVES the same store
   derivations the Vue components call — counting invocations of the hot primitives. The
   counts are deterministic (seeder is index-derived, clock frozen), so they make a stable
   regression gate; wall-clock is measured separately as a scaling trend. See ./README.md. */

const { freezeClock } = require('../support/clock.cjs');
const { loadStore, freshStore, execFile } = require('../support/load.cjs');

freezeClock();
loadStore(); // Vue + engines + data.js -> window.store
execFile('sync.js'); // -> window.Sync (loadStore does not include it)

// ---- deterministic date helpers (frozen base 2026-06-18; explicit-arg Date is not frozen) ----
const DAY = 86400000;
const BASE = new Date().getTime();
const ymd = (off) => new Date(BASE + off * DAY).toISOString().slice(0, 10);
const iso = (off) => new Date(BASE + off * DAY).toISOString();

// ---- seeder: realistic shape at scale (prod ~= 963 tasks, 70% done, 35 proj, 67 labels) ----
function genProjects(P) {
  const out = [];
  for (let i = 0; i < P; i++) {
    out.push({
      id: 'bp' + i,
      parentId: i > 4 && i % 3 === 0 ? 'bp' + (i % 5) : null,
      name: 'Project ' + i,
      color: '#888888',
      glyph: '#',
      collapsed: false,
      readableId: 'p_' + String(i).padStart(4, '0'),
    });
  }
  return out;
}
function genLabels(L) {
  const out = [];
  for (let i = 0; i < L; i++) out.push({ id: 'bl' + i, name: 'lbl' + i, pinned: i < 2, description: null });
  return out;
}
// a realistic saved-view spread; a few pinned (topbar badges), all with queries that match
function genSavedQueries() {
  return [
    { id: 'bsv_open', name: 'Open', glyph: '○', query: 'status:open', system: true, pinned: true },
    { id: 'bsv_over', name: 'Overdue', glyph: '!', query: 'status:overdue', system: true, pinned: true },
    { id: 'bsv_today', name: 'Today', glyph: '☉', query: 'status:open due:today', system: true, pinned: true },
    { id: 'bsv_l3', name: 'Lbl3', glyph: '#', query: 'label:lbl3 status:open', system: false, pinned: true },
    { id: 'bsv_l7', name: 'Lbl7', glyph: '#', query: 'label:lbl7 status:open', system: false, pinned: false },
    { id: 'bsv_p2', name: 'Proj2', glyph: '#', query: 'project:p_0002 status:open', system: false, pinned: false },
    { id: 'bsv_hi', name: 'High', glyph: '★', query: 'priority:5 status:open', system: false, pinned: false },
    { id: 'bsv_done', name: 'Done', glyph: '✓', query: 'status:done', system: false, pinned: false },
  ];
}
function genTasks(N, projIds, labelIds) {
  const tasks = [];
  let lastRoot = null;
  let lastChild = null;
  for (let i = 0; i < N; i++) {
    let parentId = null;
    if (i >= 2 && i % 27 === 13 && lastChild) parentId = lastChild; // grandchild (~4%)
    else if (i >= 1 && i % 9 === 4 && lastRoot) parentId = lastRoot; // child (~11%)
    const done = i % 10 >= 3; // ~70% done, matching prod
    const t = {
      id: 'bt' + i,
      projectId: projIds[i % projIds.length],
      parentId,
      title: 'Bench task ' + i,
      done,
      due: i % 5 === 0 ? null : ymd((i % 40) - 20),
      reminder: null,
      labels: i % 2 === 0 ? [labelIds[i % labelIds.length]] : [],
      recurrence: i % 4 === 0 ? 'weekly on mon,wed,fri' : null,
      notes: '',
      priority: (i % 5) + 1,
      size: i % 8,
      collapsed: false,
      createdAt: iso(-(i % 60)),
      completedAt: done ? iso(-(i % 30)) : null,
      updatedAt: iso(-(i % 15)),
      readableId: 't_' + String(i).padStart(4, '0'),
    };
    tasks.push(t);
    if (parentId === null) lastRoot = t.id;
    else lastChild = t.id;
  }
  return tasks;
}

// A fresh store re-seeded to N. Splices synthetic entities into the reactive arrays the same
// way applyState() does, so everything is a real reactive proxy (real per-access cost).
function seedStore(N, opts = {}) {
  const P = opts.projects || 35;
  const L = opts.labels || 67;
  const store = freshStore();
  store.toast = () => {}; // suppress the auto-removing setTimeout toast
  const projects = genProjects(P);
  const labels = genLabels(L);
  const saved = genSavedQueries();
  const tasks = genTasks(N, projects.map((p) => p.id), labels.map((l) => l.id));
  store.projects.splice(0, store.projects.length, ...projects);
  store.labels.splice(0, store.labels.length, ...labels);
  store.savedQueries.splice(0, store.savedQueries.length, ...saved);
  store.tasks.splice(0, store.tasks.length, ...tasks);
  store.setView({ kind: 'query', id: 'bench', title: 'Bench', query: 'status:open' });
  return { store, saved, projects, labels, N };
}

// ---- op-count spies: count invocations of the hot primitives, nested calls included ----
const HOT = ['Q.run', 'visibleRoots', 'visibleRows', 'queryCount', 'projectCount', 'subtasks', 'taskById', 'Sync.snapshot', 'Sync.diff'];
const counters = {};
function resetCounters() { for (const k of HOT) counters[k] = 0; }
function readCounters() { return { ...counters }; }

// globals (Q/Sync) persist across freshStore(); capture their true originals once and always
// re-wrap from the original so re-seeding never double-counts. Store methods are recreated by
// each freshStore(), so wrap them fresh per seed.
let origQrun;
let origSnap;
let origDiff;
function installSpies(store) {
  resetCounters();
  if (!origQrun) origQrun = window.Q.run.bind(window.Q);
  window.Q.run = (...a) => { counters['Q.run']++; return origQrun(...a); };
  if (!origSnap) origSnap = window.Sync.snapshot.bind(window.Sync);
  window.Sync.snapshot = (...a) => { counters['Sync.snapshot']++; return origSnap(...a); };
  if (!origDiff) origDiff = window.Sync.diff.bind(window.Sync);
  window.Sync.diff = (...a) => { counters['Sync.diff']++; return origDiff(...a); };
  for (const m of ['visibleRoots', 'visibleRows', 'queryCount', 'projectCount', 'subtasks', 'taskById']) {
    const orig = store[m].bind(store);
    store[m] = (...a) => { counters[m]++; return orig(...a); };
  }
}

// ---- scenarios: each models one user action via the derivations the components invoke ----
const scenarios = {
  // switching to / loading a view (the open task list)
  openView: (ctx) => {
    ctx.store.setView({ kind: 'query', id: 'bench', title: 'Bench', query: 'status:open' });
    ctx.store.visibleRoots();
  },
  // one j/k keypress: the global key handler rebuilds the flattened row list
  navKey: (ctx) => {
    ctx.store.visibleRows();
  },
  // one keystroke in the search bar: the list re-derives AND the pinned badges recount
  searchKeystroke: (ctx) => {
    ctx.store.setView({ kind: 'query', id: 'bench', title: 'Bench', query: 'status:open' });
    ctx.store.visibleRoots();
    for (const s of ctx.saved) if (s.pinned) ctx.store.queryCount(s.query);
  },
  // toggling one task done, then the save cost persist() pays (full-store snapshot + diff)
  toggleDone: (ctx) => {
    const t = ctx.store.tasks.find((x) => !x.parentId && !x.done && !x.recurrence);
    if (t) ctx.store.toggleDone(t);
    const snap = window.Sync.snapshot(ctx.store);
    window.Sync.diff(snap, snap); // self-diff: same O(n) canon/stringify cost as a real diff
    if (t) ctx.store.toggleDone(t); // revert so repeated runs are identical
  },
  // one sidebar/header render: a badge count per saved view + per label + per project
  sidebarRender: (ctx) => {
    for (const s of ctx.saved) if (ctx.store.viewCountable(s)) ctx.store.queryCount(s.query);
    for (const l of ctx.store.sortedLabels()) ctx.store.queryCount('label:' + l.name + ' status:open');
    for (const p of ctx.store.projects) ctx.store.projectCount(p.id);
  },
};
const SCENARIO_NAMES = Object.keys(scenarios);

// Scenarios that model REPEATED interaction with no task change (holding j/k, re-rendering the
// sidebar on a cursor move). The runner warms these once before measuring, so the op-counts
// reflect the steady state — after Milestone 1 these are cache hits (~0 expensive ops); before,
// each repeat re-scanned everything. The rest (openView / searchKeystroke / toggleDone) are
// measured cold, since each is a genuinely new computation (new view, new query, a mutation).
const WARM = new Set(['navKey', 'sidebarRender']);

module.exports = { seedStore, installSpies, resetCounters, readCounters, scenarios, SCENARIO_NAMES, WARM, HOT };
