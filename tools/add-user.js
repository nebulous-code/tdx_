#!/usr/bin/env node
// tools/add-user.js — create a tdx_ user. Run inside the container so it hits the
// live DB and bundled deps:
//
//   docker compose exec --workdir /app tdx node tools/add-user.js
//
// Prompts for username, email, and password (password hidden, never an argv).
// The FIRST user created adopts all pre-auth ('__unowned__') data; later users
// get a freshly seeded inbox + system views.

const crypto = require('crypto');
const readline = require('readline');
const db = require('../backend/src/db');
const {
  hashPassword,
  validateUsername,
  validateEmail,
  validatePassword,
} = require('../backend/src/auth');

// Interactive (TTY) prompts hide the password via a muted readline; piped/
// non-TTY input is buffered up front and shifted line-by-line (robust for scripts).
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

const OWNED_TABLES = ['projects', 'tasks', 'labels', 'task_labels', 'saved_queries'];

async function main() {
  if (!isTTY) lineQueue = await loadStdin();
  const u = validateUsername(await ask('username: '));
  if (!u.ok) throw new Error(u.error);
  const e = validateEmail(await ask('email: '));
  if (!e.ok) throw new Error(e.error);

  const p = validatePassword(await ask('password: ', { hidden: true }));
  if (!p.ok) throw new Error(p.error);
  const confirm = await ask('confirm password: ', { hidden: true });
  if (confirm !== p.value) throw new Error('passwords do not match');

  // Friendly uniqueness checks (the UNIQUE COLLATE NOCASE constraints back these up).
  if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(u.value)) {
    throw new Error(`username "${u.value}" is already taken`);
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(e.value)) {
    throw new Error(`email "${e.value}" is already in use`);
  }

  const id = 'u_' + crypto.randomBytes(6).toString('hex');
  const passwordHash = await hashPassword(p.value);
  const now = new Date().toISOString();
  const isFirstUser = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;

  const create = db.transaction(() => {
    // The first user is the instance admin (gates backups + future admin features).
    db.prepare(
      `INSERT INTO users (id, username, email, password_hash, state_version, is_admin, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
    ).run(id, u.value, e.value, passwordHash, isFirstUser ? 1 : 0, now, now);

    if (isFirstUser) {
      let adopted = 0;
      for (const t of OWNED_TABLES) {
        adopted += db.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id = '__unowned__'`).run(id).changes;
      }
      return { mode: 'adopted', rows: adopted };
    }
    db.seedUserDefaults(id);
    return { mode: 'seeded', rows: null };
  });

  const result = create();
  if (result.mode === 'adopted') {
    console.log(`✓ created first user "${u.value}" (${id}); adopted ${result.rows} pre-auth rows.`);
  } else {
    console.log(`✓ created user "${u.value}" (${id}); seeded a fresh inbox + system views.`);
  }
}

main()
  .then(() => { if (rl) rl.close(); process.exit(0); })
  .catch((err) => { if (rl) rl.close(); console.error('✗ ' + err.message); process.exit(1); });
