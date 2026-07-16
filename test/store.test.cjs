'use strict';
/* Tier 2 — the reactive store's "smart rules" (data.js), driven headlessly.
   The store seeds its own deterministic sample data (relative dates resolve
   against the frozen clock), so it doubles as the fixture. Each mutating test
   takes a fresh store (uid counter reset) for isolation + stable ids. */
const { test } = require('node:test');
const assert = require('node:assert');
const { freezeClock } = require('./support/clock.cjs');
freezeClock();
const { loadStore, freshStore, execFile } = require('./support/load.cjs');
const { golden } = require('./support/golden.cjs');

loadStore(); // load Vue + engines + data.js once

// Map generated ids (UUIDs from uid(), or legacy …_<n>) to stable tokens so the
// golden is deterministic; seed ids (t1, p_tdx) pass through unchanged.
const GENERATED = /_\d+$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function genLabeler() {
  const map = new Map();
  let n = 0;
  return (id) => {
    if (id == null || !GENERATED.test(id)) return id;
    if (!map.has(id)) map.set(id, 'gen_' + ++n);
    return map.get(id);
  };
}

test('store: completion pills — completionPass + min-one toggle rule', () => {
  const store = freshStore();
  const open = store.tasks.find((t) => !t.done);
  const done = store.tasks.find((t) => t.done);
  const snap = (action) => ({
    action,
    completion: { ...store.completion },
    passOpen: store.completionPass(open),
    passDone: store.completionPass(done),
  });
  const trace = [snap('default')];
  store.toggleCompletion('open'); trace.push(snap("toggle open (only one on → stays)"));
  store.toggleCompletion('done'); trace.push(snap('toggle done on'));
  store.toggleCompletion('open'); trace.push(snap('toggle open off'));
  store.toggleCompletion('done'); trace.push(snap("toggle done off (only one on → stays)"));
  golden('store.completion', trace);
});

test('store: viewDefaults across representative views', () => {
  const store = freshStore();
  const cases = [
    { label: 'project view (p_tdx)', view: { kind: 'project', id: 'p_tdx', title: 'tdx-app', query: '' } },
    { label: 'label view (urgent)', view: { kind: 'query', id: 'label_urgent', title: '#urgent', query: 'label:urgent status:open' } },
    { label: 'Today', view: { kind: 'query', query: 'status:open due:today' } },
    { label: 'Overdue', view: { kind: 'query', query: 'status:overdue' } },
    { label: 'This week', view: { kind: 'query', query: 'status:open due:week' } },
    { label: 'No date', view: { kind: 'query', query: 'due:none status:open' } },
    { label: 'Recurring', view: { kind: 'query', query: 'recurring:true status:open' } },
    { label: 'Quick (label:quick)', view: { kind: 'query', query: 'label:quick status:open' } },
    { label: 'Weekday window (due:mwf)', view: { kind: 'query', query: 'status:open due:mwf' } },
  ];
  const out = cases.map((c) => {
    store.view = c.view;
    store.completion = { open: true, done: false };
    return { label: c.label, query: store.currentQuery(), defaults: store.viewDefaults(), warn: store.viewWarn() };
  });
  // completed-only pills → new task is created done
  store.view = { kind: 'query', query: 'status:open' };
  store.completion = { open: false, done: true };
  out.push({ label: 'completed-only pills', query: store.currentQuery(), defaults: store.viewDefaults(), warn: store.viewWarn() });
  golden('store.viewDefaults', out);
});

test('store: visibleRoots — filter + sort + completion', () => {
  const store = freshStore();
  const run = (label, { view, sortField, completion }) => {
    store.view = view;
    store.sortField = sortField || 'due';
    store.completion = completion || { open: true, done: false };
    store.searchActive = false;
    store.healthFilter = null;
    return { label, view: store.currentQuery(), sort: store.sortField, completion: { ...store.completion }, ids: store.visibleRoots().map((t) => t.id) };
  };
  const out = [
    run('project p_tdx, due asc', { view: { kind: 'project', id: 'p_tdx' }, sortField: 'due' }),
    run('project p_tdx, +completed', { view: { kind: 'project', id: 'p_tdx' }, sortField: 'due', completion: { open: true, done: true } }),
    run('project p_tdx, title asc', { view: { kind: 'project', id: 'p_tdx' }, sortField: 'title' }),
    run('project p_tdx, priority (desc)', { view: { kind: 'project', id: 'p_tdx' }, sortField: 'priority' }),
    run('status:open due:week, due asc', { view: { kind: 'query', query: 'status:open due:week' }, sortField: 'due' }),
    run('status:overdue', { view: { kind: 'query', query: 'status:overdue' }, sortField: 'due' }),
    run('recurring:true status:open', { view: { kind: 'query', query: 'recurring:true status:open' }, sortField: 'due' }),
  ];
  golden('store.visibleRoots', out);
});

