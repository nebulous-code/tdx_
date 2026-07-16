/* ============================================================
   glyphs.js  —  the canonical glyph set.  window.GLYPHS
   ------------------------------------------------------------
   THE SOURCE OF TRUTH for every glyph the app will store, on a
   project · calendar · folder · saved view.  The server keeps a
   twin (server/src/glyphs.ts) and VALIDATES against it — an
   off-list glyph is a 400 — and server/test/glyphs.test.ts reads
   THIS FILE and fails if the two ever drift.  Same idea as the
   parity-locked query engine (query.ts ≡ query.js).

   Why it exists: `glyph` used to be an unvalidated string, so the
   picker and the database quietly disagreed. The seeds shipped a
   ♥ nobody could select, and every system view (Today ☉, Open ○,
   Overdue !, …) wore an icon the picker never offered. The list
   below GREW to cover what the app actually ships, and is now
   closed: if it isn't here, it can't be saved.

   Adding one? Add it here, mirror it in server/src/glyphs.ts, and
   the parity test will tell you if you forgot.
   ============================================================ */
(function () {
  window.GLYPHS = [
    // the original picker set
    '❯', '◆', '▲', '●', '★', '■', '◈', '⌘', '⚙', '§',
    '¶', 'λ', 'Σ', '∆', '▒', '☰', '⎔', '⊞', '✦', '⛁',
    '♜', '⌬', '∴', '▚', '◇', '✧', '⊹', '⌗', '⟁', '❖',
    // shipped by the app but never selectable until now: the system
    // views' icons (Today · Open · Overdue · Recurring · No date ·
    // This month · Next month · Edited · To review) and ▸, the glyph
    // every folder adopted from the vault gets by default.
    '☉', '○', '!', '↻', '∅', '◫', '»', '✎', '◉', '▸',
  ];
})();
