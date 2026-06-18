'use strict';
/* Global-shim loader for the browser-global frontend engines.
   The files are IIFEs that assign to `window.X` (recurrence.js, query.js,
   data.js) or declare a top-level `var Vue` (vue.global.prod.js). We exec
   them in the current global context via vm.runInThisContext so:
     - `window.Rec = …`  lands on globalThis (window === globalThis)
     - bare `Rec` references inside query.js/data.js resolve to globalThis.Rec
     - `var Vue = …`     becomes a real global (require() would hide it)
   Zero changes to the committed frontend source.

   IMPORTANT: freeze the clock (support/clock.cjs) BEFORE calling these —
   data.js reads `new Date()` at load time. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FRONTEND = path.resolve(__dirname, '../../frontend/js');

function execFile(name) {
  const code = fs.readFileSync(path.join(FRONTEND, name), 'utf8');
  vm.runInThisContext(code, { filename: 'frontend/js/' + name });
}

function ensureWindow() {
  if (!globalThis.window) globalThis.window = globalThis;
}

// Tier 1 — pure engines only (no Vue, no DOM).
function loadEngines() {
  ensureWindow();
  execFile('recurrence.js'); // -> window.Rec
  execFile('query.js');      // -> window.Q (uses global Rec)
  return { Rec: globalThis.Rec, Q: globalThis.Q };
}

// Tier 2 — the reactive store and its smart rules.
function loadStore() {
  ensureWindow();
  execFile('vue.global.prod.js'); // -> global Vue (reactive is pure/Proxy, no DOM)
  execFile('recurrence.js');
  execFile('query.js');
  execFile('data.js');            // -> window.store; uses Vue/Rec/Q
  return {
    store: globalThis.store,
    Rec: globalThis.Rec,
    Q: globalThis.Q,
    Vue: globalThis.Vue,
  };
}

// Re-exec data.js to get a pristine store (seed data + uid counter reset to 100),
// so mutating tests start clean and generated ids stay deterministic. Engines/Vue
// stay loaded from the first loadStore() call.
function freshStore() {
  execFile('data.js');
  return globalThis.store;
}

module.exports = { loadEngines, loadStore, freshStore, execFile, FRONTEND };
