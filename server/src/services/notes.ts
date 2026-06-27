// services/notes.ts — the note domain (D2 §4). Note CONTENT is the .md file on
// disk (the vault); these helpers keep the DB shadow (notes row + FTS index, and
// — wired in increment 3 — the file-derived link edges) in step. `scanFile` is the
// atom: read → parse → (writeback id) → upsert row → refresh FTS → reconcile links.
// The CRUD wrappers own the file (write it, then scan); `scanVault` (increment 2)
// drives `scanFile` over the whole vault for external edits.

import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'kysely';
import type { DB } from '../db.js';
import { allocateReadableId, newId } from '../ids.js';
import { type NoteJson, rowToNote } from '../schemas.js';
import { abs, vaultBase, vaultRoot } from '../vault.js';
import { reconcileFolders } from './folders.js';
import {
  type ExtractedLinks,
  extractLinks,
  injectFrontmatterId,
  parseNote,
  serializeNote,
} from './markdown.js';
import { resolveReadable } from './readableIds.js';

// ---- FTS keyword index (derived, one row per note) -------------------------
async function refreshFts(
  db: DB,
  noteId: string,
  owner: string,
  title: string,
  body: string,
): Promise<void> {
  await sql`DELETE FROM notes_fts WHERE note_id = ${noteId}`.execute(db);
  await sql`INSERT INTO notes_fts (note_id, owner_id, title, body)
            VALUES (${noteId}, ${owner}, ${title}, ${body})`.execute(db);
}

// user text → a safe FTS5 MATCH expression: word-ish tokens, prefix-matched, AND-ed
function ftsQuery(q: string): string {
  return q
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter(Boolean)
    .map((t) => `${t}*`)
    .join(' ');
}

// ---- the scan atom ---------------------------------------------------------
// Index one vault file by its relative path. Returns the note, or null if the
// file is missing (scanVault turns that into a tombstone). Assigns + writes back
// a frontmatter id when the file lacks one.
// the folder row whose dir holds this note (null for a root-level note)
async function folderIdForPath(db: DB, owner: string, relPath: string): Promise<string | null> {
  const dir = path.dirname(relPath);
  if (dir === '.') return null;
  const row = await db
    .selectFrom('folders')
    .select('id')
    .where('owner_id', '=', owner)
    .where('path', '=', dir)
    .executeTakeFirst();
  return row?.id ?? null;
}

async function loadNoteLabels(db: DB, id: string): Promise<string[]> {
  return (
    await db
      .selectFrom('note_labels')
      .select('label_id')
      .where('note_id', '=', id)
      .orderBy('label_id')
      .execute()
  ).map((r) => r.label_id);
}

async function setNoteLabels(
  db: DB,
  owner: string,
  noteId: string,
  labels: string[],
): Promise<void> {
  await db.deleteFrom('note_labels').where('note_id', '=', noteId).execute();
  if (!labels.length) return;
  const owned = await db
    .selectFrom('labels')
    .select('id')
    .where('owner_id', '=', owner)
    .where('id', 'in', labels)
    .execute();
  if (owned.length) {
    await db
      .insertInto('note_labels')
      .values(owned.map((o) => ({ note_id: noteId, label_id: o.id })))
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
}

export async function scanFile(db: DB, owner: string, relPath: string): Promise<NoteJson | null> {
  const absPath = abs(owner, relPath);
  let raw: string;
  try {
    raw = fs.readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
  const parsed = parseNote(raw);
  let id = parsed.id;
  if (!id) {
    id = newId();
    fs.writeFileSync(absPath, injectFrontmatterId(raw, id)); // gentle writeback
  }
  const title = path.basename(relPath, '.md'); // the filename IS the title (Obsidian model)
  const mtime = fs.statSync(absPath).mtime.toISOString();
  const now = new Date().toISOString();
  // `review:` frontmatter is the note's "due" for queries; mirror it to a column. Keep it
  // OUT of the generic frontmatter JSON (it has its own column), like the managed `id`.
  const reviewAt = parsed.frontmatter.review || null;
  const extraFm: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.frontmatter)) if (k !== 'review') extraFm[k] = v;
  const fmJson = Object.keys(extraFm).length ? JSON.stringify(extraFm) : null;
  const folderId = await folderIdForPath(db, owner, relPath);

  // owner-scoped lookup: a foreign note with the same frontmatter id is NOT ours to update
  const existing = await db
    .selectFrom('notes')
    .select('id')
    .where('id', '=', id)
    .where('owner_id', '=', owner)
    .executeTakeFirst();
  if (existing) {
    await db
      .updateTable('notes')
      .set({
        path: relPath,
        folder_id: folderId,
        title,
        mtime,
        frontmatter: fmJson,
        review_at: reviewAt,
        tombstoned: 0,
        updated_at: now,
      })
      .where('id', '=', id)
      .where('owner_id', '=', owner)
      .execute();
  } else {
    await db
      .insertInto('notes')
      .values({
        id,
        owner_id: owner,
        path: relPath,
        folder_id: folderId,
        title,
        mtime,
        frontmatter: fmJson,
        review_at: reviewAt,
        tombstoned: 0,
        created_at: now,
        updated_at: now,
        readable_id: await allocateReadableId(db, owner, 'note'),
      })
      .execute();
  }
  await refreshFts(db, id, owner, title, parsed.body);
  await reconcileFileLinks(db, owner, id, extractLinks(parsed.body));
  return getNote(db, owner, id);
}