// `store.searchRoots` — a client-side, task-only, relevance-ranked matcher — was DELETED in
// da7dac6, when the `/` find became a server-backed cross-type query (store.runSearch ->
// store.runQuery -> /api/query). This test kept calling it and had been red ever since.
// What's left client-side is the QUERY runSearch builds and its stale-response guard, so
// that's what we pin now. The matching itself is the unified engine's job and is tested in
// server/test/unified-query.test.ts.
test('store: runSearch builds a text-only query (a stray `due:` stays TEXT, never a field)', async () => {
  const store = freshStore();
  const asked = [];
  store.runQuery = async (q) => { asked.push(q); return [{ type: 'task', id: 't1' }]; };

  const out = [];
  for (const term of ['review', 'ch.', 'rotate the keys', 'due:today', 'say "hi"']) {
    store.searchTerm = term;
    await store.runSearch();
    out.push({ term, query: asked[asked.length - 1] });
  }
  // an empty box asks NOTHING and clears the results
  store.searchTerm = '   ';
  await store.runSearch();
  assert.equal(asked.length, out.length, 'a blank find must not hit the query engine');
  assert.deepEqual(store.searchResults, []);

  golden('store.runSearch', out);
});

test('store: runSearch — a stale response never overwrites a newer one', async () => {
  const store = freshStore();
  // the first call resolves LAST (a slow keystroke landing after a fast one)
  let release;
  const slow = new Promise((r) => { release = r; });
  let call = 0;
  store.runQuery = async () => {
    call++;
    if (call === 1) { await slow; return [{ type: 'task', id: 'STALE' }]; }
    return [{ type: 'task', id: 'FRESH' }];
  };

  store.searchTerm = 'st';
  const first = store.runSearch();          // in flight
  store.searchTerm = 'stale';
  await store.runSearch();                  // supersedes it
  release();
  await first;

  assert.deepEqual(store.searchResults.map((i) => i.id), ['FRESH'],
    'the older response must be dropped by the _searchSeq guard');
});

test('store: toggleDone recurrence spawn', () => {
  const pick = (t, lab) => ({
    id: lab(t.id), title: t.title, projectId: t.projectId, parentId: lab(t.parentId),
    done: t.done, due: t.due, reminder: t.reminder, recurrence: t.recurrence,
    labels: [...t.labels], priority: t.priority, size: t.size,
  });
  const spawn = (taskId) => {
    const store = freshStore();
    store.toast = () => {}; // suppress the auto-removing setTimeout toast
    const target = store.taskById(taskId);
    const before = new Set(store.tasks.map((t) => t.id));
    const beforeCount = store.tasks.length;
    store.toggleDone(target);
    const lab = genLabeler();
    const created = store.tasks.filter((t) => !before.has(t.id)).map((t) => pick(t, lab));
    return { taskId, sourceDue: target.due, sourceDone: target.done, beforeCount, afterCount: store.tasks.length, created };
  };
  golden('store.spawn', {
    'weekly mwf with subtree (t1)': spawn('t1'),
    'every 3 days, no subtasks (h3)': spawn('h3'),
    'monthly day 1 with reminder gap (m1)': spawn('m1'),
    'non-recurring → no spawn (t2)': spawn('t2'),
  });
});

test('store: inferDueFromRecurrence (real task-detail.js method, headless)', () => {
  execFile('task-detail.js'); // -> window.TaskDetail (plain object literal, no DOM at load)
  const infer = globalThis.TaskDetail.methods.inferDueFromRecurrence;
  const cases = [
    { recurrence: 'daily', due: null },
    { recurrence: 'weekly on mon,wed,fri', due: null },
    { recurrence: 'monthly on day 1', due: null },
    { recurrence: 'monthly on last fri', due: null },
    { recurrence: 'every 3 days', due: null },
    { recurrence: 'weekly on mon', due: '2026-12-25' }, // existing due is respected
    { recurrence: null, due: null },
  ];
  const out = cases.map((c) => {
    const task = { recurrence: c.recurrence, due: c.due };
    infer.call({}, task); // explicit task arg → `this` unused
    return { recurrence: c.recurrence, dueIn: c.due, dueOut: task.due };
  });
  golden('store.inferDue', out);
});
