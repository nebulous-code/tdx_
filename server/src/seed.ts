// seed.ts — user creation + per-user defaults. Replaces tools/add-user.js +
// db.seedUserDefaults. IDs are UUIDs now (the composite-PK reason for fixed
// `p_inbox`/`sv_*` ids is gone). First user (no users yet) defaults to admin.

import { hashPassword } from './auth.js';
import type { DB } from './db.js';
import { newId } from './ids.js';

export interface NewUserInput {
  username: string;
  email: string;
  password: string;
}
export interface CreatedUser {
  id: string;
  username: string;
  email: string;
  is_admin: number;
}

export async function createUser(
  db: DB,
  input: NewUserInput,
  opts: { isAdmin?: boolean } = {},
): Promise<CreatedUser> {
  const now = new Date().toISOString();
  const existing = await db.selectFrom('users').select('id').limit(1).executeTakeFirst();
  const isAdmin = opts.isAdmin ?? !existing; // first user is admin
  const id = newId();
  const password_hash = await hashPassword(input.password);
  await db
    .insertInto('users')
    .values({
      id,
      username: input.username,
      email: input.email,
      password_hash,
      theme: null,
      week_start: 1,
      sort_prefs: null,
      fib_sizing: 0,
      is_admin: isAdmin ? 1 : 0,
      created_at: now,
      updated_at: now,
    })
    .execute();
  await seedUserDefaults(db, id);
  return { id, username: input.username, email: input.email, is_admin: isAdmin ? 1 : 0 };
}

// inbox project + the 6 built-in system smart-views (same glyphs/queries/order as
// legacy db.seedUserDefaults).
export async function seedUserDefaults(db: DB, ownerId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insertInto('projects')
    .values({
      id: newId(),
      owner_id: ownerId,
      parent_id: null,
      name: 'inbox',
      color: '#ffb000',
      glyph: '⌂',
      collapsed: 0,
      position: 0,
      archived: 0,
      health: '[]',
      created_at: now,
      updated_at: now,
    })
    .execute();

  const views: [string, string, string, number, number][] = [
    ['Today', '☉', 'status:open due:today', 0, 0],
    ['Open', '○', 'status:open', 1, 1],
    ['Overdue', '!', 'status:overdue', 2, 1],
    ['This week', '☰', 'status:open due:week', 3, 0],
    ['Recurring', '↻', 'recurring:true status:open', 4, 0],
    ['No date', '∅', 'due:none status:open', 5, 0],
  ];
  for (const [name, glyph, query, position, pinned] of views) {
    await db
      .insertInto('saved_queries')
      .values({
        id: newId(),
        owner_id: ownerId,
        name,
        glyph,
        query,
        system: 1,
        color: null,
        position,
        pinned,
      })
      .execute();
  }
}