// ---- file-derived links (content edges → note_links) -----------------------
// Resolve an Obsidian-style [[Name]] to a note id (by title or filename); null if
// missing/dangling (it re-resolves on a later scan once the target exists).
async function resolveNoteName(db: DB, owner: string, name: string): Promise<string | null> {
  const rows = await db
    .selectFrom('notes')
    .select(['id', 'path', 'title'])
    .where('owner_id', '=', owner)
    .where('tombstoned', '=', 0)
    .execute();
  const lc = name.toLowerCase();
  const hit = rows.find(
    (r) => r.title.toLowerCase() === lc || path.basename(r.path, '.md').toLowerCase() === lc,
  );
  return hit ? hit.id : null;
}

const relFor = (target: 'task' | 'event' | 'note'): string => ['note', target].sort().join('-');

async function targetExists(
  db: DB,
  owner: string,
  type: 'task' | 'event',
  id: string,
): Promise<boolean> {
  const t = type === 'task' ? 'tasks' : 'events';
  const row = await db
    .selectFrom(t)
    .select('id')
    .where('id', '=', id)
    .where('owner_id', '=', owner)
    .where('archived', '=', 0)
    .executeTakeFirst();
  return !!row;
}

// Replace a note's content edges to exactly match what's written in its file now.
// Only materialize edges to existing, owned targets (dangling [[task:bad]] / unknown
// names are skipped). getLinksFor surfaces these alongside the app-asserted links.
export async function reconcileFileLinks(
  db: DB,
  owner: string,
  noteId: string,
  parsed: ExtractedLinks,
): Promise<void> {
  await db
    .deleteFrom('note_links')
    .where('owner_id', '=', owner)
    .where('origin_note_id', '=', noteId)
    .execute();

  const targets: { target_type: 'task' | 'event' | 'note'; target_id: string }[] = [];
  for (const id of parsed.tasks) {
    if (await targetExists(db, owner, 'task', id))
      targets.push({ target_type: 'task', target_id: id });
  }
  for (const id of parsed.events) {
    if (await targetExists(db, owner, 'event', id))
      targets.push({ target_type: 'event', target_id: id });
  }
  for (const name of parsed.notes) {
    const id = await resolveNoteName(db, owner, name);
    if (id && id !== noteId) targets.push({ target_type: 'note', target_id: id }); // no self-links
  }
  // readable-id wikilinks ([[t_0001]] / [[n_0002]]) — resolve to the owner's UUID. Only
  // same-owner targets become content edges (a username-prefixed cross-user ref won't).
  for (const tok of parsed.readables) {
    const r = await resolveReadable(db, owner, tok);
    if (!r || r.ownerId !== owner) continue;
    if (r.kind !== 'task' && r.kind !== 'event' && r.kind !== 'note') continue;
    if (r.kind === 'note' && r.id === noteId) continue; // no self-link
    if (!targets.some((t) => t.target_type === r.kind && t.target_id === r.id))
      targets.push({ target_type: r.kind, target_id: r.id });
  }

  const now = new Date().toISOString();
  for (const t of targets) {
    await db
      .insertInto('note_links')
      .values({
        id: newId(),
        owner_id: owner,
        origin_note_id: noteId,
        target_type: t.target_type,
        target_id: t.target_id,
        rel: relFor(t.target_type),
        created_at: now,
      })
      .execute();
  }
}

