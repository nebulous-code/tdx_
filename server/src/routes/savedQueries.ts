// routes/savedQueries.ts — saved-query CRUD. No updated_at → unconditional writes.

import { Type } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import {
  ErrorSchema,
  IdParamSchema,
  SavedQueryCreateSchema,
  SavedQuerySchema,
  SavedQueryUpdateSchema,
} from '../schemas.js';
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
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Create a saved query',
        description:
          'Save a named query view (`query` is a tdx query string). Requires **write** scope.',
        tags: ['Saved Queries'],
        body: SavedQueryCreateSchema,
        response: { 201: SavedQuerySchema, 400: ErrorSchema },
      },
    },
    async (request, reply) => {
      const sv = await createSavedQuery(
        app.db,
        request.user!.id,
        request.body as Parameters<typeof createSavedQuery>[2],
      );
      return reply.code(201).send(sv);
    },
  );

  app.get(
    '/api/saved-queries/:id',
    {
      preHandler: app.authenticate,
      schema: {
        summary: 'Get a saved query',
        tags: ['Saved Queries'],
        params: IdParamSchema,
        response: { 200: SavedQuerySchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'saved_query', id, 'read')) return;
      return getSavedQuery(app.db, id);
    },
  );

  app.put(
    '/api/saved-queries/:id',
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Update a saved query',
        description: 'Partial update of a saved view. Requires **write** scope.',
        tags: ['Saved Queries'],
        params: IdParamSchema,
        body: SavedQueryUpdateSchema,
        response: { 200: SavedQuerySchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'saved_query', id, 'write')) return;
      return updateSavedQuery(app.db, id, request.body as Parameters<typeof updateSavedQuery>[2]);
    },
  );

  app.delete(
    '/api/saved-queries/:id',
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Delete a saved query',
        description: 'Requires **write** scope. 204 on success.',
        tags: ['Saved Queries'],
        params: IdParamSchema,
        response: { 204: Type.Null(), 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'saved_query', id, 'write')) return;
      await deleteSavedQuery(app.db, id);
      return reply.code(204).send();
    },
  );
}
