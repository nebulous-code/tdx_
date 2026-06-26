// routes/events.ts — event CRUD + the calendar range read. Mirrors routes/tasks.ts.
// Events are owner-only. Writes need write scope + write access and honor If-Match.

import type { FastifyInstance } from 'fastify';
import {
  EventCreateSchema,
  EventRangeQuerySchema,
  EventRangeResponseSchema,
  EventUpdateSchema,
} from '../schemas.js';
import { PreconditionFailed, etag } from '../services/concurrency.js';
import {
  archiveEvent,
  createEvent,
  eventsInRange,
  getEvent,
  updateEvent,
} from '../services/events.js';
import { denyAccess, ifMatchOf } from './_access.js';

export default async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/events',
    { preHandler: app.requireWrite, schema: { body: EventCreateSchema } },
    async (request, reply) => {
      const event = await createEvent(
        app.db,
        request.user!.id,
        request.body as Parameters<typeof createEvent>[2],
      );
      return reply.code(201).header('etag', etag(event.updatedAt)).send(event);
    },
  );

  // calendar range read (owner-scoped) — recurring events expanded into occurrences
  app.get(
    '/api/events',
    {
      preHandler: app.authenticate,
      schema: { querystring: EventRangeQuerySchema, response: { 200: EventRangeResponseSchema } },
    },
    async (request) => {
      const { from, to } = request.query as { from: string; to: string };
      return { occurrences: await eventsInRange(app.db, request.user!.id, from, to) };
    },
  );

  app.get('/api/events/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (await denyAccess(app, request, reply, 'event', id, 'read')) return;
    const event = await getEvent(app.db, request.user!.id, id);
    if (!event) return reply.code(404).send({ error: 'not found' });
    return reply.header('etag', etag(event.updatedAt)).send(event);
  });

  app.put(
    '/api/events/:id',
    { preHandler: app.requireWrite, schema: { body: EventUpdateSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'event', id, 'write')) return;
      try {
        const event = await updateEvent(
          app.db,
          request.user!.id,
          id,
          request.body as Parameters<typeof updateEvent>[3],
          ifMatchOf(request),
        );
        if (!event) return reply.code(404).send({ error: 'not found' });
        return reply.header('etag', etag(event.updatedAt)).send(event);
      } catch (err) {
        if (err instanceof PreconditionFailed) {
          return reply
            .code(412)
            .send({ error: 'stale', current: await getEvent(app.db, request.user!.id, id) });
        }
        throw err;
      }
    },
  );

  app.delete('/api/events/:id', { preHandler: app.requireWrite }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (await denyAccess(app, request, reply, 'event', id, 'write')) return;
    await archiveEvent(app.db, request.user!.id, id);
    return reply.code(204).send();
  });
}
