// routes/notes.ts — the note domain (D2 §4). Notes are file-backed and owner-only.
// Mutations own the .md file (write then scan); reads pull the body from disk.
// `sync` (increment 2) drives a vault scan for externally-edited files.

import { Type } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import {
  ArchivedListSchema,
  ErrorSchema,
  IdParamSchema,
  IdRefParamSchema,
  IgnorePreviewBodySchema,
  IgnorePreviewSchema,
  IgnoreRulesSchema,
  NoteCreateSchema,
  NoteHistorySchema,
  NoteListSchema,
  NoteRestoreBodySchema,
  NoteSchema,
  NoteSearchQuerySchema,
  NoteSearchResponseSchema,
  NoteSyncQuerySchema,
  NoteSyncResponseSchema,
  NoteUpdateSchema,
  NoteVersionSchema,
} from '../schemas.js';
import {
  createNote,
  deleteNote,
  getNote,
  listArchived,
  listNotes,
  noteRelPath,
  purgeNote,
  restoreNoteVersion,
  scanVault,
  searchNotes,
  unarchiveNote,
  updateNote,
} from '../services/notes.js';
import { previewIgnore, readIgnoreRulesForOwner, writeIgnoreRules } from '../services/vault-settings.js';
import { denyAccess } from './_access.js';

