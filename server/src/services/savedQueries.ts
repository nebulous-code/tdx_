// services/savedQueries.ts — saved-query CRUD (no updated_at → unconditional).

import type { Updateable } from 'kysely';
import type { DB, SavedQueriesTable } from '../db.js';
import { newId } from '../ids.js';
import { rowToSavedQuery } from '../schemas.js';

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
