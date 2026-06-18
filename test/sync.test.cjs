'use strict';
/* Diff-engine tests for the granular cutover (frontend/js/sync.js). Pure JS, so
   we load it via the same window-shim trick as the Phase-0 harness. */
const { test } = require('node:test');
const assert = require('node:assert');

if (!globalThis.window) globalThis.window = globalThis;
const Sync = require('../frontend/js/sync.js');

// minimal store fakes (only fields the whitelist reads need to be present)
const task = (id, over = {}) => ({
  id, title: 't', projectId: 'p1', parentId: null, done: false, due: null,
  reminder: null, recurrence: null, notes: '', priority: 0, size: 0, labels: [],
  collapsed: false, createdAt: '2026-01-01', completedAt: null, ...over,
});
const project = (id, over = {}) => ({ id, name: 'P', parentId: null, color: '#fff', glyph: '●', collapsed: false, health: [], ...over });
const label = (id, over = {}) => ({ id, name: 'l', pinned: false, ...over });
const sv = (id, over = {}) => ({ id, name: 'V', glyph: '◆', query: 'status:open', color: null, pinned: false, system: false, ...over });
const store = (o = {}) => ({ tasks: o.tasks || [], projects: o.projects || [], labels: o.labels || [], savedQueries: o.savedQueries || [] });

test('snapshot indexes by id with position = array index, whitelisted fields only', () => {
  const s = Sync.snapshot(store({ tasks: [task('t1', { title: 'A' }), task('t2', { title: 'B' })] }));
  assert.deepEqual(Object.keys(s.tasks), ['t1', 't2']);
  assert.equal(s.tasks.t1.position, 0);
  assert.equal(s.tasks.t2.position, 1);
  assert.equal(s.tasks.t1.title, 'A');
  assert.ok(!('collapsed' in s.tasks.t1)); // transient excluded
  assert.ok(!('createdAt' in s.tasks.t1)); // immutable excluded
  assert.ok(!('completedAt' in s.tasks.t1)); // server-derived excluded
});

test('no change → empty diff', () => {
  const a = store({ tasks: [task('t1')], projects: [project('p1')] });
  const d = Sync.diff(Sync.snapshot(a), Sync.snapshot(structuredClone(a)));
  for (const t of ['tasks', 'projects', 'labels', 'savedQueries']) {
    assert.deepEqual(d[t], { creates: [], updates: [], deletes: [] });
  }
});

test('create / update / delete are detected', () => {
  const prev = Sync.snapshot(store({ tasks: [task('t1', { title: 'A' })] }));
  const curr = Sync.snapshot(store({ tasks: [task('t1', { title: 'A2' }), task('t2')] }));
  assert.deepEqual(Sync.diff(prev, curr).tasks, { creates: ['t2'], updates: ['t1'], deletes: [] });

  const gone = Sync.diff(Sync.snapshot(store({ tasks: [task('t1')] })), Sync.snapshot(store({ tasks: [] })));
  assert.deepEqual(gone.tasks.deletes, ['t1']);
});

test('reorder shows as position updates on the moved rows', () => {
  const prev = Sync.snapshot(store({ projects: [project('p1'), project('p2')] }));
  const curr = Sync.snapshot(store({ projects: [project('p2'), project('p1')] }));
  const d = Sync.diff(prev, curr);
  assert.deepEqual(d.projects.updates.sort(), ['p1', 'p2']);
  assert.equal(d.projects.creates.length, 0);
});

test('label arrays compare as sets (reorder is not a change; membership is)', () => {
  const same = Sync.diff(
    Sync.snapshot(store({ tasks: [task('t1', { labels: ['a', 'b'] })] })),
    Sync.snapshot(store({ tasks: [task('t1', { labels: ['b', 'a'] })] })),
  );
  assert.deepEqual(same.tasks.updates, []); // same set, different order → no change

  const changed = Sync.diff(
    Sync.snapshot(store({ tasks: [task('t1', { labels: ['a', 'b'] })] })),
    Sync.snapshot(store({ tasks: [task('t1', { labels: ['a', 'c'] })] })),
  );
  assert.deepEqual(changed.tasks.updates, ['t1']);
});

test('project collapsed IS persisted (a change), other types unaffected', () => {
  const d = Sync.diff(
    Sync.snapshot(store({ projects: [project('p1', { collapsed: false })] })),
    Sync.snapshot(store({ projects: [project('p1', { collapsed: true })] })),
  );
  assert.deepEqual(d.projects.updates, ['p1']);
});

test('label rename + saved-query create', () => {
  const d = Sync.diff(
    Sync.snapshot(store({ labels: [label('l1', { name: 'old' })], savedQueries: [] })),
    Sync.snapshot(store({ labels: [label('l1', { name: 'new' })], savedQueries: [sv('v1')] })),
  );
  assert.deepEqual(d.labels.updates, ['l1']);
  assert.deepEqual(d.savedQueries.creates, ['v1']);
});
