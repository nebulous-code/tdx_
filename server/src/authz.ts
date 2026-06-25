// authz.ts — the single access-control chokepoint. The unit of sharing is the
// project; a task inherits its project's access. Labels/saved-queries are
// owner-only in D1 (not shareable yet). Grants target a project for a principal
// (a user, or a group the user belongs to); roles: viewer=read, editor=read+write,
// owner=all. Default (no grants) = owner-only.

import type { DB } from './db.js';

export type ResourceType = 'task' | 'project' | 'label' | 'saved_query' | 'event' | 'note';
export type Action = 'read' | 'write';
export type AccessLevel = 'none' | 'read' | 'write';

interface UserRef {
  id: string;
}

function roleLevel(role: string): AccessLevel {
  if (role === 'owner' || role === 'editor') return 'write';
  if (role === 'viewer') return 'read';
  return 'none';
}
const best = (a: AccessLevel, b: AccessLevel): AccessLevel =>
  a === 'write' || b === 'write' ? 'write' : a === 'read' || b === 'read' ? 'read' : 'none';

// Best access a user has on a resource ('none' | 'read' | 'write').
export async function accessLevel(
  db: DB,
  user: UserRef,
  type: ResourceType,
  id: string,
): Promise<AccessLevel> {
  if (type === 'task') {
    const t = await db
      .selectFrom('tasks')
      .select(['owner_id', 'project_id'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!t) return 'none';
    if (t.owner_id === user.id) return 'write';
    return t.project_id ? accessLevel(db, user, 'project', t.project_id) : 'none';
  }
  if (type === 'project') {
    const p = await db
      .selectFrom('projects')
      .select('owner_id')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!p) return 'none';
    if (p.owner_id === user.id) return 'write';
    return projectGrantLevel(db, user.id, id);
  }
  // event | label | saved_query — owner-only in D1/D2
  if (type === 'event') {
    const row = await db
      .selectFrom('events')
      .select('owner_id')
      .where('id', '=', id)
      .executeTakeFirst();
    return row && row.owner_id === user.id ? 'write' : 'none';
  }
  if (type === 'note') {
    const row = await db
      .selectFrom('notes')
      .select(['owner_id', 'tombstoned'])
      .where('id', '=', id)
      .executeTakeFirst();
    return row && !row.tombstoned && row.owner_id === user.id ? 'write' : 'none';
  }
  if (type === 'label') {
    const row = await db
      .selectFrom('labels')
      .select('owner_id')
      .where('id', '=', id)
      .executeTakeFirst();
    return row && row.owner_id === user.id ? 'write' : 'none';
  }
  const row = await db
    .selectFrom('saved_queries')
    .select('owner_id')
    .where('id', '=', id)
    .executeTakeFirst();
  return row && row.owner_id === user.id ? 'write' : 'none';
}

async function projectGrantLevel(db: DB, userId: string, projectId: string): Promise<AccessLevel> {
  const groups = await db
    .selectFrom('group_members')
    .select('group_id')
    .where('user_id', '=', userId)
    .execute();
  const groupIds = groups.map((g) => g.group_id);

  const rows = await db
    .selectFrom('grants')
    .select('role')
    .where('resource_type', '=', 'project')
    .where('resource_id', '=', projectId)
    .where((eb) =>
      eb.or([
        eb.and([eb('principal_type', '=', 'user'), eb('principal_id', '=', userId)]),
        ...(groupIds.length
          ? [eb.and([eb('principal_type', '=', 'group'), eb('principal_id', 'in', groupIds)])]
          : []),
      ]),
    )
    .execute();

  return rows.reduce<AccessLevel>((lvl, r) => best(lvl, roleLevel(r.role)), 'none');
}

export async function canAccess(
  db: DB,
  user: UserRef,
  type: ResourceType,
  id: string,
  action: Action,
): Promise<boolean> {
  const lvl = await accessLevel(db, user, type, id);
  return lvl === 'write' || (lvl === 'read' && action === 'read');
}

// For routes: 404 if invisible, 403 if visible-but-not-writable, else null (allowed).
export function denyStatus(level: AccessLevel, action: Action): 404 | 403 | null {
  if (level === 'none') return 404;
  if (action === 'write' && level !== 'write') return 403;
  return null;
}
