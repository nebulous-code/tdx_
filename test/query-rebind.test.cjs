'use strict';
/* Rename-propagation tests (frontend/js/query-rebind.js). When an entity is renamed,
   the saved-query tokens that named it must follow — exact-slug only, and only when the
   old name is fully freed. Loaded via the window-shim harness (needs the global Q). */
const { test } = require('node:test');
const assert = require('node:assert');
const { freezeClock } = require('./support/clock.cjs');
freezeClock();
const { loadEngines } = require('./support/load.cjs');

const { QueryRebind: QR } = loadEngines();

function store(o = {}) {
  return {
    projects: o.projects || [],
    calendars: o.calendars || [],
    folders: o.folders || [],
    labels: o.labels || [],
    savedQueries: o.savedQueries || [],
  };
}

test('rebindQuery: an exact-slug project token follows a rename', () => {
  const s = store({ projects: [{ id: 'p1', name: 'Job Hunt' }] }); // already renamed in the store
  const renames = [{ kind: 'project', oldName: 'Work', newName: 'Job Hunt' }];
  assert.equal(QR.rebindQuery('status:open project:work', renames, s), 'status:open project:job_hunt');
});

test('rebindQuery: substring-only matches are left alone', () => {
  const s = store({ projects: [{ id: 'p1', name: 'Jobs' }] });
  const renames = [{ kind: 'project', oldName: 'Work', newName: 'Jobs' }];
  // "project:wor" matched "Work" by substring, not exact slug — must not be rewritten
  assert.equal(QR.rebindQuery('project:wor', renames, s), 'project:wor');
});

test('rebindQuery: fully-freed guard keeps a token that a same-named survivor still matches', () => {
  // two projects named "Work"; one renamed to "Job" — project:work still matches the other
  const s = store({ projects: [{ id: 'p1', name: 'Job' }, { id: 'p2', name: 'Work' }] });
  const renames = [{ kind: 'project', oldName: 'Work', newName: 'Job' }];
  assert.equal(QR.rebindQuery('project:work', renames, s), 'project:work');
});

test('rebindQuery: a project rename also follows category: when the name is freed everywhere', () => {
  const s = store({ projects: [{ id: 'p1', name: 'Gym Stuff' }], calendars: [], folders: [] });
  const renames = [{ kind: 'project', oldName: 'Gym', newName: 'Gym Stuff' }];
  assert.equal(QR.rebindQuery('category:gym', renames, s), 'category:gym_stuff');
});

test('rebindQuery: category: is NOT touched when another categorizer still holds the name', () => {
  // project "Gym" -> "Gym Stuff", but a calendar named "Gym" remains → category:gym still valid
  const s = store({ projects: [{ id: 'p1', name: 'Gym Stuff' }], calendars: [{ id: 'c1', name: 'Gym' }] });
  const renames = [{ kind: 'project', oldName: 'Gym', newName: 'Gym Stuff' }];
  assert.equal(QR.rebindQuery('category:gym', renames, s), 'category:gym');
});

test('rebindQuery: label rename follows; an unrelated query is a verbatim no-op', () => {
  const s = store({ labels: [{ id: 'l1', name: 'Priority' }] });
  const renames = [{ kind: 'label', oldName: 'urgent', newName: 'Priority' }];
  assert.equal(QR.rebindQuery('label:urgent status:open', renames, s), 'label:priority status:open');
  // nothing to rewrite -> the original string comes back untouched (no build() normalization)
  assert.equal(QR.rebindQuery('status:open due:today', renames, s), 'status:open due:today');
});

test('detectRenames: compares the prev snapshot to the live store', () => {
  const prev = {
    projects: { p1: { name: 'Work' } },
    calendars: {},
    folders: {},
    labels: { l1: { name: 'urgent' } },
  };
  const s = store({ projects: [{ id: 'p1', name: 'Job' }], labels: [{ id: 'l1', name: 'urgent' }] });
  assert.deepEqual(QR.detectRenames(prev, s), [{ kind: 'project', oldName: 'Work', newName: 'Job' }]);
});

test('reconcile: rewrites store.savedQueries in place and returns the count changed', () => {
  const prev = { projects: { p1: { name: 'Work' } }, calendars: {}, folders: {}, labels: {} };
  const s = store({
    projects: [{ id: 'p1', name: 'Job' }],
    savedQueries: [
      { id: 'v1', query: 'project:work status:open' },
      { id: 'v2', query: 'status:overdue' },
    ],
  });
  assert.equal(QR.reconcile(prev, s), 1);
  assert.equal(s.savedQueries[0].query, 'project:job status:open');
  assert.equal(s.savedQueries[1].query, 'status:overdue');
});
