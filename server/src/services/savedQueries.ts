// services/savedQueries.ts — saved-query CRUD (no updated_at → unconditional).

import type { Updateable } from 'kysely';
import type { DB, SavedQueriesTable } from '../db.js';
import { newId } from '../ids.js';
import { rowToSavedQuery } from '../schemas.js';

// The per-app default ("smart") views. [name, glyph, query, position, pinned]. Every view
// carries an explicit `type:` so it surfaces only under its own app (a type-less view is
// treated as Tasks-only). Shared source of truth: seedUserDefaults gives new users all of
// them; ensureDefaultSavedQueries backfills the ones existing users are missing.
export const DEFAULT_VIEWS: [string, string, string, number, number][] = [
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

export type Display = 'auto' | 'grid' | 'list'; // how the view presents (e.1; migration 007)
export interface SavedQueryCreateInput {
  id?: string;
  name: string;
  query: string;
  glyph?: string;
  color?: string | null;
  pinned?: boolean;
  position?: number;
  display?: Display;
}
export interface SavedQueryPatch {
  name?: string;
  query?: string;
  glyph?: string;
  color?: string | null;
  pinned?: boolean;
  position?: number;
  display?: Display;
}

export async function getSavedQuery(db: DB, id: string) {
  const row = await db
    .selectFrom('saved_queries')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? rowToSavedQuery(row) : null;
}

export async function createSavedQuery(db: DB, owner: string, input: SavedQueryCreateInput) {
  const id = input.id ?? newId();
  const m = await db
    .selectFrom('saved_queries')
    .select((eb) => eb.fn.max('position').as('m'))
    .where('owner_id', '=', owner)
    .executeTakeFirst();
  await db
    .insertInto('saved_queries')
    .values({
      id,
      owner_id: owner,
      name: input.name,
      glyph: input.glyph ?? '◆',
      query: input.query,
      system: 0,
      color: input.color ?? null,
      position: input.position ?? Number(m?.m ?? 0) + 1,
      pinned: input.pinned ? 1 : 0,
      display: input.display ?? 'auto',
    })
    .execute();
  return (await getSavedQuery(db, id))!;
}

export async function updateSavedQuery(db: DB, id: string, patch: SavedQueryPatch) {
  const set: Updateable<SavedQueriesTable> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.query !== undefined) set.query = patch.query;
  if (patch.glyph !== undefined) set.glyph = patch.glyph;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.pinned !== undefined) set.pinned = patch.pinned ? 1 : 0;
  if (patch.position !== undefined) set.position = patch.position;
  if (patch.display !== undefined) set.display = patch.display;
  if (Object.keys(set).length)
    await db.updateTable('saved_queries').set(set).where('id', '=', id).execute();
  return getSavedQuery(db, id);
}

export async function deleteSavedQuery(db: DB, id: string): Promise<void> {
  await db.deleteFrom('saved_queries').where('id', '=', id).execute();
}

// One-time idempotent backfill (mirrors ensureDefaultCalendars): give every user the per-app
// default views they're missing. Scoped to the event + note apps on purpose — existing accounts
// already have task views, but their legacy ones predate the `type:` convention, so a `type:task`
// guard wouldn't see them and we'd duplicate. The guard is per-app "has no view of this type":
// a freshly-seeded user (already has them) is skipped, and nobody's customizations are touched.
// (Cost of the simple guard: a user who deleted every event/note default gets them back on boot.)
export async function ensureDefaultSavedQueries(db: DB): Promise<void> {
  const users = await db.selectFrom('users').select('id').execute();
  for (const u of users) {
    for (const kind of ['event', 'note'] as const) {
      const marker = `type:${kind}`;
      const has = await db
        .selectFrom('saved_queries')
        .select('id')
        .where('owner_id', '=', u.id)
        .where('query', 'like', `%${marker}%`)
        .limit(1)
        .executeTakeFirst();
      if (has) continue;
      const defaults = DEFAULT_VIEWS.filter(([, , query]) => query.includes(marker));
      // append after the user's existing views so positions never collide with theirs
      const top = await db
        .selectFrom('saved_queries')
        .select('position')
        .where('owner_id', '=', u.id)
        .orderBy('position', 'desc')
        .limit(1)
        .executeTakeFirst();
      let position = (top?.position ?? -1) + 1;
      for (const [name, glyph, query, , pinned] of defaults) {
        await db
          .insertInto('saved_queries')
          .values({
            id: newId(),
            owner_id: u.id,
            name,
            glyph,
            query,
            system: 1,
            color: null,
            position: position++,
            pinned,
            display: 'auto',
          })
          .execute();
      }
    }
  }
}
