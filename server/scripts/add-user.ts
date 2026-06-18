// add-user.ts — create a user from the CLI (replaces tools/add-user.js).
//   tsx scripts/add-user.ts <username> <email> <password> [--admin]
// The first user created is admin automatically; --admin forces it.

import { validateEmail, validatePassword, validateUsername } from '../src/auth.js';
import { openDatabase } from '../src/db.js';
import { createUser } from '../src/seed.js';

const [, , username, email, password, ...rest] = process.argv;
if (!username || !email || !password) {
  console.error('usage: tsx scripts/add-user.ts <username> <email> <password> [--admin]');
  process.exit(1);
}

const u = validateUsername(username);
const e = validateEmail(email);
const p = validatePassword(password);
for (const v of [u, e, p]) {
  if (!v.ok) {
    console.error(`invalid input: ${v.error}`);
    process.exit(1);
  }
}

const { db, sqlite } = openDatabase();
const opts = rest.includes('--admin') ? { isAdmin: true } : {};
try {
  const created = await createUser(db, { username, email, password }, opts);
  console.log(
    `[add-user] created ${created.username} <${created.email}> id=${created.id} admin=${!!created.is_admin}`,
  );
} catch (err) {
  if (/UNIQUE/.test((err as Error).message))
    console.error('[add-user] username or email already in use');
  else throw err;
  process.exitCode = 1;
} finally {
  sqlite.close();
}
