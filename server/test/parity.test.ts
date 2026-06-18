// parity.test.ts — prove the TypeScript engine port reproduces the Phase 0
// goldens EXACTLY. It reuses the same fixtures (../../test/fixtures) and asserts
// against the same committed goldens (../../test/goldens) that the JS harness
// generated. Green = behavioral parity of Rec/Q in TypeScript.

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type Ctx, Q, type Task } from '../src/query.js';
import { Rec } from '../src/rec.js';
import { freezeClock } from './support/clock.js';

// Imports hoist; this runs before any test() callback executes, so the engines
// (which read the clock lazily) see the frozen 2026-06-18 baseline.
freezeClock();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_TEST = path.resolve(__dirname, '..', '..', 'test');

function loadFixture(name: string): any {
  return JSON.parse(fs.readFileSync(path.join(ROOT_TEST, 'fixtures', name), 'utf8'));
}
// Compare against the committed Phase 0 golden, serialized identically to
// golden.cjs (2-space JSON + trailing newline). Read-only: never writes.
function assertGolden(name: string, value: unknown): void {
  const file = path.join(ROOT_TEST, 'goldens', `${name}.json`);
  const expected = fs.readFileSync(file, 'utf8');
  const actual = `${JSON.stringify(value, null, 2)}\n`;
  assert.strictEqual(actual, expected, `TS port diverges from golden "${name}"`);
}

// ---- Rec (mirrors rec.test.cjs) -------------------------------------------
const recFx = loadFixture('recurrence.json');

test('parity Rec: parse / stringify / summary / compact per rule', () => {
  const out = recFx.rules.map((rule: string) => {
    const parsed = Rec.parse(rule);
    return {
      rule,
      parsed,
      stringify: Rec.stringify(parsed),
      summary: Rec.summary(parsed),
      compact: Rec.compact(parsed),
    };
  });
  assertGolden('rec.rules', out);
});

test('parity Rec: nextOccurrences / next with explicit from + anchor', () => {
  const out = recFx.occurrences.map((c: any) => {
    const occ = Rec.nextOccurrences(c.rule, {
      from: c.from,
      anchor: c.anchor,
      count: c.count,
      inclusive: c.inclusive,
    });
    const n = Rec.next(c.rule, c.from, c.anchor);
    return {
      rule: c.rule,
      from: c.from,
      anchor: c.anchor,
      count: c.count,
      inclusive: c.inclusive,
      occurrences: occ.map(Rec.ymd),
      next: n ? Rec.ymd(n) : null,
    };
  });
  assertGolden('rec.occurrences', out);
});

test('parity Rec: matches for specific dates', () => {
  const out = recFx.matches.map((c: any) => ({
    rule: c.rule,
    anchor: c.anchor,
    results: c.dates.map((dStr: string) => ({
      date: dStr,
      matches: Rec.matches(
        Rec.parseYMD(dStr) as Date,
        Rec.parse(c.rule) as NonNullable<ReturnType<typeof Rec.parse>>,
        Rec.parseYMD(c.anchor) as Date,
      ),
    })),
  }));
  assertGolden('rec.matches', out);
});

test('parity Rec: date helpers', () => {
  const h = recFx.dateHelpers;
  assertGolden('rec.dateHelpers', {
    ymd: h.ymd.map((s: string) => Rec.ymd(Rec.parseYMD(s) as Date)),
    addDays: h.addDays.map(([s, n]: [string, number]) =>
      Rec.ymd(Rec.addDays(Rec.parseYMD(s) as Date, n)),
    ),
    daysBetween: h.daysBetween.map(([a, b]: [string, string]) =>
      Rec.daysBetween(Rec.parseYMD(a) as Date, Rec.parseYMD(b) as Date),
    ),
    ordSuffix: h.ordSuffix.map((n: number) => n + Rec.ordSuffix(n)),
  });
});

// ---- Q (mirrors query.test.cjs) -------------------------------------------
const tasks = loadFixture('corpus.tasks.json') as Task[];
const projects = loadFixture('corpus.projects.json');
const labels = loadFixture('corpus.labels.json');
const queries = loadFixture('queries.json').queries as string[];
const ctx: Ctx = { tasks, projects, labels, weekStart: 1 };

test('parity Q: parse + build round-trip', () => {
  const out = queries.map((q) => {
    const parsed = Q.parse(q);
    return { query: q, terms: parsed.terms, rebuilt: Q.build(parsed.terms) };
  });
  assertGolden('query.parse', out);
});

test('parity Q: run over corpus -> matching ids', () => {
  const out = queries.map((q) => ({
    query: q,
    matches: Q.run(q, ctx).map((t) => t.id),
  }));
  assertGolden('query.run', out);
});

test('parity Q: dueDelta + slug helpers', () => {
  assertGolden('query.helpers', {
    dueDelta: tasks.map((t) => ({ id: t.id, due: t.due, delta: Q.dueDelta(t) })),
    slug: ['Work', 'My Project!', 'a-b-c', '  Spaces  ', 'ÜberCafé'].map((s) => ({
      in: s,
      out: Q.slug(s),
    })),
  });
});
