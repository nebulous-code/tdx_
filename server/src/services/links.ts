// services/links.ts — the generic entity-link graph (D2 §3). Rels are MECHANICAL
// pair-names: the rel is the alphabetical concept-pair (e.g. 'event-task'), one
// undirected edge per pair, stored CANONICALLY (alphabetically-first type is t1)
// so there's no (A,B)/(B,A) duplication. A tiny type registry resolves (type,id)
// → a display ref with scoped access. Reconcile-on-read: links whose far endpoint
// is archived/missing are hidden (archive is soft + reversible, so we don't delete
// the edge — getLinksFor just skips it, and it returns on unarchive).

import { accessLevel } from '../authz.js';
import type { DB } from '../db.js';
import { newId } from '../ids.js';

export type LinkType = 'event' | 'task';
export interface LinkEndpoint {
  type: LinkType;
  id: string;
}
export interface EntityRef {
  type: LinkType;
  id: string;
  title: string;
}
export interface LinkResolved {
  id: string;
  rel: string;
  other: EntityRef;
  createdAt: string;
}

// The "tiny type registry" (§3): which table backs each linkable concept. Adding
// `note` in 2c is one more entry here + its rels below. Both backing tables carry
// `title` + `archived`, which is all link resolution needs.
export const LINKABLE_TYPES: readonly LinkType[] = ['event', 'task'];
// Finite, mechanical rel set (alphabetical pair-names). 2c adds event-note, note-task.
const ALLOWED_RELS = new Set(['event-task']);

// Thrown when a pair has no valid rel (same-type, or a pair outside the taxonomy).
export class InvalidLink extends Error {}

// Canonical ordering: the alphabetically-first type is t1; rel = `${t1}-${t2}`.
function canonicalize(
  a: LinkEndpoint,
  b: LinkEndpoint,
): { t1: LinkEndpoint; t2: LinkEndpoint; rel: string } {
  const [t1, t2] = a.type <= b.type ? [a, b] : [b, a];
  const rel = `${t1.type}-${t2.type}`;
  if (!ALLOWED_RELS.has(rel)) throw new InvalidLink(`unsupported link: ${rel}`);
  return { t1, t2, rel };
}

// Backing-row fetch (title + archived), branched so Kysely stays fully typed.
function fetchRow(
  db: DB,
  type: LinkType,
  id: string,
): Promise<{ title: string; archived: number } | undefined> {
  return type === 'event'
    ? db.selectFrom('events').select(['title', 'archived']).where('id', '=', id).executeTakeFirst()
    : db.selectFrom('tasks').select(['title', 'archived']).where('id', '=', id).executeTakeFirst();
}

// Access-checked, archive-hiding resolution (used by getLinksFor's reconcile-on-read).
async function resolveEntity(
  db: DB,
  owner: string,
  type: LinkType,
  id: string,
): Promise<EntityRef | null> {
  if ((await accessLevel(db, { id: owner }, type, id)) === 'none') return null;
  const row = await fetchRow(db, type, id);
  if (!row || row.archived) return null;
  return { type, id, title: row.title };
}

// Create (or no-op if it already exists) a link between two entities. Access to
// both endpoints is enforced at the route; this canonicalizes + inserts idempotently
// and returns the edge resolved from `a`'s point of view (`other` = b).
export async function createLink(
  db: DB,
  owner: string,
  a: LinkEndpoint,
  b: LinkEndpoint,
  data?: unknown,
): Promise<LinkResolved> {
  const { t1, t2, rel } = canonicalize(a, b);
  const now = new Date().toISOString();
  await db
    .insertInto('links')
    .values({
      id: newId(),
      owner_id: owner,
      t1_type: t1.type,
      t1_id: t1.id,
      t2_type: t2.type,
      t2_id: t2.id,
      rel,
      data: data === undefined ? null : JSON.stringify(data),
      created_at: now,
    })
    .onConflict((oc) =>
      oc.columns(['owner_id', 't1_type', 't1_id', 't2_type', 't2_id']).doNothing(),
    )
    .execute();

  // re-read the canonical row (existing or just-inserted) for its id + created_at
  const row = await db
    .selectFrom('links')
    .selectAll()
    .where('owner_id', '=', owner)
    .where('t1_type', '=', t1.type)
    .where('t1_id', '=', t1.id)
    .where('t2_type', '=', t2.type)
    .where('t2_id', '=', t2.id)
    .executeTakeFirstOrThrow();

  const bRow = await fetchRow(db, b.type, b.id);
  const other: EntityRef = { type: b.type, id: b.id, title: bRow?.title ?? '' };
  return { id: row.id, rel: row.rel, other, createdAt: row.created_at };
}

export async function deleteLink(db: DB, owner: string, id: string): Promise<void> {
  await db.deleteFrom('links').where('id', '=', id).where('owner_id', '=', owner).execute();
}

// Every link touching (type,id), both directions, each resolved to its far side.
// Skips edges whose far endpoint is archived/missing (reconcile-on-read).
export async function getLinksFor(
  db: DB,
  owner: string,
  type: LinkType,
  id: string,
): Promise<LinkResolved[]> {
  const rows = await db
    .selectFrom('links')
    .selectAll()
    .where('owner_id', '=', owner)
    .where((eb) =>
      eb.or([
        eb.and([eb('t1_type', '=', type), eb('t1_id', '=', id)]),
        eb.and([eb('t2_type', '=', type), eb('t2_id', '=', id)]),
      ]),
    )
    .execute();

  const out: LinkResolved[] = [];
  for (const row of rows) {
    const isT1 = row.t1_type === type && row.t1_id === id;
    const otherType = (isT1 ? row.t2_type : row.t1_type) as LinkType;
    const otherId = isT1 ? row.t2_id : row.t1_id;
    const other = await resolveEntity(db, owner, otherType, otherId);
    if (!other) continue;
    out.push({ id: row.id, rel: row.rel, other, createdAt: row.created_at });
  }
  out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return out;
}

// Bulk-remove an entity's edges. Reserved for hard-delete / 2c note tombstones;
// intentionally NOT wired in 2b — archive is soft + reversible, so getLinksFor
// hides archived endpoints and the edges survive an unarchive.
export async function deleteLinksFor(
  db: DB,
  owner: string,
  type: LinkType,
  id: string,
): Promise<void> {
  await db
    .deleteFrom('links')
    .where('owner_id', '=', owner)
    .where((eb) =>
      eb.or([
        eb.and([eb('t1_type', '=', type), eb('t1_id', '=', id)]),
        eb.and([eb('t2_type', '=', type), eb('t2_id', '=', id)]),
      ]),
    )
    .execute();
}
