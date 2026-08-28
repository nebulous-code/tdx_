// markdown.test.ts — setFrontmatterId (used by restore): replace-or-insert the managed
// id so a restored version can't fork a duplicate note or grow a second `id:` line.

import assert from 'node:assert';
import { test } from 'node:test';
import { setFrontmatterId } from '../src/services/markdown.js';

test('setFrontmatterId: inserts into frontmatter that lacks an id', () => {
  const out = setFrontmatterId('---\ntitle: x\n---\n\nbody\n', 'n_1');
  assert.match(out, /^---\nid: n_1\ntitle: x\n---/);
  assert.equal((out.match(/^id:/gm) ?? []).length, 1);
});

test('setFrontmatterId: replaces an existing id (no duplicate line)', () => {
  const out = setFrontmatterId('---\nid: old\ntitle: x\n---\n\nbody\n', 'newid');
  assert.ok(out.includes('id: newid'));
  assert.ok(!out.includes('id: old'));
  assert.equal((out.match(/^id:/gm) ?? []).length, 1);
  assert.ok(out.includes('title: x')); // other frontmatter preserved
  assert.ok(out.endsWith('body\n')); // body preserved
});

test('setFrontmatterId: adds a frontmatter block when there is none', () => {
  const out = setFrontmatterId('just body\n', 'n_1');
  assert.match(out, /^---\nid: n_1\n---\n\njust body/);
});
