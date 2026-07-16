// glyphs.ts — the server's twin of frontend/js/glyphs.js.
//
// PARITY-LOCKED: test/glyphs.test.ts loads the frontend file and fails if these two arrays
// differ, the same way query.ts is locked to query.js. The frontend file is the source of
// truth (it's what the picker renders); this copy exists so the SERVER can reject a glyph the
// picker would never offer — `glyph` used to be an unvalidated string, which is how a ♥ that
// no user could select ended up on a seeded calendar.
//
// Adding a glyph? Add it to frontend/js/glyphs.js AND here. The parity test will tell you if
// you forgot.
export const GLYPHS = [
  // the original picker set
  '❯',
  '◆',
  '▲',
  '●',
  '★',
  '■',
  '◈',
  '⌘',
  '⚙',
  '§',
  '¶',
  'λ',
  'Σ',
  '∆',
  '▒',
  '☰',
  '⎔',
  '⊞',
  '✦',
  '⛁',
  '♜',
  '⌬',
  '∴',
  '▚',
  '◇',
  '✧',
  '⊹',
  '⌗',
  '⟁',
  '❖',
  // shipped by the app but never selectable until now: the system views' icons and ▸, the
  // glyph every folder adopted from the vault gets by default.
  '☉',
  '○',
  '!',
  '↻',
  '∅',
  '◫',
  '»',
  '✎',
  '◉',
  '▸',
] as const;

const SET: ReadonlySet<string> = new Set(GLYPHS);
export const isGlyph = (g: unknown): boolean => typeof g === 'string' && SET.has(g);

// Per-entity fallbacks — what a row gets when its glyph is missing or (for data that came from
// outside the schema: a legacy import, a hand-edited vault marker) not one of ours.
export const DEFAULT_GLYPH = {
  project: '●',
  calendar: '●',
  folder: '▸',
  savedQuery: '◆',
} as const;

// Coerce, don't trust — for the two paths that bypass request validation: the legacy importer
// and the vault scan, which reads .tdx-folder.json off the user's own filesystem.
export const coerceGlyph = (g: unknown, fallback: string): string =>
  isGlyph(g) ? (g as string) : fallback;
