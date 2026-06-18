'use strict';
/* Golden-master helper. The CURRENT code generates the expected values;
   we record them as committed JSON and fail on any future drift. The same
   files become the parity target for the TypeScript port.

   golden(name, value):
     - first run, or UPDATE_GOLDENS=1 -> (re)write test/goldens/<name>.json
     - otherwise -> deep-compare the pretty-printed JSON, assert equality
   We compare serialized strings so key order and shape are pinned too. */

const fs = require('fs');
const path = require('path');
const assert = require('node:assert');

const GOLDEN_DIR = path.resolve(__dirname, '../goldens');
const UPDATE = process.env.UPDATE_GOLDENS === '1';

function golden(name, value) {
  const file = path.join(GOLDEN_DIR, name + '.json');
  const serialized = JSON.stringify(value, null, 2) + '\n';
  if (UPDATE || !fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serialized);
    return;
  }
  const expected = fs.readFileSync(file, 'utf8');
  assert.strictEqual(
    serialized,
    expected,
    `golden mismatch for "${name}" — run \`npm run test:update\` to refresh if this change is intended.`
  );
}

function loadFixture(name) {
  const file = path.resolve(__dirname, '../fixtures', name);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = { golden, loadFixture, GOLDEN_DIR, UPDATE };
