// services/folders.ts — note "folders" = managed vault subdirs. The on-disk dir is
// where a folder's notes live; this row shadows it with icon/color. Identity is held
// in a hidden `.tdx-folder.json` marker inside the dir, so an external rename/move
// carries the folder's id + styling with it (the .obsidian precedent). Folders nest
// (parent_id) and `path` mirrors the dir relative to the owner's vault root.

import fs from 'node:fs';
import path from 'node:path';
import type { Updateable } from 'kysely';
import type { DB, FoldersTable } from '../db.js';
import { DEFAULT_GLYPH, coerceGlyph } from '../glyphs.js'; // a.9 — the picker is the source of truth
import { allocateReadableId, newId } from '../ids.js';
import { rowToFolder } from '../schemas.js';
import { abs, vaultRoot } from '../vault.js';
import { checkIfMatch } from './concurrency.js';

const MARKER = '.tdx-folder.json';

// one path segment: strip filesystem-illegal chars (no slashes → single level)
function sanitizeSeg(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|#^[\]]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 120) || 'untitled'
  );
}

interface Marker {
  id: string;
  color: string;
  glyph: string;
}
function readMarker(owner: string, relDir: string): Marker | null {
  try {
    const m = JSON.parse(fs.readFileSync(abs(owner, path.join(relDir, MARKER)), 'utf8'));
    return m && typeof m.id === 'string' ? m : null;
  } catch {
    return null;
  }
}
function writeMarker(owner: string, relDir: string, m: Marker): void {
  fs.mkdirSync(abs(owner, relDir), { recursive: true });
  fs.writeFileSync(abs(owner, path.join(relDir, MARKER)), `${JSON.stringify(m, null, 2)}\n`);
}

// first free dir segment under a parent (Name, Name 2, …) — avoids dir collisions
function uniqueSeg(owner: string, baseRel: string, seg: string): string {
  for (let n = 1; ; n++) {
    const cand = n === 1 ? seg : `${seg} ${n}`;
    const rel = baseRel ? path.join(baseRel, cand) : cand;
    if (!fs.existsSync(abs(owner, rel))) return cand;
  }
}

export async function getFolder(db: DB, owner: string, id: string) {
  const row = await db
    .selectFrom('folders')
    .selectAll()
    .where('id', '=', id)
    .where('owner_id', '=', owner)
    .executeTakeFirst();
  return row ? rowToFolder(row) : null;
}

export interface FolderCreateInput {
  id?: string;
  name: string;
  parentId?: string | null;
  color?: string;
  glyph?: string;
  collapsed?: boolean;
  position?: number;
}
export interface FolderPatch {
  name?: string;
  parentId?: string | null;
  color?: string;
  glyph?: string;
  collapsed?: boolean;
  position?: number;
}

export async function createFolder(db: DB, owner: string, input: FolderCreateInput) {
  vaultRoot(owner);
  const id = input.id ?? newId();
  const now = new Date().toISOString();
  const color = input.color ?? '#ffb000';
  const glyph = input.glyph ?? DEFAULT_GLYPH.folder; // schema-validated on the way in (a.9)
  let baseRel = '';
  if (input.parentId) {
    const parent = await db
      .selectFrom('folders')
      .select('path')
      .where('id', '=', input.parentId)
      .where('owner_id', '=', owner)
      .executeTakeFirst();
    baseRel = parent?.path ?? '';
  }
  const seg = uniqueSeg(owner, baseRel, sanitizeSeg(input.name));
  const relDir = baseRel ? path.join(baseRel, seg) : seg;
  writeMarker(owner, relDir, { id, color, glyph });
  const m = await db
    .selectFrom('folders')
    .select((eb) => eb.fn.max('position').as('m'))
    .where('owner_id', '=', owner)
    .executeTakeFirst();
  await db
    .insertInto('folders')
    .values({
      id,
      owner_id: owner,
      parent_id: input.parentId ?? null,
      name: input.name,
      path: relDir,
      color,
      glyph,
      collapsed: input.collapsed ? 1 : 0,
      position: input.position ?? Number(m?.m ?? 0) + 1,
      archived: 0,
      created_at: now,
      updated_at: now,
      readable_id: await allocateReadableId(db, owner, 'folder'),
    })
    .execute();
  return (await getFolder(db, owner, id))!;
}

// Move a folder's dir from oldRel → newRel on disk and re-prefix every descendant
// folder + note path in the DB (the dir move already relocated the files).
async function moveSubtreePaths(db: DB, owner: string, oldRel: string, newRel: string) {
  if (oldRel === newRel) return;
  fs.renameSync(abs(owner, oldRel), abs(owner, newRel));
  const reprefix = (p: string) => (p === oldRel ? newRel : newRel + p.slice(oldRel.length));
  const folders = await db
    .selectFrom('folders')
    .select(['id', 'path'])
    .where('owner_id', '=', owner)
    .execute();
  for (const f of folders) {
    if (f.path === oldRel || f.path.startsWith(`${oldRel}/`)) {
      await db
        .updateTable('folders')
        .set({ path: reprefix(f.path) })
        .where('id', '=', f.id)
        .execute();
    }
  }
  const notes = await db
    .selectFrom('notes')
    .select(['id', 'path'])
    .where('owner_id', '=', owner)
    .where('tombstoned', '=', 0)
    .execute();
  for (const n of notes) {
    if (n.path.startsWith(`${oldRel}/`)) {
      await db
        .updateTable('notes')
        .set({ path: reprefix(n.path) })
        .where('id', '=', n.id)
        .execute();
    }
  }
}

