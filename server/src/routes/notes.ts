// routes/notes.ts — the note domain (D2 §4). Notes are file-backed and owner-only.
// Mutations own the .md file (write then scan); reads pull the body from disk.
// `sync` (increment 2) drives a vault scan for externally-edited files.

import { Type } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import {
  ErrorSchema,
  IdParamSchema,
  NoteCreateSchema,
  NoteListSchema,
  NoteSchema,
  NoteSearchQuerySchema,
  NoteSearchResponseSchema,
  NoteSyncQuerySchema,
  NoteSyncResponseSchema,
  NoteUpdateSchema,
} from '../schemas.js';
import {
  createNote,
  deleteNote,
  getNote,
  listNotes,
  scanVault,
  searchNotes,
  updateNote,
} from '../services/notes.js';
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
}
