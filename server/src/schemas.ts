// schemas.ts — the single source of entity JSON shapes (TypeBox, reused for
// request/response validation + OpenAPI) and the row⇄JSON mappers. This is the
// ONE place SQLite 0/1 ints become booleans and JSON-TEXT columns are parsed,
// so a raw int / unparsed JSON never leaks to a client.

import { Type } from '@fastify/type-provider-typebox';
import type {
  CalendarsTable,
  EventsTable,
  FoldersTable,
  LabelsTable,
  NotesTable,
  ProjectsTable,
  SavedQueriesTable,
  TasksTable,
} from './db.js';

const Nullable = <T extends ReturnType<typeof Type.Unsafe>>(t: T) => Type.Union([t, Type.Null()]);
const NStr = () => Nullable(Type.String());

// defensive parse of the projects.health JSON-TEXT column → string[] (legacy parseHealth)
export function parseHealth(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// ---- entity JSON schemas ---------------------------------------------------
export const TaskSchema = Type.Object({
  id: Type.String(),
  projectId: NStr(),
  parentId: NStr(),
  title: Type.String(),
  done: Type.Boolean(),
  due: NStr(),
  reminder: NStr(),
  labels: Type.Array(Type.String()),
  recurrence: NStr(),
  notes: Type.String(),
  priority: Type.Integer(),
  size: Type.Integer(),
  assigneeId: NStr(),
  createdAt: Type.String(),
  completedAt: NStr(),
  updatedAt: Type.String(),
  readableId: NStr(),
});
export const ProjectSchema = Type.Object({
  id: Type.String(),
  parentId: NStr(),
  name: Type.String(),
  color: Type.String(),
  glyph: Type.String(),
  collapsed: Type.Boolean(),
  position: Type.Integer(),
  health: Type.Array(Type.String()),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  readableId: NStr(),
});
export const CalendarSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  color: Type.String(),
  glyph: Type.String(),
  position: Type.Integer(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  readableId: NStr(),
});
export const FolderSchema = Type.Object({
  id: Type.String(),
  parentId: NStr(),
  name: Type.String(),
  path: Type.String(),
  color: Type.String(),
  glyph: Type.String(),
  collapsed: Type.Boolean(),
  position: Type.Integer(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  readableId: NStr(),
});
export const LabelSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  pinned: Type.Boolean(),
});
export const SavedQuerySchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  glyph: Type.String(),
  query: Type.String(),
  system: Type.Boolean(),
  color: NStr(),
  position: Type.Integer(),
  pinned: Type.Boolean(),
});

