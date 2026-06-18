'use strict';
/* Deterministic clock for golden tests.
   The engines' only nondeterminism is `new Date()` / `Date.now()`:
     - query.js   today()            (line ~19)
     - recurrence.js nextOccurrences  (anchor/from defaults, ~206-207)
     - data.js    load-time todayD, toggleDone, viewDefaults, inferDueFromRecurrence
   We freeze the no-arg clock to a fixed instant and pin TZ so date math /
   formatting are identical on any machine or CI. Explicit-arg construction
   (new Date(y,m,d), new Date("..."), Date.UTC) is left untouched. */

process.env.TZ = 'UTC';

const RealDate = Date;
const FIXED_ISO = '2026-06-18'; // canonical "today" for the whole suite

function freezeClock(iso) {
  const fixedMs = new RealDate((iso || FIXED_ISO) + 'T00:00:00.000Z').getTime();
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixedMs);
      else super(...args);
    }
    static now() { return fixedMs; }
  }
  globalThis.Date = FrozenDate;
  return fixedMs;
}

function restoreClock() { globalThis.Date = RealDate; }

module.exports = { freezeClock, restoreClock, RealDate, FIXED_ISO };
