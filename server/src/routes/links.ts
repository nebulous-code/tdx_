// routes/links.ts — the generic entity-link graph (D2 §3). Create/list/delete
// undirected links between any two linkable entities. Access is enforced per
// endpoint via the shared denyAccess guard; rel validity is enforced by the
// service (canonical alphabetical pair-name). Owner-scoped.

import { Type } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import {
  ErrorSchema,
  IdParamSchema,
  LinkCreateSchema,
  LinkListSchema,
  LinkQuerySchema,
  LinkResolvedSchema,
} from '../schemas.js';
import {
  InvalidLink,
  type LinkType,
  createLink,
  deleteLink,
  getLinksFor,
} from '../services/links.js';
import { denyAccess } from './_access.js';

export default async function linkRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/links',
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Create a link',
        description:
          'Create an undirected link between two entities (task/event/note). Requires **write** scope; ' +
          'both endpoints must be visible to the caller. An invalid pairing returns 400.',
        tags: ['Links'],
        body: LinkCreateSchema,
        response: { 201: LinkResolvedSchema, 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { aType, aId, bType, bId, data } = request.body as {
        aType: LinkType;
        aId: string;
        bType: LinkType;
        bId: string;
        data?: unknown;
      };
      // both endpoints must be visible to the caller (404 invisible / 403 read-only)
      if (await denyAccess(app, request, reply, aType, aId, 'read')) return;
      if (await denyAccess(app, request, reply, bType, bId, 'read')) return;
      try {
        const link = await createLink(
          app.db,
          request.user!.id,
          { type: aType, id: aId },
          { type: bType, id: bId },
          data,
        );
        return reply.code(201).send(link);
      } catch (err) {
        if (err instanceof InvalidLink) return reply.code(400).send({ error: err.message });
        throw err;
      }
    },
  );

  app.get(
    '/api/links',
    {
      preHandler: app.authenticate,
      schema: {
        summary: "List an entity's links",
        description: 'All links attached to the entity identified by `type` + `id`.',
        tags: ['Links'],
        querystring: LinkQuerySchema,
        response: { 200: LinkListSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { type, id } = request.query as { type: LinkType; id: string };
      if (await denyAccess(app, request, reply, type, id, 'read')) return;
      return getLinksFor(app.db, request.user!.id, type, id);
    },
  );

  app.delete(
    '/api/links/:id',
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Delete a link',
        description: 'Requires **write** scope. 204 on success.',
        tags: ['Links'],
        params: IdParamSchema,
        response: { 204: Type.Null() },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await deleteLink(app.db, request.user!.id, id);
      return reply.code(204).send();
    },
  );
}