// ---- create / update request schemas --------------------------------------
// `id` (client-generated UUID) and `position` are accepted on create so the
// diff-sync frontend stays authoritative over ids and ordering.
export const TaskCreateSchema = Type.Object({
  id: Type.Optional(Type.String()),
  title: Type.String(),
  projectId: Type.Optional(NStr()),
  parentId: Type.Optional(NStr()),
  done: Type.Optional(Type.Boolean()),
  due: Type.Optional(NStr()),
  reminder: Type.Optional(NStr()),
  recurrence: Type.Optional(NStr()),
  notes: Type.Optional(Type.String()),
  priority: Type.Optional(Type.Integer()),
  size: Type.Optional(Type.Integer()),
  labels: Type.Optional(Type.Array(Type.String())),
  assigneeId: Type.Optional(NStr()),
  position: Type.Optional(Type.Integer()),
});
export const TaskUpdateSchema = Type.Partial(
  Type.Object({
    title: Type.String(),
    projectId: NStr(),
    parentId: NStr(),
    done: Type.Boolean(),
    due: NStr(),
    reminder: NStr(),
    recurrence: NStr(),
    notes: Type.String(),
    priority: Type.Integer(),
    size: Type.Integer(),
    labels: Type.Array(Type.String()),
    assigneeId: NStr(),
    position: Type.Integer(),
  }),
);
export const ProjectCreateSchema = Type.Object({
  id: Type.Optional(Type.String()),
  name: Type.String(),
  parentId: Type.Optional(NStr()),
  color: Type.Optional(Type.String()),
  glyph: Type.Optional(Type.String()),
  collapsed: Type.Optional(Type.Boolean()),
  health: Type.Optional(Type.Array(Type.String())),
  position: Type.Optional(Type.Integer()),
});
export const ProjectUpdateSchema = Type.Partial(
  Type.Object({
    name: Type.String(),
    parentId: NStr(),
    color: Type.String(),
    glyph: Type.String(),
    collapsed: Type.Boolean(),
    position: Type.Integer(),
    health: Type.Array(Type.String()),
  }),
);
export const CalendarCreateSchema = Type.Object({
  id: Type.Optional(Type.String()),
  name: Type.String(),
  color: Type.Optional(Type.String()),
  glyph: Type.Optional(Type.String()),
  position: Type.Optional(Type.Integer()),
});
export const CalendarUpdateSchema = Type.Partial(
  Type.Object({
    name: Type.String(),
    color: Type.String(),
    glyph: Type.String(),
    position: Type.Integer(),
  }),
);
export const FolderCreateSchema = Type.Object({
  id: Type.Optional(Type.String()),
  name: Type.String(),
  parentId: Type.Optional(NStr()),
  color: Type.Optional(Type.String()),
  glyph: Type.Optional(Type.String()),
  collapsed: Type.Optional(Type.Boolean()),
  position: Type.Optional(Type.Integer()),
});
export const FolderUpdateSchema = Type.Partial(
  Type.Object({
    name: Type.String(),
    parentId: NStr(),
    color: Type.String(),
    glyph: Type.String(),
    collapsed: Type.Boolean(),
    position: Type.Integer(),
  }),
);
export const LabelCreateSchema = Type.Object({
  id: Type.Optional(Type.String()),
  name: Type.String(),
  pinned: Type.Optional(Type.Boolean()),
});
export const LabelUpdateSchema = Type.Partial(
  Type.Object({ name: Type.String(), pinned: Type.Boolean() }),
);
export const LabelMergeSchema = Type.Object({ from: Type.String(), to: Type.String() });
export const SavedQueryCreateSchema = Type.Object({
  id: Type.Optional(Type.String()),
  name: Type.String(),
  query: Type.String(),
  glyph: Type.Optional(Type.String()),
  color: Type.Optional(NStr()),
  pinned: Type.Optional(Type.Boolean()),
  position: Type.Optional(Type.Integer()),
});
export const SavedQueryUpdateSchema = Type.Partial(
  Type.Object({
    name: Type.String(),
    query: Type.String(),
    glyph: Type.String(),
    color: NStr(),
    pinned: Type.Boolean(),
    position: Type.Integer(),
  }),
);
export const AssignSchema = Type.Object({ assigneeId: NStr() });

