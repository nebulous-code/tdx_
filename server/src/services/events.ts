// services/events.ts — event CRUD + the calendar's range read. Mirrors
// services/tasks.ts. Recurring events are NOT spawned; they're expanded
// virtually into occurrences within the queried window (via Rec).

import type { Updateable } from 'kysely';
import type { DB, EventsTable } from '../db.js';
import { newId } from '../ids.js';
import { Rec } from '../rec.js';
import { type EventJson, rowToEvent } from '../schemas.js';
import { checkIfMatch } from './concurrency.js';

export interface EventCreateInput {
  id?: string;
  title: string;
  notes?: string;
  location?: string | null;
  allDay?: boolean;
  startAt: string;
  endAt?: string | null;
  recurrence?: string | null;
  reminder?: string | null;
  assigneeId?: string | null;
  position?: number;
}
export interface EventPatch {
  title?: string;
  notes?: string;
  location?: string | null;
  allDay?: boolean;
  startAt?: string;
  endAt?: string | null;
  recurrence?: string | null;
  reminder?: string | null;
  assigneeId?: string | null;
  position?: number;
}
export interface EventOccurrence extends EventJson {
  date: string; // the concrete YYYY-MM-DD this occurrence falls on
}

export async function getEvent(db: DB, id: string): Promise<EventJson | null> {
  const row = await db.selectFrom('events').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? rowToEvent(row) : null;
}

export async function createEvent(
  db: DB,
  owner: string,
  input: EventCreateInput,
): Promise<EventJson> {
  const id = input.id ?? newId();
  const now = new Date().toISOString();
  const m = await db
    .selectFrom('events')
    .select((eb) => eb.fn.max('position').as('m'))
    .where('owner_id', '=', owner)
    .executeTakeFirst();
  await db
    .insertInto('events')
    .values({
      id,
      owner_id: owner,
      creator_id: owner,
      assignee_id: input.assigneeId ?? null,
      title: input.title,
      notes: input.notes ?? '',
      location: input.location ?? null,
      all_day: input.allDay ? 1 : 0,
      start_at: input.startAt,
      end_at: input.endAt ?? null,
      recurrence: input.recurrence ?? null,
      reminder: input.reminder ?? null,
      position: input.position ?? Number(m?.m ?? 0) + 1,
      archived: 0,
      created_at: now,
      updated_at: now,
    })
    .execute();
  return (await getEvent(db, id))!;
}

export async function updateEvent(
  db: DB,
  id: string,
  patch: EventPatch,
  ifMatch?: string,
): Promise<EventJson | null> {
  return db.transaction().execute(async (trx) => {
    const row = await trx.selectFrom('events').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) return null;
    checkIfMatch(ifMatch, row.updated_at);
    const set: Updateable<EventsTable> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.notes !== undefined) set.notes = patch.notes;
    if (patch.location !== undefined) set.location = patch.location;
    if (patch.allDay !== undefined) set.all_day = patch.allDay ? 1 : 0;
    if (patch.startAt !== undefined) set.start_at = patch.startAt;
    if (patch.endAt !== undefined) set.end_at = patch.endAt;
    if (patch.recurrence !== undefined) set.recurrence = patch.recurrence;
    if (patch.reminder !== undefined) set.reminder = patch.reminder;
    if (patch.assigneeId !== undefined) set.assignee_id = patch.assigneeId;
    if (patch.position !== undefined) set.position = patch.position;
    await trx.updateTable('events').set(set).where('id', '=', id).execute();
    const fresh = await trx
      .selectFrom('events')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return rowToEvent(fresh!);
  });
}

export async function archiveEvent(db: DB, id: string): Promise<void> {
  await db
    .updateTable('events')
    .set({ archived: 1, updated_at: new Date().toISOString() })
    .where('id', '=', id)
    .execute();
}

// The calendar's data source: every event occurrence whose date is in [from,to]
// (inclusive, YYYY-MM-DD). One-offs land on their own start date; recurring
// events are expanded across the window via Rec. Series id is preserved.
export async function eventsInRange(
  db: DB,
  owner: string,
  from: string,
  to: string,
): Promise<EventOccurrence[]> {
  const rows = await db
    .selectFrom('events')
    .selectAll()
    .where('owner_id', '=', owner)
    .where('archived', '=', 0)
    .execute();

  const out: EventOccurrence[] = [];
  const fromD = Rec.parseYMD(from) as Date;
  const toD = Rec.parseYMD(to) as Date;

  for (const row of rows) {
    const ev = rowToEvent(row);
    const startDate = ev.startAt.slice(0, 10); // YYYY-MM-DD
    const rule = ev.recurrence ? Rec.parse(ev.recurrence) : null;

    if (!rule || rule.type === 'invalid') {
      if (startDate >= from && startDate <= to) out.push({ ...ev, date: startDate });
      continue;
    }
    // expand: walk each day in the window, include matches on/after the series start
    const anchor = Rec.parseYMD(startDate) as Date;
    for (let d = new Date(fromD); d <= toD; d = Rec.addDays(d, 1)) {
      const dymd = Rec.ymd(d);
      if (dymd < startDate) continue; // before the event ever started
      if (Rec.matches(d, rule, anchor)) out.push({ ...ev, date: dymd });
    }
  }

  out.sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position);
  return out;
}
