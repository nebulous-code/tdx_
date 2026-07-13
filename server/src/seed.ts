// seed.ts — user creation + per-user defaults. Replaces tools/add-user.js +
// db.seedUserDefaults. IDs are UUIDs now (the composite-PK reason for fixed
// `p_inbox`/`sv_*` ids is gone). First user (no users yet) defaults to admin.

import { hashPassword } from './auth.js';
import type { DB } from './db.js';
import { allocateReadableId, newId } from './ids.js';

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
      readable_id: await allocateReadableId(db, ownerId, 'project'),
    })
    .execute();

  // [name, glyph, query, position, pinned]. Every view carries an explicit `type:` so it's a
  // reasonable, unambiguous default + surfaces only under its app (the per-app nav filters by
  // type; a view with no type: is treated as Tasks-only). §2.4 seed views.
  const views: [string, string, string, number, number][] = [
    ['Today', '☉', 'type:task status:open due:today', 0, 0],
    ['Open', '○', 'type:task status:open', 1, 1],
    ['Overdue', '!', 'type:task status:overdue', 2, 1],
    ['This week', '☰', 'type:task status:open due:week', 3, 0],
    ['Recurring', '↻', 'type:task recurring:true status:open', 4, 0],
    ['No date', '∅', 'type:task due:none status:open', 5, 0],
    // Events (calendar-month/week keywords from the §3.3 date model)
    ['This week', '☰', 'type:event due:this-week', 6, 0],
    ['This month', '◫', 'type:event due:this-month', 7, 0],
    ['Next month', '»', 'type:event due:next-month', 8, 0],
    // Notes (created/edited + review date)
    ['Edited this week', '✎', 'type:note edited:>=-7d', 9, 0],
    ['Created this week', '✦', 'type:note created:>=-7d', 10, 0],
    ['To review', '◉', 'type:note due:today', 11, 0],
    ['Untagged', '∅', 'type:note has:no-labels', 12, 0],
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
        // 'auto' lets the app infer presentation (e.1): the events screen renders a
        // DATE-RANGE view as a list (a grid is already a date filter) and keeps the grid
        // otherwise. Toggle + `u` pins an explicit 'grid'/'list' on any view.
        display: 'auto',
      })
      .execute();
  }
}
