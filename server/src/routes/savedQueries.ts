// routes/savedQueries.ts — saved-query CRUD. No updated_at → unconditional writes.

import type { FastifyInstance } from 'fastify';
import { SavedQueryCreateSchema, SavedQueryUpdateSchema } from '../schemas.js';
import {
  createSavedQuery,
  deleteSavedQuery,
  getSavedQuery,
  updateSavedQuery,
} from '../services/savedQueries.js';
import { denyAccess } from './_access.js';

export default async function savedQueryRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/saved-queries',
    { preHandler: app.requireWrite, schema: { body: SavedQueryCreateSchema } },
    async (request, reply) => {
      const sv = await createSavedQuery(
        app.db,
        request.user!.id,
        request.body as Parameters<typeof createSavedQuery>[2],
      );
      return reply.code(201).send(sv);
    },
  );

  app.get('/api/saved-queries/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (await denyAccess(app, request, reply, 'saved_query', id, 'read')) return;
    return getSavedQuery(app.db, id);
  });

  app.put(
    '/api/saved-queries/:id',
    { preHandler: app.requireWrite, schema: { body: SavedQueryUpdateSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'saved_query', id, 'write')) return;
      return updateSavedQuery(app.db, id, request.body as Parameters<typeof updateSavedQuery>[2]);
    },
  );

  app.delete('/api/saved-queries/:id', { preHandler: app.requireWrite }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (await denyAccess(app, request, reply, 'saved_query', id, 'write')) return;
    await deleteSavedQuery(app.db, id);
    return reply.code(204).send();
  });
}