export const BootstrapSchema = Type.Object({
  projects: Type.Array(ProjectSchema),
  calendars: Type.Array(CalendarSchema),
  folders: Type.Array(FolderSchema),
  tasks: Type.Array(TaskSchema),
  labels: Type.Array(LabelSchema),
  savedQueries: Type.Array(SavedQuerySchema),
});
export const QueryRequestSchema = Type.Object({
  query: Type.String(),
  limit: Type.Optional(Type.Integer({ minimum: 0 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});
// a unified-query hit: a `type` discriminator + the full entity fields (task/event/note).
// additionalProperties carries the per-type fields through serialization without a strict
// union (the new modules read what they need per type).
export const EntityResultSchema = Type.Object(
  { type: Type.Union([Type.Literal('task'), Type.Literal('event'), Type.Literal('note')]) },
  { additionalProperties: true },
);
export const QueryResponseSchema = Type.Object({
  items: Type.Array(EntityResultSchema),
  total: Type.Integer(),
});

// ---- row → JSON mappers ----------------------------------------------------
export interface TaskJson {
  id: string;
  projectId: string | null;
  parentId: string | null;
  title: string;
  done: boolean;
  due: string | null;
  reminder: string | null;
  labels: string[];
  recurrence: string | null;
  notes: string;
  priority: number;
  size: number;
  assigneeId: string | null;
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
  readableId: string | null;
}
export function rowToTask(row: TasksTable, labels: string[]): TaskJson {
  return {
    id: row.id,
    projectId: row.project_id,
    parentId: row.parent_id,
    title: row.title,
    done: !!row.done,
    due: row.due,
    reminder: row.reminder,
    labels,
    recurrence: row.recurrence,
    notes: row.notes,
    priority: row.priority,
    size: row.size,
    assigneeId: row.assignee_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
    readableId: row.readable_id,
  };
}
export function rowToProject(row: ProjectsTable) {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    color: row.color,
    glyph: row.glyph,
    collapsed: !!row.collapsed,
    position: row.position,
    health: parseHealth(row.health),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readableId: row.readable_id,
  };
}
export function rowToCalendar(row: CalendarsTable) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    glyph: row.glyph,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readableId: row.readable_id,
  };
}
export function rowToFolder(row: FoldersTable) {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    path: row.path,
    color: row.color,
    glyph: row.glyph,
    collapsed: !!row.collapsed,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readableId: row.readable_id,
  };
}
export function rowToLabel(row: LabelsTable) {
  return { id: row.id, name: row.name, pinned: !!row.pinned };
}
export function rowToSavedQuery(row: SavedQueriesTable) {
  return {
    id: row.id,
    name: row.name,
    glyph: row.glyph,
    query: row.query,
    system: !!row.system,
    color: row.color,
    position: row.position,
    pinned: !!row.pinned,
  };
}

