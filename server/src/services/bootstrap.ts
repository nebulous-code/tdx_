// bootstrap.ts — the per-owner read of all live (non-archived) entities the SPA
// needs to render. The legacy readState shape, minus version/seq, per-owner.

import type { DB } from '../db.js';
import { type TaskJson, rowToLabel, rowToProject, rowToSavedQuery, rowToTask } from '../schemas.js';

export interface Bootstrap {
  projects: ReturnType<typeof rowToProject>[];
  tasks: TaskJson[];
  labels: ReturnType<typeof rowToLabel>[];
  savedQueries: ReturnType<typeof rowToSavedQuery>[];
}

export async function readBootstrap(db: DB, ownerId: string): Promise<Bootstrap> {
  const projects = await db
    .selectFrom('projects')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .where('archived', '=', 0)
    .orderBy('position')
    .orderBy('id')
    .execute();
  const tasks = await db
    .selectFrom('tasks')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .where('archived', '=', 0)
    .orderBy('position')
    .orderBy('id')
    .execute();
  const labels = await db
    .selectFrom('labels')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .orderBy('name')
    .orderBy('id')
    .execute();
  const savedQueries = await db
    .selectFrom('saved_queries')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .orderBy('position')
    .orderBy('id')
    .execute();

  // labels per (non-archived) task, in a single pass; deterministic by label_id
  const tls = await db
    .selectFrom('task_labels')
    .innerJoin('tasks', 'tasks.id', 'task_labels.task_id')
    .select(['task_labels.task_id', 'task_labels.label_id'])
    .where('tasks.owner_id', '=', ownerId)
    .where('tasks.archived', '=', 0)
    .orderBy('task_labels.label_id')
    .execute();
  const byTask = new Map<string, string[]>();
  for (const tl of tls) {
    const a = byTask.get(tl.task_id) ?? [];
    a.push(tl.label_id);
    byTask.set(tl.task_id, a);
  }

  return {
    projects: projects.map(rowToProject),
    tasks: tasks.map((t) => rowToTask(t, byTask.get(t.id) ?? [])),
    labels: labels.map(rowToLabel),
    savedQueries: savedQueries.map(rowToSavedQuery),
  };
}
