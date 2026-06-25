// routes/notes.ts — the note domain (D2 §4). Notes are file-backed and owner-only.
// Mutations own the .md file (write then scan); reads pull the body from disk.
// `sync` (increment 2) drives a vault scan for externally-edited files.

import type { FastifyInstance } from 'fastify';
import {
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
      schema: { body: NoteCreateSchema, response: { 201: NoteSchema } },
    },
    async (request, reply) => {
      const note = await createNote(
        app.db,
        request.user!.id,
        request.body as Parameters<typeof createNote>[2],
      );
      return reply.code(201).send(note);
    },
  );

  app.get(
    '/api/notes',
    { preHandler: app.authenticate, schema: { response: { 200: NoteListSchema } } },
    async (request) => listNotes(app.db, request.user!.id),
  );

  // reconcile the DB shadow with the vault (external nvim/Obsidian edits): the
  // sync button / window-focus / nightly trigger. incremental (default) | full.
  app.post(
    '/api/notes/sync',
    {
      preHandler: app.requireWrite,
      schema: { querystring: NoteSyncQuerySchema, response: { 200: NoteSyncResponseSchema } },
    },
    async (request) => {
      const { mode } = request.query as { mode?: 'incremental' | 'full' };
      return scanVault(app.db, request.user!.id, mode ?? 'incremental');
    },
  );

  // static route — registered before :id, and Fastify's router prefers it anyway
  app.get(
    '/api/notes/search',
    {
      preHandler: app.authenticate,
      schema: { querystring: NoteSearchQuerySchema, response: { 200: NoteSearchResponseSchema } },
    },
    async (request) => searchNotes(app.db, request.user!.id, (request.query as { q: string }).q),
  );

  app.get('/api/notes/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (await denyAccess(app, request, reply, 'note', id, 'read')) return;
    const note = await getNote(app.db, id);
    if (!note) return reply.code(404).send({ error: 'not found' });
    return reply.send(note);
  });

  app.put(
    '/api/notes/:id',
    { preHandler: app.requireWrite, schema: { body: NoteUpdateSchema } },
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
      return reply.send(note);
    },
  );

  app.delete('/api/notes/:id', { preHandler: app.requireWrite }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (await denyAccess(app, request, reply, 'note', id, 'write')) return;
    await deleteNote(app.db, request.user!.id, id);
    return reply.code(204).send();
  });
}
