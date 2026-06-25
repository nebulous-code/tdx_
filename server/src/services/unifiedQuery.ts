// services/unifiedQuery.ts — the unified entity query (D2 2d slice 2). `POST /api/query`
// gains a `type:task,event,note` predicate that returns MIXED entities. We do NOT touch
// the parity-locked `Q` engine: instead we strip `type:` ourselves, then reuse `Q.evaluate`
// for every type by mapping events/notes onto Q's loose `Task` shape (title/notes/due/…).
// So all three honor the SAME free-text + date predicates, via the same engine, with zero
// parity risk. Tasks that don't apply (project:/label:) naturally exclude events/notes.
//
// Note: events are matched on their series start date (no occurrence expansion here — the
// calendar grid still uses GET /api/events for that), and we scan all events/notes in JS;
// pushing predicates down to SQL/FTS is a later optimization.

import type { DB } from '../db.js';
import { type Ctx, Q, type Task } from '../query.js';
import { type EventJson, type NoteJson, type TaskJson, rowToEvent } from '../schemas.js';
import { readBootstrap } from './bootstrap.js';
import { getNote } from './notes.js';

export type EntityType = 'task' | 'event' | 'note';
const ENTITY_TYPES: readonly EntityType[] = ['task', 'event', 'note'];

export interface QueryItem {
  type: EntityType;
  [k: string]: unknown;
}

// Map an event onto Q's Task shape: free-text covers title+notes+location; date predicates
// (due:/status:/before:/after:) read the series start date; recurring:true sees `recurrence`.
function eventAsTask(e: EventJson): Task {
  return {
    id: e.id,
    title: e.title,
    notes: `${e.notes} ${e.location ?? ''}`.trim(),
    due: e.startAt.slice(0, 10),
    reminder: e.reminder,
    recurrence: e.recurrence,
    done: false,
    labels: [],
  };
}
// Map a note: free-text covers title (filename) + body. No due/labels yet (labels land later).
function noteAsTask(n: NoteJson): Task {
  return { id: n.id, title: n.title, notes: n.body, due: null, done: false, labels: [] };
}

export async function runUnifiedQuery(
  db: DB,
  owner: string,
  weekStart: number,
  queryStr: string,
): Promise<QueryItem[]> {
  const parsed = Q.parse(queryStr);
  const typeTerm = parsed.terms.find((t) => t.field === 'type' && !t.neg);
  const types: EntityType[] = typeTerm
    ? typeTerm.value
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is EntityType => (ENTITY_TYPES as readonly string[]).includes(s))
    : ['task'];
  // everything except the type selector is the actual predicate set, shared across types
  const pq = { terms: parsed.terms.filter((t) => t.field !== 'type'), ok: true };

  const { tasks, projects, labels } = await readBootstrap(db, owner);
  const ctx = { tasks, projects, labels, weekStart } as unknown as Ctx;
  const out: QueryItem[] = [];

  if (types.includes('task')) {
    for (const t of Q.run(pq, ctx) as unknown as TaskJson[]) out.push({ type: 'task', ...t });
  }
  if (types.includes('event')) {
    const rows = await db
      .selectFrom('events')
      .selectAll()
      .where('owner_id', '=', owner)
      .where('archived', '=', 0)
      .execute();
    for (const row of rows) {
      const ev = rowToEvent(row);
      if (Q.evaluate(eventAsTask(ev), pq, ctx)) out.push({ type: 'event', ...ev });
    }
  }
  if (types.includes('note')) {
    const rows = await db
      .selectFrom('notes')
      .select('id')
      .where('owner_id', '=', owner)
      .where('tombstoned', '=', 0)
      .execute();
    for (const { id } of rows) {
      const n = await getNote(db, id);
      if (n && Q.evaluate(noteAsTask(n), pq, ctx)) out.push({ type: 'note', ...n });
    }
  }
  return out;
}
