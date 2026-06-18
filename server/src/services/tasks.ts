// services/tasks.ts — task CRUD + archive cascade. Operates by task id; the route
// is the access gate (accessLevel/denyStatus). complete(spawn)/assign live in
// services/recurrence.ts and the assign route.

import type { Kysely, Updateable } from 'kysely';
import type { DB, Database_, TasksTable } from '../db.js';
import { newId } from '../ids.js';
import { type TaskJson, rowToTask } from '../schemas.js';
import { checkIfMatch } from './concurrency.js';

type Trx = Kysely<Database_>;

export interface TaskCreateInput {
  title: string;
  projectId?: string | null;
  parentId?: string | null;
  due?: string | null;
  reminder?: string | null;
  recurrence?: string | null;
  notes?: string;
  priority?: number;
  size?: number;
  labels?: string[];
  assigneeId?: string | null;
}
export interface TaskPatch {
  title?: string;
  projectId?: string | null;
  parentId?: string | null;
  done?: boolean;
  due?: string | null;
  reminder?: string | null;
  recurrence?: string | null;
  notes?: string;
  priority?: number;
  size?: number;
  labels?: string[];
  assigneeId?: string | null;
}

// Replace a task's labels with the subset that actually belongs to `owner`.
async function setTaskLabels(
  trx: Trx,
  owner: string,
  taskId: string,
  labels: string[],
): Promise<void> {
  await trx.deleteFrom('task_labels').where('task_id', '=', taskId).execute();
  if (!labels.length) return;
  const owned = await trx
    .selectFrom('labels')
    .select('id')
    .where('owner_id', '=', owner)
    .where('id', 'in', labels)
    .execute();
  if (owned.length) {
    await trx
      .insertInto('task_labels')
      .values(owned.map((o) => ({ task_id: taskId, label_id: o.id })))
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
}

export async function loadTask(db: DB | Trx, id: string): Promise<TaskJson | null> {
  const row = await db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) return null;
  const labels = (
    await db
      .selectFrom('task_labels')
      .select('label_id')
      .where('task_id', '=', id)
      .orderBy('label_id')
      .execute()
  ).map((r) => r.label_id);
  return rowToTask(row, labels);
}

export const getTask = (db: DB, id: string): Promise<TaskJson | null> => loadTask(db, id);

export async function createTask(db: DB, owner: string, input: TaskCreateInput): Promise<TaskJson> {
  const id = newId();
  const now = new Date().toISOString();
  await db.transaction().execute(async (trx) => {
    const m = await trx
      .selectFrom('tasks')
      .select((eb) => eb.fn.max('position').as('m'))
      .where('owner_id', '=', owner)
      .executeTakeFirst();
    const position = Number(m?.m ?? 0) + 1;
    await trx
      .insertInto('tasks')
      .values({
        id,
        owner_id: owner,
        creator_id: owner,
        assignee_id: input.assigneeId ?? null,
        project_id: input.projectId ?? null,
        parent_id: input.parentId ?? null,
        title: input.title,
        done: 0,
        due: input.due ?? null,
        reminder: input.reminder ?? null,
        recurrence: input.recurrence ?? null,
        notes: input.notes ?? '',
        priority: input.priority ?? 0,
        size: input.size ?? 0,
        position,
        archived: 0,
        created_at: now,
        completed_at: null,
        updated_at: now,
      })
      .execute();
    if (input.labels?.length) await setTaskLabels(trx, owner, id, input.labels);
  });
  return (await loadTask(db, id))!;
}

// Throws PreconditionFailed on a stale If-Match. Returns null if the task is gone.
export async function updateTask(
  db: DB,
  id: string,
  patch: TaskPatch,
  ifMatch?: string,
): Promise<TaskJson | null> {
  return db.transaction().execute(async (trx) => {
    const row = await trx.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) return null;
    checkIfMatch(ifMatch, row.updated_at);

    const now = new Date().toISOString();
    const set: Updateable<TasksTable> = { updated_at: now };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.projectId !== undefined) set.project_id = patch.projectId;
    if (patch.parentId !== undefined) set.parent_id = patch.parentId;
    if (patch.done !== undefined) {
      set.done = patch.done ? 1 : 0;
      set.completed_at = patch.done ? (row.completed_at ?? now) : null;
    }
    if (patch.due !== undefined) set.due = patch.due;
    if (patch.reminder !== undefined) set.reminder = patch.reminder;
    if (patch.recurrence !== undefined) set.recurrence = patch.recurrence;
    if (patch.notes !== undefined) set.notes = patch.notes;
    if (patch.priority !== undefined) set.priority = patch.priority;
    if (patch.size !== undefined) set.size = patch.size;
    if (patch.assigneeId !== undefined) set.assignee_id = patch.assigneeId;

    await trx.updateTable('tasks').set(set).where('id', '=', id).execute();
    if (patch.labels !== undefined) await setTaskLabels(trx, row.owner_id, id, patch.labels);
    return loadTask(trx, id);
  });
}

// Set/clear the assignee. Returns 'badAssignee' if the user doesn't exist,
// null if the task is gone, else the updated task.
export async function assignTask(
  db: DB,
  id: string,
  assigneeId: string | null,
): Promise<TaskJson | null | 'badAssignee'> {
  if (assigneeId) {
    const u = await db
      .selectFrom('users')
      .select('id')
      .where('id', '=', assigneeId)
      .executeTakeFirst();
    if (!u) return 'badAssignee';
  }
  const row = await db.selectFrom('tasks').select('id').where('id', '=', id).executeTakeFirst();
  if (!row) return null;
  await db
    .updateTable('tasks')
    .set({ assignee_id: assigneeId, updated_at: new Date().toISOString() })
    .where('id', '=', id)
    .execute();
  return loadTask(db, id);
}

// Soft-delete a task and its whole subtask subtree (archived=1).
export async function archiveTask(db: DB, id: string): Promise<void> {
  const root = await db
    .selectFrom('tasks')
    .select('owner_id')
    .where('id', '=', id)
    .executeTakeFirst();
  if (!root) return;
  const all = await db
    .selectFrom('tasks')
    .select(['id', 'parent_id'])
    .where('owner_id', '=', root.owner_id)
    .execute();
  const ids = collectSubtree(id, all);
  await db
    .updateTable('tasks')
    .set({ archived: 1, updated_at: new Date().toISOString() })
    .where('id', 'in', ids)
    .execute();
}

export function collectSubtree(
  rootId: string,
  rows: { id: string; parent_id: string | null }[],
): string[] {
  const childMap = new Map<string, string[]>();
  for (const r of rows) {
    if (r.parent_id) {
      const a = childMap.get(r.parent_id) ?? [];
      a.push(r.id);
      childMap.set(r.parent_id, a);
    }
  }
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length) {
    const x = stack.pop()!;
    out.push(x);
    for (const c of childMap.get(x) ?? []) stack.push(c);
  }
  return out;
}
