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
  vm.runInThisContext(code, { filename: path.join(FRONTEND, name) });
}

function ensureWindow() {
  if (!globalThis.window) globalThis.window = globalThis;
}

// Tier 1 — pure engines only (no Vue, no DOM).
function loadEngines() {
  ensureWindow();
  execFile('recurrence.js'); // -> window.Rec
  execFile('query.js');      // -> window.Q (uses global Rec)
  execFile('create.js');     // -> window.CL (the creation language; pure, clock injected)
  return { Rec: globalThis.Rec, Q: globalThis.Q, CL: globalThis.CL };
}

// Tier 2 — the reactive store and its smart rules.
function loadStore() {
  ensureWindow();
  execFile('vue.global.prod.js'); // -> global Vue (reactive is pure/Proxy, no DOM)
  execFile('glyphs.js');          // -> window.GLYPHS (data.js reads it at load time)
  execFile('recurrence.js');
  execFile('query.js');
  execFile('create.js');          // -> window.CL (data.js's clCtx/clGhost need it)
  execFile('data.js');            // -> window.store; uses Vue/Rec/Q/CL/GLYPHS
  return {
    store: globalThis.store,
    Rec: globalThis.Rec,
    Q: globalThis.Q,
    CL: globalThis.CL,
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
