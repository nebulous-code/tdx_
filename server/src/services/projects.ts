// services/projects.ts — project CRUD + archive cascade (subprojects + their tasks).

import type { Updateable } from 'kysely';
import type { DB, ProjectsTable } from '../db.js';
import { allocateReadableId, newId } from '../ids.js';
import { rowToProject } from '../schemas.js';
import { checkIfMatch } from './concurrency.js';
import { collectSubtree } from './tasks.js';

export interface ProjectCreateInput {
  id?: string;
  name: string;
  parentId?: string | null;
  color?: string;
  glyph?: string;
  collapsed?: boolean;
  health?: string[];
  position?: number;
}
export interface ProjectPatch {
  name?: string;
  parentId?: string | null;
  color?: string;
  glyph?: string;
  collapsed?: boolean;
  position?: number;
  health?: string[];
}

export async function getProject(db: DB, id: string) {
  const row = await db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? rowToProject(row) : null;
}

export async function createProject(db: DB, owner: string, input: ProjectCreateInput) {
  const id = input.id ?? newId();
  const now = new Date().toISOString();
  const m = await db
    .selectFrom('projects')
    .select((eb) => eb.fn.max('position').as('m'))
    .where('owner_id', '=', owner)
    .executeTakeFirst();
  await db
    .insertInto('projects')
    .values({
      id,
      owner_id: owner,
      parent_id: input.parentId ?? null,
      name: input.name,
      color: input.color ?? '#ffb000',
      glyph: input.glyph ?? '●',
      collapsed: input.collapsed ? 1 : 0,
      position: input.position ?? Number(m?.m ?? 0) + 1,
      archived: 0,
      health: JSON.stringify(input.health ?? []),
      created_at: now,
      updated_at: now,
      readable_id: await allocateReadableId(db, owner, 'project'),
    })
    .execute();
  return (await getProject(db, id))!;
}

export async function updateProject(db: DB, id: string, patch: ProjectPatch, ifMatch?: string) {
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('projects')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return null;
    checkIfMatch(ifMatch, row.updated_at);
    const set: Updateable<ProjectsTable> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.parentId !== undefined) set.parent_id = patch.parentId;
    if (patch.color !== undefined) set.color = patch.color;
    if (patch.glyph !== undefined) set.glyph = patch.glyph;
    if (patch.collapsed !== undefined) set.collapsed = patch.collapsed ? 1 : 0;
    if (patch.position !== undefined) set.position = patch.position;
    if (patch.health !== undefined) set.health = JSON.stringify(patch.health);
    await trx.updateTable('projects').set(set).where('id', '=', id).execute();
    const fresh = await trx
      .selectFrom('projects')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return rowToProject(fresh!);
  });
}

// Soft-delete a project, its subproject subtree, and all of their tasks.
export async function archiveProject(db: DB, id: string): Promise<void> {
  const root = await db
    .selectFrom('projects')
    .select('owner_id')
    .where('id', '=', id)
    .executeTakeFirst();
  if (!root) return;
  const all = await db
    .selectFrom('projects')
    .select(['id', 'parent_id'])
    .where('owner_id', '=', root.owner_id)
    .execute();
  const projIds = collectSubtree(id, all);
  const now = new Date().toISOString();
  await db
    .updateTable('projects')
    .set({ archived: 1, updated_at: now })
    .where('id', 'in', projIds)
    .execute();
  await db
    .updateTable('tasks')
    .set({ archived: 1, updated_at: now })
    .where('owner_id', '=', root.owner_id)
    .where('project_id', 'in', projIds)
    .execute();
}
