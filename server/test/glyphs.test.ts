// The glyph list is PARITY-LOCKED to the frontend, the same way query.ts is locked to query.js.
// frontend/js/glyphs.js is the source of truth (it's what the picker renders); server/src/glyphs.ts
// exists so the server can REJECT a glyph the picker would never offer. If those two drift, the
// server starts refusing glyphs the UI happily shows — so this test loads the real frontend file
// and compares.

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { DEFAULT_GLYPH, GLYPHS, coerceGlyph, isGlyph } from '../src/glyphs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_GLYPHS = path.resolve(here, '../../frontend/js/glyphs.js');

// Run the real IIFE with a stub `window` — don't regex-scrape it; we want to fail if the file
// stops being loadable at all, not just if the characters move around.
function frontendGlyphs(): string[] {
  const code = fs.readFileSync(FRONTEND_GLYPHS, 'utf8');
  const sandbox: { window: { GLYPHS?: string[] } } = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: FRONTEND_GLYPHS });
  const g = sandbox.window.GLYPHS;
  assert.ok(Array.isArray(g), 'frontend/js/glyphs.js must assign window.GLYPHS');
  return g as string[];
}

test('glyphs: the server list is identical to the frontend picker (order included)', () => {
  assert.deepEqual([...GLYPHS], frontendGlyphs());
});

test('glyphs: no duplicates, and the picker is a tidy 40', () => {
  assert.equal(new Set(GLYPHS).size, GLYPHS.length, 'a duplicate glyph would waste a picker slot');
  assert.equal(GLYPHS.length, 40);
});

test('glyphs: every per-entity default is itself a legal glyph', () => {
  // otherwise a row created without a glyph would be born invalid — and 400 on its first edit
  for (const [entity, g] of Object.entries(DEFAULT_GLYPH)) {
    assert.ok(isGlyph(g), `${entity}'s default glyph ${g} is not in the list`);
  }
});

test('glyphs: everything the SEEDS write is legal', () => {
  // The whole point of a.9: the app must not be the first thing violating its own source of
  // truth. These are the glyphs seed.ts hands every new user — the Inbox project and the 13
  // system views. A ♥ or a ⌂ here is exactly the bug this feature exists to prevent.
  const seeded = ['❯', '☉', '○', '!', '☰', '↻', '∅', '◫', '»', '✎', '✦', '◉', '∅'];
  for (const g of seeded) assert.ok(isGlyph(g), `seeded glyph ${g} is not in the list`);
});

test('glyphs: isGlyph / coerceGlyph guard the paths that bypass request validation', () => {
  assert.ok(isGlyph('❯'));
  assert.ok(!isGlyph('♥'), 'the heart is gone');
  assert.ok(!isGlyph('⌂'), 'the old Inbox glyph is gone');
  assert.ok(!isGlyph(''));
  assert.ok(!isGlyph(undefined));
  // a legacy import, or a hand-edited .tdx-folder.json marker on the user's own filesystem
  assert.equal(coerceGlyph('♥', DEFAULT_GLYPH.folder), '▸');
  assert.equal(coerceGlyph('★', DEFAULT_GLYPH.folder), '★');
  assert.equal(coerceGlyph(undefined, DEFAULT_GLYPH.project), '●');
});
