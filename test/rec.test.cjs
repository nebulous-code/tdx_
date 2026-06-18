'use strict';
/* Tier 1 — recurrence engine (Rec) golden-master tests. */
const { test } = require('node:test');
const { freezeClock } = require('./support/clock.cjs');
freezeClock();
const { loadEngines } = require('./support/load.cjs');
const { golden, loadFixture } = require('./support/golden.cjs');

const { Rec } = loadEngines();
const fx = loadFixture('recurrence.json');

test('Rec: parse / stringify / summary / compact per rule', () => {
  const out = fx.rules.map((rule) => {
    const parsed = Rec.parse(rule);
    return {
      rule,
      parsed,
      stringify: Rec.stringify(parsed),
      summary: Rec.summary(parsed),
      compact: Rec.compact(parsed),
    };
  });
  golden('rec.rules', out);
});

test('Rec: nextOccurrences / next with explicit from + anchor', () => {
  const out = fx.occurrences.map((c) => {
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
  golden('rec.occurrences', out);
});

test('Rec: matches for specific dates', () => {
  const out = fx.matches.map((c) => ({
    rule: c.rule,
    anchor: c.anchor,
    results: c.dates.map((dStr) => ({
      date: dStr,
      matches: Rec.matches(Rec.parseYMD(dStr), Rec.parse(c.rule), Rec.parseYMD(c.anchor)),
    })),
  }));
  golden('rec.matches', out);
});

test('Rec: date helpers', () => {
  const h = fx.dateHelpers;
  golden('rec.dateHelpers', {
    ymd: h.ymd.map((s) => Rec.ymd(Rec.parseYMD(s))),
    addDays: h.addDays.map(([s, n]) => Rec.ymd(Rec.addDays(Rec.parseYMD(s), n))),
    daysBetween: h.daysBetween.map(([a, b]) => Rec.daysBetween(Rec.parseYMD(a), Rec.parseYMD(b))),
    ordSuffix: h.ordSuffix.map((n) => n + Rec.ordSuffix(n)),
  });
});
