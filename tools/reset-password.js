#!/usr/bin/env node
// tools/reset-password.js — set a new password for an existing tdx_ user. Run:
//
//   docker compose exec --workdir /app tdx node tools/reset-password.js
//
// Prompts for the username, then a new password (hidden). If the user doesn't
// exist it says so and exits. The new password must differ from the current one,
// and all of that user's sessions are revoked.

const readline = require('readline');
const db = require('../backend/src/db');
const { hashPassword, verifyPassword, validatePassword } = require('../backend/src/auth');

const isTTY = !!process.stdin.isTTY;
let rl = null, muted = false, lineQueue = null;
if (isTTY) {
  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (str) => { if (!muted) rl.output.write(str); };
}
function loadStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { buf += d; });
    process.stdin.on('end', () => resolve(buf.split(/\r?\n/)));
  });
}
function ask(query, { hidden = false } = {}) {
  if (!isTTY) {
    process.stdout.write(query + '\n');
    return Promise.resolve(lineQueue && lineQueue.length ? lineQueue.shift() : '');
  }
  return new Promise((resolve) => {
    if (hidden) { process.stdout.write(query); muted = true; }
    rl.question(hidden ? '' : query, (answer) => {
      if (hidden) { muted = false; process.stdout.write('\n'); }
      resolve(answer);
    });
  });
}

async function main() {
  if (!isTTY) lineQueue = await loadStdin();
  const username = (await ask('username: ')).trim();
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!user) {
    console.error(`✗ no user named "${username}"`);
    if (rl) rl.close();
    process.exit(1);
  }

  const p = validatePassword(await ask('new password: ', { hidden: true }));
  if (!p.ok) throw new Error(p.error);
  const confirm = await ask('confirm new password: ', { hidden: true });
  if (confirm !== p.value) throw new Error('passwords do not match');

  if (await verifyPassword(user.password_hash, p.value)) {
    throw new Error('new password must differ from the current one');
  }

  const passwordHash = await hashPassword(p.value);
  const now = new Date().toISOString();
  const apply = db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, user.id);
    return db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id).changes;
  });
  const revoked = apply();
  console.log(`✓ password updated for "${user.username}"; revoked ${revoked} active session(s).`);
}

main()
  .then(() => { if (rl) rl.close(); process.exit(0); })
  .catch((err) => { if (rl) rl.close(); console.error('✗ ' + err.message); process.exit(1); });
