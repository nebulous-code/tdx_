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
import { GLYPHS } from './glyphs.js';

const Nullable = <T extends ReturnType<typeof Type.Unsafe>>(
  t: T,
  opts?: Parameters<typeof Type.Union>[1],
) => Type.Union([t, Type.Null()], opts);
const NStr = (opts?: Parameters<typeof Type.Union>[1]) => Nullable(Type.String(), opts);

// The glyph picker is the SOURCE OF TRUTH (a.9): a glyph the UI can't offer can't be stored, so
// an off-list one is a 400 rather than a silent surprise (that's how a ♥ nobody could select
// ended up on a seeded calendar). frontend/js/glyphs.js ≡ src/glyphs.ts, parity-tested.
//
// REQUESTS ONLY. The four *response* schemas keep a plain Type.String() on purpose: Fastify
// SERIALIZES through them and BootstrapSchema reuses them, so tightening those would make a
// single stray legacy row break GET /api/bootstrap for the whole account. Validate what comes
// in; never gag what goes out.
const GlyphSchema = Type.Union(GLYPHS.map((g) => Type.Literal(g)));

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

// ---- shared response / param schemas (reused across routes for the OpenAPI spec) ----
export const ErrorSchema = Type.Object(
  {
    error: Type.String({ description: 'Human-readable error message.' }),
    field: Type.Optional(
      Type.String({ description: 'The offending input field, on validation errors.' }),
    ),
  },
  {
    // never strip an error body — some routes attach extra context beyond `error`/`field`
    additionalProperties: true,
    description: 'Error response body.',
    examples: [{ error: 'not found' }],
  },
);
export const IdParamSchema = Type.Object({
  id: Type.String({ description: 'The entity id (a client-generated UUID).' }),
});
export const OkSchema = Type.Object(
  { ok: Type.Boolean() },
  { description: 'Simple success acknowledgement.', examples: [{ ok: true }] },
);
export const UserSchema = Type.Object(
  {
    id: Type.String(),
    username: Type.String(),
    email: Type.String(),
    theme: Type.String(),
    week_start: Type.Integer({ description: '0=Sun … 6=Sat.' }),
    sort_prefs: Type.Unknown({ description: 'Per-view sort preferences, or null.' }),
    fib_sizing: Type.Boolean({ description: 'Whether task sizes use the fibonacci scale.' }),
    notes_root_name: Type.String({ description: "Display name for the vault root ('' = hidden)." }),
    calendars_all_name: Type.String({
      description: "Display name for the all-calendars row ('' = hidden).",
    }),
    is_admin: Type.Boolean(),
  },
  { description: 'The authenticated user (public projection; never includes the password hash).' },
);