// ---- scanVault: drive scanFile over the whole vault ------------------------
// Enumerate *.md, (re)index changed files, then detect deletions → tombstone.
// `incremental` skips files whose mtime matches the row; `full` rescans all.
// Triggers (per §4): sync button / window-focus / nightly → incremental.
function walkMd(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue; // skip dotfiles/dirs (e.g. .obsidian)
      if (ent.isSymbolicLink()) continue; // don't follow symlinks out of the vault
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith('.md')) out.push(path.relative(root, full));
    }
  };
  walk(root);
  return out;
}

export interface ScanSummary {
  scanned: number;
  updated: number;
  tombstoned: number;
}
export async function scanVault(
  db: DB,
  owner: string,
  mode: 'incremental' | 'full' = 'incremental',
): Promise<ScanSummary> {
  const root = vaultRoot(owner);
  const files = walkMd(root);
  const live = await db
    .selectFrom('notes')
    .select(['path', 'mtime'])
    .where('owner_id', '=', owner)
    .where('tombstoned', '=', 0)
    .execute();
  const byPath = new Map(live.map((r) => [r.path, r.mtime]));

  let updated = 0;
  for (const relPath of files) {
    if (mode === 'incremental') {
      const knownMtime = byPath.get(relPath);
      if (knownMtime && fs.statSync(abs(owner, relPath)).mtime.toISOString() === knownMtime)
        continue;
    }
    await scanFile(db, owner, relPath); // resolves moves (upsert by frontmatter id)
    updated++;
  }

  // deletion detection — runs AFTER scanning so a move (path rewrite) isn't misread
  let tombstoned = 0;
  const fresh = await db
    .selectFrom('notes')
    .select(['id', 'path'])
    .where('owner_id', '=', owner)
    .where('tombstoned', '=', 0)
    .execute();
  for (const r of fresh) {
    if (fs.existsSync(abs(owner, r.path))) continue;
    await db
      .updateTable('notes')
      .set({ tombstoned: 1, updated_at: new Date().toISOString() })
      .where('id', '=', r.id)
      .execute();
    await sql`DELETE FROM notes_fts WHERE note_id = ${r.id}`.execute(db);
    await db
      .deleteFrom('note_links')
      .where('owner_id', '=', owner)
      .where('origin_note_id', '=', r.id)
      .execute();
    tombstoned++;
  }
  // reconcile folder entities from the on-disk dirs + set each note's folder_id
  await reconcileFolders(db, owner);
  return { scanned: files.length, updated, tombstoned };
}

