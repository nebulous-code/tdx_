// services/calendars.ts — calendar CRUD (events' "category", like projects for tasks).
// Owner-only (mirrors events). Flat (no nesting). Archiving a calendar archives its
// events too (mirrors project→task archive cascade).

import type { Updateable } from 'kysely';
import type { CalendarsTable, DB } from '../db.js';
import { allocateReadableId, newId } from '../ids.js';
import { rowToCalendar } from '../schemas.js';
import { checkIfMatch } from './concurrency.js';

export interface CalendarCreateInput {
  id?: string;
  name: string;
  color?: string;
  glyph?: string;
  position?: number;
}
export interface CalendarPatch {
  name?: string;
  color?: string;
  glyph?: string;
  position?: number;
}

export async function getCalendar(db: DB, owner: string, id: string) {
  const row = await db
    .selectFrom('calendars')
    .selectAll()
    .where('id', '=', id)
    .where('owner_id', '=', owner)
    .executeTakeFirst();
  return row ? rowToCalendar(row) : null;
}

export async function createCalendar(db: DB, owner: string, input: CalendarCreateInput) {
  const id = input.id ?? newId();
  const now = new Date().toISOString();
  const m = await db
    .selectFrom('calendars')
    .select((eb) => eb.fn.max('position').as('m'))
    .where('owner_id', '=', owner)
    .executeTakeFirst();
  await db
    .insertInto('calendars')
    .values({
      id,
      owner_id: owner,
      name: input.name,
      color: input.color ?? '#ffb000',
      glyph: input.glyph ?? '●',
      position: input.position ?? Number(m?.m ?? 0) + 1,
      archived: 0,
      created_at: now,
      updated_at: now,
      readable_id: await allocateReadableId(db, owner, 'calendar'),
    })
    .execute();
  return (await getCalendar(db, owner, id))!;
}

export async function updateCalendar(
  db: DB,
  owner: string,
  id: string,
  patch: CalendarPatch,
  ifMatch?: string,
) {
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('calendars')
      .selectAll()
      .where('id', '=', id)
      .where('owner_id', '=', owner)
      .executeTakeFirst();
    if (!row) return null;
    checkIfMatch(ifMatch, row.updated_at);
    const set: Updateable<CalendarsTable> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.color !== undefined) set.color = patch.color;
    if (patch.glyph !== undefined) set.glyph = patch.glyph;
    if (patch.position !== undefined) set.position = patch.position;
    await trx
      .updateTable('calendars')
      .set(set)
      .where('id', '=', id)
      .where('owner_id', '=', owner)
      .execute();
    const fresh = await trx
      .selectFrom('calendars')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return rowToCalendar(fresh!);
  });
}

// Soft-delete a calendar and archive its events (mirror project→task cascade).
export async function archiveCalendar(db: DB, owner: string, id: string): Promise<void> {
  const now = new Date().toISOString();
  const cal = await db
    .selectFrom('calendars')
    .select('id')
    .where('id', '=', id)
    .where('owner_id', '=', owner)
    .executeTakeFirst();
  if (!cal) return;
  await db
    .updateTable('calendars')
    .set({ archived: 1, updated_at: now })
    .where('id', '=', id)
    .where('owner_id', '=', owner)
    .execute();
  await db
    .updateTable('events')
    .set({ archived: 1, updated_at: now })
    .where('owner_id', '=', owner)
    .where('calendar_id', '=', id)
    .execute();
}

// One-time idempotent backfill: every user gets a default "Calendar", and any event
// without a calendar is assigned to it. Run at boot (à la migrateVaultLayout).
export async function ensureDefaultCalendars(db: DB): Promise<void> {
  const users = await db.selectFrom('users').select('id').execute();
  const now = new Date().toISOString();
  for (const u of users) {
    let def = await db
      .selectFrom('calendars')
      .select('id')
      .where('owner_id', '=', u.id)
      .orderBy('position')
      .orderBy('id')
      .limit(1)
      .executeTakeFirst();
    if (!def) {
      const id = newId();
      await db
        .insertInto('calendars')
        .values({
          id,
          owner_id: u.id,
          name: 'Calendar',
          color: '#ffb000',
          glyph: '●',
          position: 0,
          archived: 0,
          created_at: now,
          updated_at: now,
          readable_id: await allocateReadableId(db, u.id, 'calendar'),
        })
        .execute();
      def = { id };
    }
    await db
      .updateTable('events')
      .set({ calendar_id: def.id })
      .where('owner_id', '=', u.id)
      .where('calendar_id', 'is', null)
      .execute();
  }
}