export async function updateFolder(
  db: DB,
  owner: string,
  id: string,
  patch: FolderPatch,
  ifMatch?: string,
) {
  const row = await db
    .selectFrom('folders')
    .selectAll()
    .where('id', '=', id)
    .where('owner_id', '=', owner)
    .executeTakeFirst();
  if (!row) return null;
  checkIfMatch(ifMatch, row.updated_at);

  // a name or parent change relocates the dir on disk + re-paths the subtree
  const renaming = patch.name !== undefined && sanitizeSeg(patch.name) !== path.basename(row.path);
  const reparenting = patch.parentId !== undefined && (patch.parentId ?? null) !== row.parent_id;
  let newPath = row.path;
  if (renaming || reparenting) {
    let baseRel = '';
    const parentId = patch.parentId !== undefined ? patch.parentId : row.parent_id;
    if (parentId) {
      const parent = await db
        .selectFrom('folders')
        .select('path')
        .where('id', '=', parentId)
        .where('owner_id', '=', owner)
        .executeTakeFirst();
      baseRel = parent?.path ?? '';
    }
    const seg = uniqueSeg(owner, baseRel, sanitizeSeg(patch.name ?? row.name));
    newPath = baseRel ? path.join(baseRel, seg) : seg;
    await moveSubtreePaths(db, owner, row.path, newPath);
  }

  const set: Updateable<FoldersTable> = { updated_at: new Date().toISOString(), path: newPath };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.parentId !== undefined) set.parent_id = patch.parentId;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.glyph !== undefined) set.glyph = patch.glyph;
  if (patch.collapsed !== undefined) set.collapsed = patch.collapsed ? 1 : 0;
  if (patch.position !== undefined) set.position = patch.position;
  await db
    .updateTable('folders')
    .set(set)
    .where('id', '=', id)
    .where('owner_id', '=', owner)
    .execute();

  // keep the on-disk marker's styling in step
  const fresh = (await getFolder(db, owner, id))!;
  writeMarker(owner, fresh.path, { id, color: fresh.color, glyph: fresh.glyph });
  return fresh;
}

// Delete an EMPTY folder (no subfolders, no notes) — removes the dir + marker + row.
// Returns 'not-empty' if it still holds notes/subfolders (caller → 409).
export async function deleteFolder(
  db: DB,
  owner: string,
  id: string,
): Promise<boolean | 'not-empty'> {
  const row = await db
    .selectFrom('folders')
    .selectAll()
    .where('id', '=', id)
    .where('owner_id', '=', owner)
    .executeTakeFirst();
  if (!row) return false;
  const sub = await db
    .selectFrom('folders')
    .select('id')
    .where('owner_id', '=', owner)
    .where('parent_id', '=', id)
    .executeTakeFirst();
  const note = await db
    .selectFrom('notes')
    .select('id')
    .where('owner_id', '=', owner)
    .where('folder_id', '=', id)
    .where('tombstoned', '=', 0)
    .executeTakeFirst();
  if (sub || note) return 'not-empty';
  try {
    fs.rmSync(abs(owner, row.path), { recursive: true, force: true });
  } catch {
    /* dir already gone */
  }
  await db.deleteFrom('folders').where('id', '=', id).where('owner_id', '=', owner).execute();
  return true;
}

// Reconcile folder ROWS from the vault dirs: ensure every dir has a row (using its
// marker id, or minting one), and set each note's folder_id from its path's dir.
// Called by scanVault after files are indexed.
export async function reconcileFolders(db: DB, owner: string): Promise<void> {
  const root = vaultRoot(owner);
  const now = new Date().toISOString();
  // collect every subdir (relative), skipping dotfiles/dirs
  const dirs: string[] = [];
  const walk = (relDir: string) => {
    const absDir = relDir ? abs(owner, relDir) : root;
    for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || !ent.isDirectory() || ent.isSymbolicLink()) continue;
      const rel = relDir ? path.join(relDir, ent.name) : ent.name;
      dirs.push(rel);
      walk(rel);
    }
  };
  walk('');

  const existing = await db
    .selectFrom('folders')
    .select(['id', 'path'])
    .where('owner_id', '=', owner)
    .execute();
  const byPath = new Map(existing.map((f) => [f.path, f.id]));

  for (const relDir of dirs) {
    if (byPath.has(relDir)) continue;
    const marker = readMarker(owner, relDir);
    const id = marker?.id ?? newId();
    const color = marker?.color ?? '#ffb000';
    // COERCE, don't trust: .tdx-folder.json lives in the user's own vault, so its glyph never
    // passed through a request schema. Anything not in the picker's list becomes the default,
    // or a hand-edited marker could smuggle a glyph past the a.9 lock.
    const glyph = coerceGlyph(marker?.glyph, DEFAULT_GLYPH.folder);
    if (!marker) writeMarker(owner, relDir, { id, color, glyph });
    const parentRel = path.dirname(relDir);
    const parentId = parentRel === '.' ? null : (byPath.get(parentRel) ?? null);
    await db
      .insertInto('folders')
      .values({
        id,
        owner_id: owner,
        parent_id: parentId,
        name: path.basename(relDir),
        path: relDir,
        color,
        glyph,
        collapsed: 0,
        position: 0,
        archived: 0,
        created_at: now,
        updated_at: now,
        readable_id: await allocateReadableId(db, owner, 'folder'),
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
    byPath.set(relDir, id);
  }

  // set folder_id on each live note from its path's directory
  const notes = await db
    .selectFrom('notes')
    .select(['id', 'path', 'folder_id'])
    .where('owner_id', '=', owner)
    .where('tombstoned', '=', 0)
    .execute();
  for (const n of notes) {
    const dir = path.dirname(n.path);
    const fid = dir === '.' ? null : (byPath.get(dir) ?? null);
    if (fid !== n.folder_id) {
      await db.updateTable('notes').set({ folder_id: fid }).where('id', '=', n.id).execute();
    }
  }
}