// ---- entity JSON schemas ---------------------------------------------------
export const TaskSchema = Type.Object(
  {
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
    priority: Type.Integer({
      description: 'Loose importance, 1 (very low) … 5 (very high); 0 = unset.',
    }),
    size: Type.Integer({ description: 'Effort estimate (fibonacci-ish); 0 = unset.' }),
    assigneeId: NStr(),
    createdAt: Type.String(),
    completedAt: NStr(),
    updatedAt: Type.String(),
    readableId: NStr({ description: 'Short human id like `t_0042`, allocated on first save.' }),
  },
  {
    description:
      'A to-do item. `recurrence` is a small phrase (e.g. `every mon,thu`); `labels` are label ids.',
    examples: [
      {
        id: '8f3a1c2e-1111-4a2b-9c3d-000000000001',
        projectId: '2b86d80b-ccde-45bd-99ad-d84b20411bd7',
        parentId: null,
        title: 'Water the plants',
        done: false,
        due: '2026-07-20',
        reminder: null,
        labels: ['home'],
        recurrence: 'every mon,thu',
        notes: '',
        priority: 3,
        size: 2,
        assigneeId: null,
        createdAt: '2026-07-15T09:00:00.000Z',
        completedAt: null,
        updatedAt: '2026-07-15T09:00:00.000Z',
        readableId: 't_0042',
      },
    ],
  },
);
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
// how a view presents its results — view metadata, not a query term (e.1; migration 007)
export const DisplaySchema = Type.Union([
  Type.Literal('auto'),
  Type.Literal('grid'),
  Type.Literal('list'),
]);
export const SavedQuerySchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  glyph: Type.String(),
  query: Type.String(),
  system: Type.Boolean(),
  color: NStr(),
  position: Type.Integer(),
  pinned: Type.Boolean(),
  display: DisplaySchema,
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
  glyph: Type.Optional(GlyphSchema),
  collapsed: Type.Optional(Type.Boolean()),
  health: Type.Optional(Type.Array(Type.String())),
  position: Type.Optional(Type.Integer()),
});
export const ProjectUpdateSchema = Type.Partial(
  Type.Object({
    name: Type.String(),
    parentId: NStr(),
    color: Type.String(),
    glyph: GlyphSchema,
    collapsed: Type.Boolean(),
    position: Type.Integer(),
    health: Type.Array(Type.String()),
  }),
);
export const CalendarCreateSchema = Type.Object({
  id: Type.Optional(Type.String()),
  name: Type.String(),
  color: Type.Optional(Type.String()),
  glyph: Type.Optional(GlyphSchema),
  position: Type.Optional(Type.Integer()),
});
export const CalendarUpdateSchema = Type.Partial(
  Type.Object({
    name: Type.String(),
    color: Type.String(),
    glyph: GlyphSchema,
    position: Type.Integer(),
  }),
);
export const FolderCreateSchema = Type.Object({
  id: Type.Optional(Type.String()),
  name: Type.String(),
  parentId: Type.Optional(NStr()),
  color: Type.Optional(Type.String()),
  glyph: Type.Optional(GlyphSchema),
  collapsed: Type.Optional(Type.Boolean()),
  position: Type.Optional(Type.Integer()),
});
export const FolderUpdateSchema = Type.Partial(
  Type.Object({
    name: Type.String(),
    parentId: NStr(),
    color: Type.String(),
    glyph: GlyphSchema,
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
  glyph: Type.Optional(GlyphSchema),
  color: Type.Optional(NStr()),
  pinned: Type.Optional(Type.Boolean()),
  position: Type.Optional(Type.Integer()),
  display: Type.Optional(DisplaySchema),
});
export const SavedQueryUpdateSchema = Type.Partial(
  Type.Object({
    name: Type.String(),
    query: Type.String(),
    glyph: GlyphSchema,
    color: NStr(),
    pinned: Type.Boolean(),
    position: Type.Integer(),
    display: DisplaySchema,
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
    display: (row.display || 'auto') as 'auto' | 'grid' | 'list',
  };
}

// ---- events (D2) -----------------------------------------------------------
export const EventSchema = Type.Object(
  {
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
  },
  {
    description:
      'A calendar event. `startAt`/`endAt` are ISO timestamps (or `YYYY-MM-DD` when `allDay`); ' +
      '`recurrence` is a phrase like `weekly on tue`.',
    examples: [
      {
        id: 'e1a2…',
        ownerId: 'u_1',
        creatorId: 'u_1',
        assigneeId: null,
        calendarId: '4d5e6f70-1111-2222-3333-444444444444',
        title: 'Dentist',
        notes: '',
        location: '123 Main St',
        allDay: false,
        startAt: '2026-07-21T14:30:00.000Z',
        endAt: '2026-07-21T15:00:00.000Z',
        recurrence: null,
        reminder: null,
        labels: [],
        position: 0,
        createdAt: '2026-07-15T09:00:00.000Z',
        updatedAt: '2026-07-15T09:00:00.000Z',
        readableId: 'e_0007',
      },
    ],
  },
);
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
export const NoteSchema = Type.Object(
  {
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
  },
  {
    description:
      'A markdown note. `body` is read live from the vault file (not stored in the DB); `path` is ' +
      'relative to the vault root and `folderId` is derived from its directory.',
    examples: [
      {
        id: '45957642-4ace-4243-8c9e-b89f420e1c76',
        ownerId: 'u_1',
        path: 'Garden/Tomato care log.md',
        folderId: '0ea5…',
        title: 'Tomato care log',
        body: '# Tomatoes\n\nWater deeply twice a week.\n',
        reviewAt: null,
        labels: ['garden'],
        createdAt: '2026-07-15T09:00:00.000Z',
        updatedAt: '2026-07-15T09:00:00.000Z',
        readableId: 'n_0011',
      },
    ],
  },
);
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
