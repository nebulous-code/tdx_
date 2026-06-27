// services/recurrence.ts — completing a recurring task spawns the next occurrence
// (a fresh root clone + a fresh, unchecked clone of the whole subtask subtree).
// Faithful to frontend/js/data.js store.toggleDone + cloneSubtree + shiftReminder;
// behavior is characterized by test/goldens/store.spawn.json (validated in JS).

import type { Kysely } from 'kysely';
import type { DB, Database_, TasksTable } from '../db.js';
import { allocateReadableId, newId } from '../ids.js';
import { Rec } from '../rec.js';
import type { TaskJson } from '../schemas.js';
import { loadTask } from './tasks.js';

type Trx = Kysely<Database_>;

export interface SpawnResult {
  task: TaskJson;
  created: TaskJson[];
}

// reminder 'YYYY-MM-DDTHH:MM' — preserve its time-of-day and day-gap from the due
// date across the recurrence (ported verbatim).
function shiftReminder(reminder: string | null, due: string | null, nextDue: Date): string | null {
  if (!reminder || !due) return null;
  const remDate = reminder.slice(0, 10);
  const time = reminder.length > 10 ? reminder.slice(10) : '';
  const gap = Rec.daysBetween(Rec.parseYMD(due) as Date, Rec.parseYMD(remDate) as Date);
  return Rec.ymd(Rec.addDays(nextDue, gap)) + time;
}

// Insert a fresh clone of `src` (new id, done=0) under `parentId`, copying labels.
async function cloneTask(
  trx: Trx,
  src: TasksTable,
  parentId: string | null,
  due: string | null,
  reminder: string | null,
): Promise<string> {
  const id = newId();
  const now = new Date().toISOString();
  const m = await trx
    .selectFrom('tasks')
    .select((eb) => eb.fn.max('position').as('m'))
    .where('owner_id', '=', src.owner_id)
    .executeTakeFirst();
  await trx
    .insertInto('tasks')
    .values({
      id,
      owner_id: src.owner_id,
      creator_id: src.owner_id,
      assignee_id: src.assignee_id,
      project_id: src.project_id,
      parent_id: parentId,
      title: src.title,
      done: 0,
      due,
      reminder,
      recurrence: src.recurrence,
      notes: src.notes,
      priority: src.priority,
      size: src.size,
      position: Number(m?.m ?? 0) + 1,
      archived: 0,
      created_at: now,
      completed_at: null,
      updated_at: now,
      readable_id: await allocateReadableId(trx, src.owner_id, 'task'),
    })
    .execute();
  const labs = await trx
    .selectFrom('task_labels')
    .select('label_id')
    .where('task_id', '=', src.id)
    .execute();
  if (labs.length) {
    await trx
      .insertInto('task_labels')
      .values(labs.map((l) => ({ task_id: id, label_id: l.label_id })))
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
  return id;
}

// Recreate every descendant of origParentId under newParentId, reset to unchecked.
async function cloneSubtree(
  trx: Trx,
  owner: string,
  origParentId: string,
  newParentId: string,
  collected: string[],
): Promise<void> {
  const subs = await trx
    .selectFrom('tasks')
    .selectAll()
    .where('parent_id', '=', origParentId)
    .where('owner_id', '=', owner)
    .orderBy('position')
    .orderBy('id')
    .execute();
  for (const s of subs) {
    const childId = await cloneTask(trx, s, newParentId, s.due, s.reminder);
    collected.push(childId);
    await cloneSubtree(trx, owner, s.id, childId, collected);
  }
}

export async function completeTask(db: DB, id: string): Promise<SpawnResult | null> {
  return db.transaction().execute(async (trx) => {
    const t = await trx.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst();
    if (!t) return null;
    const now = new Date().toISOString();
    await trx
      .updateTable('tasks')
      .set({ done: 1, completed_at: now, updated_at: now })
      .where('id', '=', id)
      .execute();

    const created: string[] = [];
    if (t.recurrence) {
      const nxt = Rec.next(t.recurrence, t.due ?? Rec.ymd(new Date()), t.due ?? undefined);
      if (nxt) {
        const rootId = await cloneTask(
          trx,
          t,
          t.parent_id,
          Rec.ymd(nxt),
          shiftReminder(t.reminder, t.due, nxt),
        );
        created.push(rootId);
        await cloneSubtree(trx, t.owner_id, t.id, rootId, created);
      }
    }

    const task = (await loadTask(trx, id))!;
    const createdTasks: TaskJson[] = [];
    for (const cid of created) createdTasks.push((await loadTask(trx, cid))!);
    return { task, created: createdTasks };
  });
}