// ---- events (D2) -----------------------------------------------------------
export const EventSchema = Type.Object({
  id: Type.String(),
  ownerId: Type.String(),
  creatorId: Type.String(),
  assigneeId: NStr(),
  calendarId: NStr(),
  title: Type.String(),
  notes: Type.String(),
  location: NStr(),
  allDay: Type.Boolean(),
  startAt: Type.String(),
  endAt: NStr(),
  recurrence: NStr(),
  reminder: NStr(),
  labels: Type.Array(Type.String()),
  position: Type.Integer(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  readableId: NStr(),
});
export const EventCreateSchema = Type.Object({
  id: Type.Optional(Type.String()),
  title: Type.String(),
  notes: Type.Optional(Type.String()),
  location: Type.Optional(NStr()),
  allDay: Type.Optional(Type.Boolean()),
  startAt: Type.String(),
  endAt: Type.Optional(NStr()),
  recurrence: Type.Optional(NStr()),
  reminder: Type.Optional(NStr()),
  assigneeId: Type.Optional(NStr()),
  calendarId: Type.Optional(NStr()),
  labels: Type.Optional(Type.Array(Type.String())),
  position: Type.Optional(Type.Integer()),
});
export const EventUpdateSchema = Type.Partial(
  Type.Object({
    title: Type.String(),
    notes: Type.String(),
    location: NStr(),
    allDay: Type.Boolean(),
    startAt: Type.String(),
    endAt: NStr(),
    recurrence: NStr(),
    reminder: NStr(),
    assigneeId: NStr(),
    calendarId: NStr(),
    labels: Type.Array(Type.String()),
    position: Type.Integer(),
  }),
);
// range read: each occurrence is an event plus the concrete date it falls on
export const EventOccurrenceSchema = Type.Composite([
  EventSchema,
  Type.Object({ date: Type.String() }),
]);
export const EventRangeQuerySchema = Type.Object({ from: Type.String(), to: Type.String() });
export const EventRangeResponseSchema = Type.Object({
  occurrences: Type.Array(EventOccurrenceSchema),
});

export interface EventJson {
  id: string;
  ownerId: string;
  creatorId: string;
  assigneeId: string | null;
  calendarId: string | null;
  title: string;
  notes: string;
  location: string | null;
  allDay: boolean;
  startAt: string;
  endAt: string | null;
  recurrence: string | null;
  reminder: string | null;
  labels: string[];
  position: number;
  createdAt: string;
  updatedAt: string;
  readableId: string | null;
}
export function rowToEvent(row: EventsTable, labels: string[] = []): EventJson {
  return {
    id: row.id,
    ownerId: row.owner_id,
    creatorId: row.creator_id,
    assigneeId: row.assignee_id,
    calendarId: row.calendar_id,
    title: row.title,
    notes: row.notes,
    location: row.location,
    allDay: !!row.all_day,
    startAt: row.start_at,
    endAt: row.end_at,
    recurrence: row.recurrence,
    reminder: row.reminder,
    labels,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readableId: row.readable_id,
  };
}

// ---- links (generic entity graph) -----------------------------------------
// Linkable types in 2b: event, task. A resolved link is always presented from
// one entity's POV — `other` is the entity on the far side of the edge.
const LinkTypeSchema = Type.Union([
  Type.Literal('event'),
  Type.Literal('task'),
  Type.Literal('note'),
]);
export const EntityRefSchema = Type.Object({
  type: LinkTypeSchema,
  id: Type.String(),
  title: Type.String(),
});
export const LinkCreateSchema = Type.Object({
  aType: LinkTypeSchema,
  aId: Type.String(),
  bType: LinkTypeSchema,
  bId: Type.String(),
  data: Type.Optional(Type.Unknown()),
});
export const LinkResolvedSchema = Type.Object({
  id: Type.String(),
  rel: Type.String(),
  other: EntityRefSchema,
  createdAt: Type.String(),
  source: Type.Union([Type.Literal('app'), Type.Literal('content')]),
});
export const LinkListSchema = Type.Array(LinkResolvedSchema);
export const LinkQuerySchema = Type.Object({ type: LinkTypeSchema, id: Type.String() });

// ---- notes (file-backed; DB shadows the .md) -------------------------------
export const NoteSchema = Type.Object({
  id: Type.String(),
  ownerId: Type.String(),
  path: Type.String(),
  folderId: NStr(),
  title: Type.String(),
  body: Type.String(), // read from disk, not stored in the DB
  reviewAt: NStr(),
  labels: Type.Array(Type.String()),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  readableId: NStr(),
});
export const NoteCreateSchema = Type.Object({
  title: Type.String(),
  body: Type.Optional(Type.String()),
  folderId: Type.Optional(NStr()),
  reviewAt: Type.Optional(NStr()),
  labels: Type.Optional(Type.Array(Type.String())),
});
export const NoteUpdateSchema = Type.Partial(
  Type.Object({
    title: Type.String(),
    body: Type.String(),
    folderId: NStr(),
    reviewAt: NStr(),
    labels: Type.Array(Type.String()),
  }),
);
export const NoteListItemSchema = Type.Object({
  id: Type.String(),
  path: Type.String(),
  title: Type.String(),
  mtime: Type.String(),
  createdAt: Type.String(), // notes-list "created" date (§6.5)
  updatedAt: Type.String(),
  folderId: NStr(), // notes-list folder filter (§2E) — Fastify strips undeclared props, so declare it
  readableId: NStr(), // readable-id chip on note rows
  labels: Type.Array(Type.String()), // labels-beneath in the list row (§6.5)
});
export const NoteListSchema = Type.Array(NoteListItemSchema);
export const NoteSearchHitSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  snippet: Type.String(),
});
export const NoteSearchQuerySchema = Type.Object({ q: Type.String() });
export const NoteSearchResponseSchema = Type.Array(NoteSearchHitSchema);
export const NoteSyncQuerySchema = Type.Object({
  mode: Type.Optional(Type.Union([Type.Literal('incremental'), Type.Literal('full')])),
});
export const NoteSyncResponseSchema = Type.Object({
  scanned: Type.Integer(),
  updated: Type.Integer(),
  tombstoned: Type.Integer(),
});

export interface NoteJson {
  id: string;
  ownerId: string;
  path: string;
  folderId: string | null;
  title: string;
  body: string;
  reviewAt: string | null;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  readableId: string | null;
}
export function rowToNote(row: NotesTable, body: string, labels: string[] = []): NoteJson {
  return {
    id: row.id,
    ownerId: row.owner_id,
    path: row.path,
    folderId: row.folder_id,
    title: row.title,
    body,
    reviewAt: row.review_at,
    labels,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readableId: row.readable_id,
  };
}