// ---- file-owning CRUD ------------------------------------------------------
// The title IS the filename (Obsidian model). Strip characters illegal in a
// filename or in a [[wikilink]] target so names stay portable + linkable; the
// hidden frontmatter id carries identity, so renames never break links.
function sanitizeName(title: string): string {
  return (
    title
      .replace(/[\\/:*?"<>|#^[\]]/g, '') // filesystem- + wikilink-illegal characters
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '') // no leading/trailing dots or spaces
      .slice(0, 120) || 'untitled'
  );
}
// First free `Name.md`, `Name 2.md`, … (Obsidian-style). `keep` is the note's own
// current path, which never counts as a collision (a no-op rename stays put).
function uniqueFile(owner: string, name: string, keep?: string): string {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${name}.md` : `${name} ${n}.md`;
    if (candidate === keep || !fs.existsSync(abs(owner, candidate))) return candidate;
  }
}

// resolve a folderId → its vault-relative dir ('' for root / unknown)
async function folderBaseRel(db: DB, owner: string, folderId?: string | null): Promise<string> {
  if (!folderId) return '';
  const f = await db
    .selectFrom('folders')
    .select('path')
    .where('id', '=', folderId)
    .where('owner_id', '=', owner)
    .executeTakeFirst();
  return f?.path ?? '';
}

export async function createNote(
  db: DB,
  owner: string,
  input: {
    title: string;
    body?: string;
    folderId?: string | null;
    reviewAt?: string | null;
    labels?: string[];
  },
): Promise<NoteJson> {
  vaultRoot(owner); // ensure the owner's dir exists
  const id = newId();
  const baseRel = await folderBaseRel(db, owner, input.folderId);
  const name = sanitizeName(input.title);
  const relPath = uniqueFile(owner, baseRel ? path.join(baseRel, name) : name);
  const frontmatter = input.reviewAt ? { review: input.reviewAt } : undefined;
  fs.writeFileSync(abs(owner, relPath), serializeNote({ id, body: input.body ?? '', frontmatter }));
  const note = (await scanFile(db, owner, relPath))!;
  if (input.labels?.length) {
    await setNoteLabels(db, owner, id, input.labels);
    return (await getNote(db, owner, id))!;
  }
  return note;
}

// Editing the title renames the file on disk (identity is the frontmatter id, so
// links survive). Body is rewritten in place; extra frontmatter is preserved.
export async function updateNote(
  db: DB,
  owner: string,
  id: string,
  patch: {
    title?: string;
    body?: string;
    folderId?: string | null;
    reviewAt?: string | null;
    labels?: string[];
  },
): Promise<NoteJson | null> {
  const row = await db
    .selectFrom('notes')
    .selectAll()
    .where('id', '=', id)
    .where('owner_id', '=', owner)
    .executeTakeFirst();
  if (!row || row.tombstoned) return null;
  const oldRel = row.path;
  const parsed = parseNote(fs.readFileSync(abs(owner, oldRel), 'utf8'));
  const body = patch.body ?? parsed.body;
  const wantName =
    patch.title !== undefined ? sanitizeName(patch.title) : path.basename(oldRel, '.md');
  // a folderId change moves the file into that folder's dir (default: keep current dir)
  let baseRel = path.dirname(oldRel);
  if (baseRel === '.') baseRel = '';
  if (patch.folderId !== undefined) baseRel = await folderBaseRel(db, owner, patch.folderId);
  const newRel = uniqueFile(owner, baseRel ? path.join(baseRel, wantName) : wantName, oldRel);
  // preserve extra frontmatter; review: is its own key (set/kept/cleared via reviewAt)
  const fm: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.frontmatter)) if (k !== 'review') fm[k] = v;
  const review = patch.reviewAt !== undefined ? patch.reviewAt : parsed.frontmatter.review || null;
  if (review) fm.review = review;
  const content = serializeNote({ id, body, frontmatter: fm });
  // Write content in place, then atomically rename — so a crash never leaves two
  // files sharing one frontmatter id (the old write-new + unlink-old window).
  fs.writeFileSync(abs(owner, oldRel), content);
  if (newRel !== oldRel) fs.renameSync(abs(owner, oldRel), abs(owner, newRel));
  const note = await scanFile(db, owner, newRel);
  if (patch.labels !== undefined) {
    await setNoteLabels(db, owner, id, patch.labels);
    return getNote(db, owner, id);
  }
  return note;
}

export async function deleteNote(db: DB, owner: string, id: string): Promise<boolean> {
  const row = await db
    .selectFrom('notes')
    .selectAll()
    .where('id', '=', id)
    .where('owner_id', '=', owner)
    .executeTakeFirst();
  if (!row) return false;
  try {
    fs.unlinkSync(abs(owner, row.path));
  } catch {
    /* already gone — tombstone anyway */
  }
  await db
    .updateTable('notes')
    .set({ tombstoned: 1, updated_at: new Date().toISOString() })
    .where('id', '=', id)
    .execute();
  await sql`DELETE FROM notes_fts WHERE note_id = ${id}`.execute(db);
  await db
    .deleteFrom('note_links')
    .where('owner_id', '=', owner)
    .where('origin_note_id', '=', id)
    .execute();
  return true;
}

// One-time, idempotent migration to the per-owner vault layout: move any legacy
// flat file (vault/<path>) into its owner's subdir (vault/<owner_id>/<path>), based
// on the DB rows. Re-runs are no-ops once files live under their owner. Run at boot.
export async function migrateVaultLayout(db: DB): Promise<number> {
  const base = vaultBase();
  const rows = await db
    .selectFrom('notes')
    .select(['owner_id', 'path'])
    .where('tombstoned', '=', 0)
    .execute();
  let moved = 0;
  for (const r of rows) {
    const flat = path.join(base, r.path); // legacy location
    const dest = path.join(base, r.owner_id, r.path);
    if (flat === dest) continue;
    try {
      if (fs.existsSync(flat) && !fs.existsSync(dest)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(flat, dest);
        moved++;
      }
    } catch {
      /* skip a file we can't move; a later scan tombstones it if truly gone */
    }
  }
  return moved;
}

// ---- reads -----------------------------------------------------------------
export async function getNote(db: DB, owner: string, id: string): Promise<NoteJson | null> {
  const row = await db
    .selectFrom('notes')
    .selectAll()
    .where('id', '=', id)
    .where('owner_id', '=', owner)
    .executeTakeFirst();
  if (!row || row.tombstoned) return null;
  let body = '';
  try {
    body = parseNote(fs.readFileSync(abs(owner, row.path), 'utf8')).body;
  } catch {
    /* file vanished out from under us — return empty body */
  }
  return rowToNote(row, body, await loadNoteLabels(db, id));
}

export interface NoteListItem {
  id: string;
  path: string;
  title: string;
  mtime: string;
  updatedAt: string;
  folderId: string | null;
  readableId: string | null;
}
export async function listNotes(db: DB, owner: string): Promise<NoteListItem[]> {
  const rows = await db
    .selectFrom('notes')
    .selectAll()
    .where('owner_id', '=', owner)
    .where('tombstoned', '=', 0)
    .orderBy('updated_at', 'desc')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    title: r.title,
    mtime: r.mtime,
    updatedAt: r.updated_at,
    folderId: r.folder_id,
    readableId: r.readable_id,
  }));
}

export interface NoteSearchHit {
  id: string;
  title: string;
  snippet: string;
}
// Every live note's title + body straight from the FTS index — no per-file disk reads.
// The unified query uses this to evaluate predicates in memory (the body is already
// duplicated in notes_fts), so only the notes that actually MATCH get read from disk to
// build the full entity. (Evaluation sees the indexed body; a not-yet-synced external
// edit reconciles on the next sync, same as the rest of the index.)
export interface NoteForQuery {
  id: string;
  title: string;
  body: string;
  reviewAt: string | null;
  createdAt: string;
  updatedAt: string;
  folderId: string | null;
}
export async function notesForQuery(db: DB, owner: string): Promise<NoteForQuery[]> {
  // title+body from the FTS index, dates from the notes row (for due:review / created: / edited:)
  const res = await sql<NoteForQuery>`
    SELECT f.note_id AS id, f.title, f.body,
           n.review_at AS "reviewAt", n.created_at AS "createdAt", n.updated_at AS "updatedAt",
           n.folder_id AS "folderId"
    FROM notes_fts f JOIN notes n ON n.id = f.note_id
    WHERE f.owner_id = ${owner} AND n.tombstoned = 0`.execute(db);
  return res.rows;
}

export async function searchNotes(db: DB, owner: string, q: string): Promise<NoteSearchHit[]> {
  const match = ftsQuery(q);
  if (!match) return [];
  const res = await sql<{ id: string; title: string; snippet: string }>`
    SELECT note_id AS id, title,
           snippet(notes_fts, 3, '[', ']', '…', 12) AS snippet
    FROM notes_fts
    WHERE owner_id = ${owner} AND notes_fts MATCH ${match}
    LIMIT 50`.execute(db);
  return res.rows;
}
