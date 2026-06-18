// schemas.ts — the single source of entity JSON shapes (TypeBox, reused for
// request/response validation + OpenAPI) and the row⇄JSON mappers. This is the
// ONE place SQLite 0/1 ints become booleans and JSON-TEXT columns are parsed,
// so a raw int / unparsed JSON never leaks to a client.

import { Type } from '@fastify/type-provider-typebox';
import type { LabelsTable, ProjectsTable, SavedQueriesTable, TasksTable } from './db.js';

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
  tasks: Type.Array(TaskSchema),
  labels: Type.Array(LabelSchema),
  savedQueries: Type.Array(SavedQuerySchema),
});
export const QueryRequestSchema = Type.Object({
  query: Type.String(),
  limit: Type.Optional(Type.Integer({ minimum: 0 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});
export const QueryResponseSchema = Type.Object({
  items: Type.Array(TaskSchema),
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
