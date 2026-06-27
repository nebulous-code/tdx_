// services/readableIds.ts — backfill readable ids for legacy rows (boot, idempotent)
// and resolve a readable id (own `t_0001` or cross-user `alice_t_0001`) back to its UUID.

import type { DB } from '../db.js';
import { type EntityKind, ID_PREFIX, allocateReadableId } from '../ids.js';

type EntityTable = 'tasks' | 'projects' | 'events' | 'notes' | 'calendars' | 'folders';
const KIND_TABLE: { kind: EntityKind; table: EntityTable }[] = [
  { kind: 'task', table: 'tasks' },
  { kind: 'project', table: 'projects' },
  { kind: 'event', table: 'events' },
  { kind: 'note', table: 'notes' },
  { kind: 'calendar', table: 'calendars' },
  { kind: 'folder', table: 'folders' },
];
const PREFIX_KIND: Record<string, { kind: EntityKind; table: EntityTable }> = Object.fromEntries(
  KIND_TABLE.map((e) => [ID_PREFIX[e.kind], e]),
);

// One-time, idempotent: assign a readable id to every row that lacks one (legacy rows from
// before the column existed), in created_at order so ids track creation. Run at boot.
export async function backfillReadableIds(db: DB): Promise<void> {
  for (const { kind, table } of KIND_TABLE) {
    const rows = await db
      .selectFrom(table)
      .select(['id', 'owner_id'])
      .where('readable_id', 'is', null)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    for (const r of rows) {
      const rid = await allocateReadableId(db, r.owner_id, kind);
      await db.updateTable(table).set({ readable_id: rid }).where('id', '=', r.id).execute();
    }
  }
}

export interface ResolvedReadable {
  kind: EntityKind;
  id: string; // the UUID
  ownerId: string;
}

// Resolve a readable id to its UUID. Bare (`t_0001`) → the given owner's item; username-
// prefixed (`alice_t_0001`) → that user's item. Parses from the RIGHT (the `_<prefix>_<digits>`
// suffix is the id; anything before is the username). Returns null if unknown / no such user.
export async function resolveReadable(
  db: DB,
  owner: string,
  token: string,
): Promise<ResolvedReadable | null> {
  const m = token.trim().match(/^(?:(.+)_)?([a-z])_(\d+)$/i);
  if (!m) return null;
  const [, username, letterRaw, digits] = m;
  const letter = letterRaw.toLowerCase();
  const ent = PREFIX_KIND[letter];
  if (!ent) return null;
  const readableId = `${letter}_${String(Number.parseInt(digits, 10)).padStart(4, '0')}`;

  let ownerId = owner;
  if (username) {
    const u = await db
      .selectFrom('users')
      .select('id')
      .where('username', '=', username) // column is COLLATE NOCASE
      .executeTakeFirst();
    if (!u) return null;
    ownerId = u.id;
  }
  const row = await db
    .selectFrom(ent.table)
    .select('id')
    .where('owner_id', '=', ownerId)
    .where('readable_id', '=', readableId)
    .executeTakeFirst();
  return row ? { kind: ent.kind, id: row.id, ownerId } : null;
}
