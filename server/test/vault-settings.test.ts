// vault-settings.test.ts — the ignore-rule parsing + the (advisory) gitignore-ish glob matcher.

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { globMatches, parseIgnoreRules, previewIgnore } from '../src/services/vault-settings.js';

const tmpDirs: string[] = [];
after(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

test('parseIgnoreRules: null / malformed → defaults', () => {
  assert.deepEqual(parseIgnoreRules(null), { globs: [], maxBytes: null });
  assert.deepEqual(parseIgnoreRules('not json'), { globs: [], maxBytes: null });
});

test('parseIgnoreRules: filters non-strings, floors positive maxBytes', () => {
  const r = parseIgnoreRules(JSON.stringify({ globs: ['a', '', 2, '  ', 'b/'], maxBytes: 1500.9 }));
  assert.deepEqual(r.globs, ['a', 'b/']);
  assert.equal(r.maxBytes, 1500);
});

test('parseIgnoreRules: zero/negative maxBytes → null', () => {
  assert.equal(parseIgnoreRules(JSON.stringify({ globs: [], maxBytes: 0 })).maxBytes, null);
  assert.equal(parseIgnoreRules(JSON.stringify({ globs: [], maxBytes: -5 })).maxBytes, null);
});

test('globMatches: bare pattern matches the basename anywhere', () => {
  assert.ok(globMatches('*.pdf', 'a/b/big.pdf'));
  assert.ok(globMatches('secret.md', 'notes/secret.md'));
  assert.ok(!globMatches('*.pdf', 'a/b/doc.md'));
});

test('globMatches: dir-only pattern matches files under it', () => {
  assert.ok(globMatches('scratch/', 'scratch/x.md')); // a file under the bare dir name
  assert.ok(globMatches('scratch/', 'a/scratch/deep.md')); // matches an ancestor segment anywhere
  assert.ok(globMatches('a/b/', 'a/b/deep/x.md')); // anchored dir with a slash
  assert.ok(globMatches('a/b/', 'a/b')); // exact dir-path match
  assert.ok(!globMatches('a/b/', 'a/c/x.md')); // anchored, non-matching
  assert.ok(!globMatches('scratch/', 'notes/keep.md'));
});

test('globMatches: anchored path pattern (with slash) matches from root', () => {
  assert.ok(globMatches('assets/*.png', 'assets/logo.png'));
  assert.ok(!globMatches('assets/*.png', 'other/logo.png'));
  assert.ok(globMatches('/top.md', 'top.md')); // leading slash anchors to root
});

test('globMatches: ** crosses separators; comments/empties never match', () => {
  assert.ok(globMatches('a/**/z.md', 'a/b/c/z.md'));
  assert.ok(!globMatches('# a comment', 'a comment'));
  assert.ok(!globMatches('   ', 'anything'));
});

test('previewIgnore: lists glob matches + oversize files across subdirs, skips the rest', () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'tdx-vault-'));
  tmpDirs.push(vault);
  process.env.VAULT_DIR = vault;
  fs.mkdirSync(path.join(vault, 'owner1', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'owner1', 'a.pdf'), 'x');
  fs.writeFileSync(path.join(vault, 'owner1', 'keep.md'), 'k');
  fs.writeFileSync(path.join(vault, 'owner1', 'big.md'), 'x'.repeat(50));
  fs.writeFileSync(path.join(vault, 'owner1', 'sub', 'c.pdf'), 'y');

  const res = previewIgnore('owner1', { globs: ['*.pdf'], maxBytes: 10 });
  assert.ok(res.paths.includes('a.pdf'));
  assert.ok(res.paths.includes(path.join('sub', 'c.pdf'))); // recurses into subdirs
  assert.ok(res.paths.includes('big.md')); // over the size cap
  assert.ok(!res.paths.includes('keep.md'));
  assert.equal(res.truncated, false);
});
