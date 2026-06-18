// services/labels.ts — label CRUD (no updated_at → unconditional writes),
// delete (strip from tasks, keep tasks), and merge (dedupe). Owner-only in D1.

import type { Updateable } from 'kysely';
import type { DB, LabelsTable } from '../db.js';
import { newId } from '../ids.js';
import { rowToLabel } from '../schemas.js';

export async function getLabel(db: DB, id: string) {
  const row = await db.selectFrom('labels').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? rowToLabel(row) : null;
}

export async function createLabel(
  db: DB,
  owner: string,
  input: { id?: string; name: string; pinned?: boolean },
) {
  const id = input.id ?? newId();
  await db
    .insertInto('labels')
    .values({ id, owner_id: owner, name: input.name, pinned: input.pinned ? 1 : 0 })
    .execute();
  return (await getLabel(db, id))!;
}

export async function updateLabel(db: DB, id: string, patch: { name?: string; pinned?: boolean }) {
  const set: Updateable<LabelsTable> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.pinned !== undefined) set.pinned = patch.pinned ? 1 : 0;
  if (Object.keys(set).length)
    await db.updateTable('labels').set(set).where('id', '=', id).execute();
  return getLabel(db, id);
}

// Strip the label from every task (tasks stay), then drop the label.
export async function deleteLabel(db: DB, id: string): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('task_labels').where('label_id', '=', id).execute();
    await trx.deleteFrom('labels').where('id', '=', id).execute();
  });
}

// Fold `fromId` into `toId`: re-point task_labels (deduped), then drop the source.
export async function mergeLabels(
  db: DB,
  owner: string,
  fromId: string,
  toId: string,
): Promise<boolean> {
  if (fromId === toId) return false;
  const both = await db
    .selectFrom('labels')
    .select('id')
    .where('owner_id', '=', owner)
    .where('id', 'in', [fromId, toId])
    .execute();
  if (both.length !== 2) return false; // both must belong to the owner
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('task_labels')
      .columns(['task_id', 'label_id'])
      .expression((eb) =>
        eb
          .selectFrom('task_labels')
          .select(['task_id', eb.val(toId).as('label_id')])
          .where('label_id', '=', fromId),
      )
      .onConflict((oc) => oc.doNothing())
      .execute();
    await trx.deleteFrom('task_labels').where('label_id', '=', fromId).execute();
    await trx.deleteFrom('labels').where('id', '=', fromId).execute();
  });
  return true;
}
