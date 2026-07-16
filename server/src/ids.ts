import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

// Global UUID id for every shareable resource (the canonical key + link target).
export const newId = (): string => randomUUID();

// ---- human-readable per-user ids (D2 2e §5) --------------------------------
// A display/authoring alias (t_0001, p_0002, …) per owner + type, monotonic, no reuse.
// The UUID stays canonical; this is what the user reads/types. Resolution is owner-scoped
// (and username-prefixed across users — see services/readableIds.ts).
export type EntityKind = 'task' | 'project' | 'event' | 'note' | 'calendar' | 'folder';
export const ID_PREFIX: Record<EntityKind, string> = {
  task: 't',
  project: 'p',
  event: 'e',
  note: 'n',
  calendar: 'c',
  folder: 'f',
};

// Allocate the next readable id for (owner, type). Read-modify-write on the single sqlite
// connection (serialized), so no explicit transaction is needed; safe to call inside one.
// 4 digits, widening automatically past 9999.
export async function allocateReadableId(db: DB, owner: string, type: EntityKind): Promise<string> {
  const row = await db
    .selectFrom('id_counters')
    .select('next_seq')
    .where('owner_id', '=', owner)
    .where('entity_type', '=', type)
    .executeTakeFirst();
  const seq = row?.next_seq ?? 1;
  await db
    .insertInto('id_counters')
    .values({ owner_id: owner, entity_type: type, next_seq: seq + 1 })
    .onConflict((oc) => oc.columns(['owner_id', 'entity_type']).doUpdateSet({ next_seq: seq + 1 }))
    .execute();
  return `${ID_PREFIX[type]}_${String(seq).padStart(4, '0')}`;
}