export default async function noteRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/notes',
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Create a note',
        description:
          'Create a markdown note (writes the `.md` file, then indexes it). Requires **write** scope.',
        tags: ['Notes'],
        body: NoteCreateSchema,
        response: { 201: NoteSchema, 400: ErrorSchema },
      },
    },
    async (request, reply) => {
      const note = await createNote(
        app.db,
        request.user!.id,
        request.body as Parameters<typeof createNote>[2],
      );
      app.vaultGit.scheduleSnapshot(); // debounced commit-on-save (no-op unless backups enabled)
      return reply.code(201).send(note);
    },
  );

  app.get(
    '/api/notes',
    {
      preHandler: app.authenticate,
      schema: {
        summary: 'List notes',
        description:
          'All notes for the user (list projection — `body` is fetched via GET /api/notes/:id).',
        tags: ['Notes'],
        response: { 200: NoteListSchema },
      },
    },
    async (request) => listNotes(app.db, request.user!.id),
  );

  // reconcile the DB shadow with the vault (external nvim/Obsidian edits): the
  // sync button / window-focus / nightly trigger. incremental (default) | full.
  app.post(
    '/api/notes/sync',
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Sync the vault',
        description:
          'Reconcile the DB index with the on-disk vault after external edits (nvim/Obsidian). ' +
          '`mode=incremental` (default) only rescans changed files; `mode=full` rescans everything. ' +
          'Requires **write** scope. Returns counts of scanned/updated/tombstoned notes.',
        tags: ['Notes'],
        querystring: NoteSyncQuerySchema,
        response: { 200: NoteSyncResponseSchema },
      },
    },
    async (request) => {
      const { mode } = request.query as { mode?: 'incremental' | 'full' };
      const summary = await scanVault(app.db, request.user!.id, mode ?? 'incremental');
      app.vaultGit.scheduleSnapshot(); // capture externally-edited files just reconciled
      return summary;
    },
  );

  // static route — registered before :id, and Fastify's router prefers it anyway
  app.get(
    '/api/notes/search',
    {
      preHandler: app.authenticate,
      schema: {
        summary: 'Search notes',
        description:
          'Full-text search over note titles + bodies. Returns hits with a highlighted snippet.',
        tags: ['Notes'],
        querystring: NoteSearchQuerySchema,
        response: { 200: NoteSearchResponseSchema },
      },
    },
    async (request) => searchNotes(app.db, request.user!.id, (request.query as { q: string }).q),
  );

  // archived (soft-deleted) notes — Feature B review list. Static, registered before :id.
  app.get(
    '/api/notes/archived',
    {
      preHandler: app.authenticate,
      schema: {
        summary: 'List archived notes',
        description:
          'Soft-deleted (tombstoned) notes — recoverable from git history. Backs the archive review screen.',
        tags: ['Notes'],
        response: { 200: ArchivedListSchema },
      },
    },
    async (request) => listArchived(app.db, request.user!.id),
  );

  // Feature C — configurable backup ignore rules (extra globs + a size threshold).
  app.get(
    '/api/notes/vault/ignore-rules',
    {
      preHandler: app.authenticate,
      schema: {
        summary: 'Get vault ignore rules',
        description: 'The user-configured backup ignore globs + size threshold (on top of the fixed cruft list).',
        tags: ['Notes'],
        response: { 200: IgnoreRulesSchema },
      },
    },
    async () => readIgnoreRulesForOwner(app),
  );

  app.put(
    '/api/notes/vault/ignore-rules',
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Set vault ignore rules',
        description:
          'Persist extra ignore globs + a max file size and rewrite the repo exclude so it applies on the next snapshot. Requires **write** scope.',
        tags: ['Notes'],
        body: IgnoreRulesSchema,
        response: { 200: IgnoreRulesSchema, 400: ErrorSchema },
      },
    },
    async (request) => writeIgnoreRules(app, request.body as { globs: string[]; maxBytes: number | null }),
  );

  app.post(
    '/api/notes/vault/ignore-preview',
    {
      preHandler: app.authenticate,
      schema: {
        summary: 'Preview vault ignore rules',
        description: 'Dry run — the vault paths the proposed rules would exclude from the backup. No writes.',
        tags: ['Notes'],
        body: IgnorePreviewBodySchema,
        response: { 200: IgnorePreviewSchema },
      },
    },
    async (request) =>
      previewIgnore(request.user!.id, request.body as { globs: string[]; maxBytes: number | null }),
  );

  app.get(
    '/api/notes/:id',
    {
      preHandler: app.authenticate,
      schema: {
        summary: 'Get a note',
        description: 'Fetch a single note including its `body` (read live from the vault file).',
        tags: ['Notes'],
        params: IdParamSchema,
        response: { 200: NoteSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'note', id, 'read')) return;
      const note = await getNote(app.db, request.user!.id, id);
      if (!note) return reply.code(404).send({ error: 'not found' });
      return reply.send(note);
    },
  );

  app.put(
    '/api/notes/:id',
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Update a note',
        description: 'Partial update (rewrites the `.md` file). Requires **write** scope.',
        tags: ['Notes'],
        params: IdParamSchema,
        body: NoteUpdateSchema,
        response: { 200: NoteSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'note', id, 'write')) return;
      const note = await updateNote(
        app.db,
        request.user!.id,
        id,
        request.body as Parameters<typeof updateNote>[3],
      );
      if (!note) return reply.code(404).send({ error: 'not found' });
      app.vaultGit.scheduleSnapshot(); // debounced commit-on-save
      return reply.send(note);
    },
  );

  app.delete(
    '/api/notes/:id',
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Delete a note',
        description:
          'Delete the note and its `.md` file. Requires **write** scope. 204 on success.',
        tags: ['Notes'],
        params: IdParamSchema,
        response: { 204: Type.Null(), 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'note', id, 'write')) return;
      await deleteNote(app.db, request.user!.id, id);
      app.vaultGit.scheduleSnapshot(); // debounced commit-on-save
      return reply.code(204).send();
    },
  );

  // ---- Feature A: version history + restore ---------------------------------
  app.get(
    '/api/notes/:id/history',
    {
      preHandler: app.authenticate,
      schema: {
        summary: 'Note version history',
        description: "The note's past versions (snapshot commits that touched its file), newest first.",
        tags: ['Notes'],
        params: IdParamSchema,
        response: { 200: NoteHistorySchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'note', id, 'read')) return;
      const relPath = await noteRelPath(app.db, request.user!.id, id);
      if (!relPath) return reply.code(404).send({ error: 'not found' });
      return app.vaultGit.history(request.user!.id, relPath);
    },
  );

  app.get(
    '/api/notes/:id/history/:ref',
    {
      preHandler: app.authenticate,
      schema: {
        summary: 'Get a past version',
        description: 'The note markdown as of a given version ref (the client renders the diff vs current).',
        tags: ['Notes'],
        params: IdRefParamSchema,
        response: { 200: NoteVersionSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { id, ref } = request.params as { id: string; ref: string };
      if (await denyAccess(app, request, reply, 'note', id, 'read')) return;
      const relPath = await noteRelPath(app.db, request.user!.id, id);
      if (!relPath) return reply.code(404).send({ error: 'not found' });
      try {
        return { text: await app.vaultGit.versionText(request.user!.id, relPath, ref) };
      } catch {
        return reply.code(404).send({ error: 'version not found' });
      }
    },
  );

  app.post(
    '/api/notes/:id/restore',
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Restore a past version',
        description: 'Roll the note back to a version — lands as a new commit on top (reversible). Requires **write** scope.',
        tags: ['Notes'],
        params: IdParamSchema,
        body: NoteRestoreBodySchema,
        response: { 200: NoteSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'note', id, 'write')) return;
      if (!app.vaultGit.enabled()) return reply.code(409).send({ error: 'vault backups are disabled' });
      try {
        const note = await restoreNoteVersion(
          app.db,
          app.vaultGit,
          request.user!.id,
          id,
          (request.body as { ref: string }).ref,
        );
        if (!note) return reply.code(404).send({ error: 'not found' });
        return reply.send(note);
      } catch {
        return reply.code(404).send({ error: 'version not found' });
      }
    },
  );

  // ---- Feature B: unarchive + permanent delete ------------------------------
  // These act on TOMBSTONED notes, which accessLevel treats as invisible (denyAccess would
  // 404) — so ownership is enforced by the service's owner-scoped query (null → 404) instead.
  app.post(
    '/api/notes/:id/unarchive',
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Restore an archived note',
        description: 'Bring a soft-deleted note back (restores its most recent version). Requires **write** scope.',
        tags: ['Notes'],
        params: IdParamSchema,
        response: { 200: NoteSchema, 404: ErrorSchema, 409: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!app.vaultGit.enabled()) return reply.code(409).send({ error: 'vault backups are disabled' });
      const note = await unarchiveNote(app.db, app.vaultGit, request.user!.id, id);
      if (!note) return reply.code(404).send({ error: 'not found' });
      return reply.send(note);
    },
  );

  app.delete(
    '/api/notes/:id/permanent',
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Permanently delete a note',
        description:
          'Obliterate every version of the note from git history + hard-delete the record. Irreversible; the note must be archived first. Requires **write** scope.',
        tags: ['Notes'],
        params: IdParamSchema,
        response: { 204: Type.Null(), 404: ErrorSchema, 409: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const relPath = await noteRelPath(app.db, request.user!.id, id);
      if (!relPath) return reply.code(404).send({ error: 'not found' });
      // permanent-delete follows archive: refuse a live note so the two-step is structural
      const live = await getNote(app.db, request.user!.id, id);
      if (live) return reply.code(409).send({ error: 'archive the note before deleting it permanently' });
      await purgeNote(app.db, app.vaultGit, request.user!.id, id);
      return reply.code(204).send();
    },
  );
}
