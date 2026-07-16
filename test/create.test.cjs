'use strict';
/* Tier 1 — creation-language engine (CL) golden-master tests.

   The clock is frozen to 2026-06-18 (a THURSDAY) — every relative date below is
   anchored to it, which is exactly why CL.parse takes an injectable `today`
   instead of reading the clock at module load. */
const { test } = require('node:test');
const assert = require('node:assert');
const { freezeClock } = require('./support/clock.cjs');
freezeClock();
const { loadEngines, loadStore, freshStore } = require('./support/load.cjs');
const { golden, loadFixture } = require('./support/golden.cjs');

const { CL } = loadEngines();
const fx = loadFixture('creation.json');
const TODAY = new Date(2026, 5, 18);

// `/` is a token only when the category EXISTS (a label auto-creates; a project or
// folder cannot). The fixture supplies the world; the app supplies the store.
// CL.nameMatch is the query engine's own rule, so `/tdx` finds `tdx-app` exactly the
// way `project:tdx` does — typing a categorizer and querying one must agree.
const known = (kind, name) =>
  (fx.categories[kind] || []).some((n) => CL.nameMatch(n, name));

test('CL: parse — every phrase, every type', () => {
  const out = [];
  for (const type of fx.types) {
    for (const text of fx.phrases) {
      out.push({ type, text, ...CL.parse(text, { type, today: TODAY, known }) });
    }
  }
  golden('create.parse', out);
});

test('CL: apply — abstract fields land on each type’s own columns', () => {
  const cat = { project: 'p_', folder: 'f_', calendar: 'c_' };
  const ctx = (defaults) => ({
    defaults,
    addLabel: (name) => ({ id: 'l_' + CL.slug(name) }),
    findCategory: (kind, name) => ({ id: cat[kind] + CL.slug(name) }),
  });
  const out = fx.applyCases.map((c) => {
    const parsed = CL.parse(c.text, { type: c.type, today: TODAY, known });
    return {
      why: c.why,
      type: c.type,
      text: c.text,
      defaults: c.defaults,
      payload: CL.apply(c.type, parsed, ctx(c.defaults)),
    };
  });
  golden('create.apply', out);
});

// ---- the rules the goldens can't state out loud ---------------------------

test('CL: parse is PURE — a #label is NOT created during a parse', () => {
  // store.addLabel() CREATES the label it looks up (data.js), and ghost-completion
  // re-parses on every keystroke. If parse resolved labels, typing "#brandn" would
  // litter the label list with #b, #br, #bra… This is the whole reason apply() exists.
  loadStore();
  const store = freshStore();
  const before = store.labels.length;
  CL.parse('Ship it #brandnewlabel', { type: 'task', today: TODAY, known });
  assert.equal(store.labels.length, before, 'parse() must not create labels');
});

test('CL: a sigil a type does not accept is not a symbol there', () => {
  // "Ship v2 !!!" keeps its bangs on a NOTE, and !2 stays in the title — a note has
  // no priority field, so `!` is not a dead symbol there, it is not a symbol at all.
  const t = CL.parse('Ship v2 !2', { type: 'task', today: TODAY, known });
  const n = CL.parse('Ship v2 !2', { type: 'note', today: TODAY, known });
  assert.equal(t.fields.priority, 2);
  assert.equal(t.title, 'Ship v2');
  assert.equal(n.fields.priority, undefined);
  assert.equal(n.title, 'Ship v2 !2');
});

test('CL: $ opens a date only if what follows IS one (the $5 guard)', () => {
  const money = CL.parse('pay Bob $5', { type: 'task', today: TODAY, known });
  assert.equal(money.fields.date, undefined);
  assert.equal(money.title, 'pay Bob $5');
  const real = CL.parse('pay rent $tomorrow', { type: 'task', today: TODAY, known });
  assert.equal(real.fields.date, '2026-06-19');
  assert.equal(real.title, 'pay rent');
});

test('CL: dates — american first, the possible reading when only one is', () => {
  const d = (s) => CL.date(s, TODAY) && CL.date(s, TODAY).ymd;
  assert.equal(d('6/7/2026'), '2026-06-07', 'both readings possible -> month first');
  assert.equal(d('13/7/2026'), '2026-07-13', 'no 13th month -> day first is the only reading');
  assert.equal(d('2026-07-13'), '2026-07-13', 'ISO always wins');
  assert.equal(d('2/31/2026'), null, 'Feb 31 must not roll over into March');
  assert.equal(d('notaday'), null);
});

test('CL: weekdays — today is Thursday; "friday" is tomorrow, "next friday" is a week later', () => {
  const d = (s) => CL.date(s, TODAY).ymd;
  assert.equal(d('today'), '2026-06-18');
  assert.equal(d('tomorrow'), '2026-06-19');
  assert.equal(d('friday'), '2026-06-19');
  assert.equal(d('next friday'), '2026-06-26');
  // a weekday that IS today means the NEXT one — never zero days out
  assert.equal(d('thursday'), '2026-06-25');
});

test('CL: FIRST wins for a single-valued field; the second is literal', () => {
  // parseQuickAdd's `!` replace was non-GLOBAL, so the first !N won and later ones
  // stayed in the title. Keep that — and make it the rule for every single-valued
  // field, so a half-typed line stays predictable while you edit it.
  const p = CL.parse('Priority zero !0 and five !5', { type: 'task', today: TODAY, known });
  assert.equal(p.fields.priority, 0, 'first !N wins');
  assert.equal(p.title, 'Priority zero and five !5', 'the second stays in the title');

  const d = CL.parse('Ship $today then $friday', { type: 'task', today: TODAY, known });
  assert.equal(d.fields.date, '2026-06-18');
  assert.equal(d.title, 'Ship then $friday');
});

test('CL: /category matches like project: does (slug OR substring)', () => {
  // `project:tdx` finds `tdx-app` via catNameMatch's substring arm. Typing `/tdx` must
  // find the same project, or the creation and query languages disagree about a name.
  const p = CL.parse('Slug match /tdx', { type: 'task', today: TODAY, known });
  assert.equal(p.fields.category, 'tdx');
  assert.equal(p.title, 'Slug match');
  // and an unknown one is never silently eaten
  const u = CL.parse('Unknown /nosuchthing', { type: 'task', today: TODAY, known });
  assert.equal(u.fields.category, undefined);
  assert.equal(u.title, 'Unknown /nosuchthing');
});

test('CL: fragment — the trailing token, for ghost-completion', () => {
  assert.deepEqual(CL.fragment('Call mom #fu', 'task'), { sigil: '#', fragment: 'fu' });
  assert.deepEqual(CL.fragment('Call mom /ho', 'task'), { sigil: '/', fragment: 'ho' });
  assert.deepEqual(CL.fragment('Call mom', 'task'), null);
  // `!` is not a symbol on notes, so there is nothing to complete
  assert.deepEqual(CL.fragment('Ship it !', 'note'), null);
});
