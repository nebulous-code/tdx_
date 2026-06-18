'use strict';
/* Tier 1 — query engine (Q) golden-master tests. */
const { test } = require('node:test');
const { freezeClock } = require('./support/clock.cjs');
freezeClock();
const { loadEngines } = require('./support/load.cjs');
const { golden, loadFixture } = require('./support/golden.cjs');

const { Q } = loadEngines();
const tasks = loadFixture('corpus.tasks.json');
const projects = loadFixture('corpus.projects.json');
const labels = loadFixture('corpus.labels.json');
const { queries } = loadFixture('queries.json');
const ctx = { tasks, projects, labels, weekStart: 1 };

test('Q: parse + build round-trip', () => {
  const out = queries.map((q) => {
    const parsed = Q.parse(q);
    return { query: q, terms: parsed.terms, rebuilt: Q.build(parsed.terms) };
  });
  golden('query.parse', out);
});

test('Q: run over corpus -> matching ids', () => {
  const out = queries.map((q) => ({
    query: q,
    matches: Q.run(q, ctx).map((t) => t.id),
  }));
  golden('query.run', out);
});

test('Q: dueDelta + slug helpers', () => {
  golden('query.helpers', {
    dueDelta: tasks.map((t) => ({ id: t.id, due: t.due, delta: Q.dueDelta(t) })),
    slug: ['Work', 'My Project!', 'a-b-c', '  Spaces  ', 'ÜberCafé'].map((s) => ({ in: s, out: Q.slug(s) })),
  });
});
