// seed.ts — user creation + per-user defaults. Replaces tools/add-user.js +
// db.seedUserDefaults. IDs are UUIDs now (the composite-PK reason for fixed
// `p_inbox`/`sv_*` ids is gone). First user (no users yet) defaults to admin.

import { hashPassword } from './auth.js';
import type { DB } from './db.js';
import { allocateReadableId, newId } from './ids.js';
import { DEFAULT_VIEWS } from './services/savedQueries.js';

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
      notes_root_name: 'Inbox', // the vault's base directory shows as a folder by this name (n.16)
      calendars_all_name: 'Everything', // the "all calendars" nav row shows by this name (e.10)
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
      name: 'Inbox',
      color: '#ffb000',
      glyph: '❯', // a.9: ⌂ left the picker, so the app can't use it either
      collapsed: 0,
      position: 0,
      archived: 0,
      health: '[]',
      created_at: now,
      updated_at: now,
      readable_id: await allocateReadableId(db, ownerId, 'project'),
    })
    .execute();

  // §2.4 seed views — the shared per-app defaults (DEFAULT_VIEWS in services/savedQueries).
  for (const [name, glyph, query, position, pinned] of DEFAULT_VIEWS) {
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
        // 'auto' lets the app infer presentation (e.1): the events screen renders a
        // DATE-RANGE view as a list (a grid is already a date filter) and keeps the grid
        // otherwise. Toggle + `u` pins an explicit 'grid'/'list' on any view.
        display: 'auto',
      })
      .execute();
  }
}
