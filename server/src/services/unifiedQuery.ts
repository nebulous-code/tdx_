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
import { Rec } from '../rec.js';
import { type EventJson, type TaskJson, rowToEvent } from '../schemas.js';
import { readBootstrap } from './bootstrap.js';
import { type NoteForQuery, getNote, notesForQuery } from './notes.js';

export type EntityType = 'task' | 'event' | 'note';
const ENTITY_TYPES: readonly EntityType[] = ['task', 'event', 'note'];

// Thrown when a `type:`/`-type:` token isn't one of ENTITY_TYPES. The route turns
// this into a 400 with the message so the user sees their typo (e.g. `type:even`)
// rather than silently getting nothing — we never guess what they meant.
export class UnknownTypeError extends Error {
  constructor(public readonly tokens: string[]) {
    super(
      `unknown type ${tokens.length > 1 ? 'tokens' : 'token'}: ${tokens.join(', ')} — valid types are ${ENTITY_TYPES.join(', ')}`,
    );
    this.name = 'UnknownTypeError';
  }
}

export interface QueryItem {
  type: EntityType;
  [k: string]: unknown;
}

// Map an event occurrence onto Q's Task shape: free-text covers title+notes+location; date
// predicates (due:/status:) read the occurrence's date; recurring:true sees `recurrence`.
// A past occurrence reads as DONE (so status:done matches and status:overdue does not) — an
// event that already happened is complete, not overdue like a missed task.
function eventAsTask(
  e: EventJson,
  occDate: string,
  todayYMD: string,
  calName: string | null,
): Task {
  return {
    id: e.id,
    title: e.title,
    notes: `${e.notes} ${e.location ?? ''}`.trim(),
    due: occDate,
    reminder: e.reminder,
    recurrence: e.recurrence,
    done: occDate < todayYMD,
    labels: e.labels,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    kind: 'event',
    category: calName, // its calendar's name → category:/calendar: join key
  };
}
// Map a note: free-text covers title (filename) + body; `due:` reads the note's REVIEW date
// (the per-type due mapping); created:/edited: read the note's timestamps.
function noteAsTask(n: NoteForQuery, folderName: string | null): Task {
  return {
    id: n.id,
    title: n.title,
    notes: n.body,
    due: n.reviewAt ?? null,
    done: false,
    labels: [],
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    kind: 'note',
    category: folderName, // its folder's name → category:/folder: join key
  };
}

export async function runUnifiedQuery(
  db: DB,
  owner: string,
  weekStart: number,
  queryStr: string,
): Promise<QueryItem[]> {
  const parsed = Q.parse(queryStr);
  // Collect type selectors. `type:` includes, `-type:` excludes; every token must be a
  // known entity type (a typo errors out — we never fall back to a default that hides it).
  const positives = new Set<EntityType>();
  const negatives = new Set<EntityType>();
  const unknown: string[] = [];
  for (const t of parsed.terms.filter((t) => t.field === 'type')) {
    for (const tok of t.value.split(',').map((s) => s.trim())) {
      if (!tok) continue;
      if (!(ENTITY_TYPES as readonly string[]).includes(tok)) unknown.push(tok);
      else (t.neg ? negatives : positives).add(tok as EntityType);
    }
  }
  if (unknown.length) throw new UnknownTypeError([...new Set(unknown)]);
  // an explicit but empty `type:` (term present, no valid value, no exclusions) means "items
  // with no type" → nothing. We never silently fall back to a default that hides that intent.
  const hasPosTypeTerm = parsed.terms.some((t) => t.field === 'type' && !t.neg);
  if (hasPosTypeTerm && positives.size === 0 && negatives.size === 0) return [];
  // base set: explicit includes if any; else ALL types (no `type:` term → everything, never
  // a tasks-only fallback). Then drop excluded types (so `-type:note` alone = all but note).
  const base: EntityType[] = positives.size > 0 ? [...positives] : [...ENTITY_TYPES];
  const types = base.filter((t) => !negatives.has(t));
  // everything except the type selector is the actual predicate set, shared across types
  const pq = { terms: parsed.terms.filter((t) => t.field !== 'type'), ok: true };

  const { tasks, projects, labels, calendars, folders } = await readBootstrap(db, owner);
  const ctx = { tasks, projects, labels, weekStart } as unknown as Ctx;
  // categorizer-id → name maps for the cross-app category:/calendar:/folder: join
  const calName = new Map(calendars.map((c) => [c.id, c.name]));
  const folderName = new Map(folders.map((f) => [f.id, f.name]));
  const todayD = Rec.startOfDay(new Date());
  const todayYMD = Rec.ymd(todayD);
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
    // Recurring events are matched against their OCCURRENCES (not just the series start),
    // but only when the query carries a date predicate (`due:`) — otherwise the start-date
    // test is enough and we avoid pointless expansion. Each series yields at most ONE row,
    // dated to the soonest relevant occurrence (next upcoming, else most recent past), with
    // `count` = how many occurrences match inside the window. Open-ended date predicates
    // (e.g. due:set) are bounded to today ± 1 year.
    const hasDuePred = pq.terms.some((t) => t.field === 'due');
    const winFrom = Rec.addDays(todayD, -365);
    const winTo = Rec.addDays(todayD, 365);
    for (const row of rows) {
      const ev = rowToEvent(row);
      const cal = ev.calendarId ? (calName.get(ev.calendarId) ?? null) : null;
      const start = ev.startAt.slice(0, 10);
      const rule = ev.recurrence ? Rec.parse(ev.recurrence) : null;

      if (!hasDuePred || !rule || rule.type === 'invalid') {
        // non-recurring, or nothing date-sensitive to expand → test the start date once
        if (Q.evaluate(eventAsTask(ev, start, todayYMD, cal), pq, ctx))
          out.push({ type: 'event', date: start, count: 1, ...ev });
        continue;
      }
      // recurring + a due: predicate → walk the window, count matches, pick the display date
      const anchor = Rec.parseYMD(start) as Date;
      let count = 0;
      let nextFuture: string | null = null;
      let lastPast: string | null = null;
      for (let d = new Date(winFrom); d <= winTo; d = Rec.addDays(d, 1)) {
        const dymd = Rec.ymd(d);
        if (dymd < start) continue; // before the series began
        if (!Rec.matches(d, rule, anchor)) continue;
        if (!Q.evaluate(eventAsTask(ev, dymd, todayYMD, cal), pq, ctx)) continue;
        count++;
        if (dymd >= todayYMD) {
          if (nextFuture === null) nextFuture = dymd; // soonest upcoming match
        } else {
          lastPast = dymd; // most recent past match (fallback when nothing's upcoming)
        }
      }
      if (count > 0) out.push({ type: 'event', date: nextFuture ?? lastPast, count, ...ev });
    }
  }
  if (types.includes('note')) {
    // Evaluate against the FTS-indexed title+body (in memory); only hit disk for matches.
    for (const row of await notesForQuery(db, owner)) {
      const fn = row.folderId ? (folderName.get(row.folderId) ?? null) : null;
      if (!Q.evaluate(noteAsTask(row, fn), pq, ctx)) continue;
      const n = await getNote(db, owner, row.id); // full entity (path/frontmatter/timestamps)
      if (n) out.push({ type: 'note', ...n });
    }
  }
  return out;
}
