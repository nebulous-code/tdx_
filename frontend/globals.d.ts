// globals.d.ts — ambient types for the no-build globals.
//
// This app ships plain <script> files (no bundler/TypeScript build); shared modules
// hang themselves off `window` (window.Q, window.Rec, window.store, the window.*
// component registry, window.applyTheme, …) and are used bare across files. The
// editor's checkJs has no way to know those names exist, so it emits "Cannot find
// name 'Q'" / "Property 'store' does not exist on type 'Window'" noise.
//
// This file is TYPES-ONLY: it is never referenced by index.html and never loaded by
// the browser — it only teaches the editor about the globals. No runtime effect.

// Bare globals referenced without a `window.` prefix.
declare const Vue: any;   // vue.global.prod.js
declare const Q: any;     // query.js   → window.Q
declare const Rec: any;   // recurrence.js → window.Rec

// Everything else is assigned to / read from `window` (component registry, store,
// helpers). One index signature covers them all rather than listing each by hand.
interface Window {
  [key: string]: any;
}
