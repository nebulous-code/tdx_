// routes/calendars.ts — calendar CRUD with If-Match concurrency. Owner-only.

import type { FastifyInstance } from 'fastify';
import { CalendarCreateSchema, CalendarUpdateSchema } from '../schemas.js';
import {
  archiveCalendar,
  createCalendar,
  getCalendar,
  updateCalendar,
} from '../services/calendars.js';
import { PreconditionFailed, etag } from '../services/concurrency.js';
import { denyAccess, ifMatchOf } from './_access.js';

export default async function calendarRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/calendars',
    { preHandler: app.requireWrite, schema: { body: CalendarCreateSchema } },
    async (request, reply) => {
      const calendar = await createCalendar(
        app.db,
        request.user!.id,
        request.body as Parameters<typeof createCalendar>[2],
      );
      return reply.code(201).header('etag', etag(calendar.updatedAt)).send(calendar);
    },
  );

  app.get('/api/calendars/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (await denyAccess(app, request, reply, 'calendar', id, 'read')) return;
    const calendar = await getCalendar(app.db, request.user!.id, id);
    if (!calendar) return reply.code(404).send({ error: 'not found' });
    return reply.header('etag', etag(calendar.updatedAt)).send(calendar);
  });

  app.put(
    '/api/calendars/:id',
    { preHandler: app.requireWrite, schema: { body: CalendarUpdateSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'calendar', id, 'write')) return;
      try {
        const calendar = await updateCalendar(
          app.db,
          request.user!.id,
          id,
          request.body as Parameters<typeof updateCalendar>[3],
          ifMatchOf(request),
        );
        if (!calendar) return reply.code(404).send({ error: 'not found' });
        return reply.header('etag', etag(calendar.updatedAt)).send(calendar);
      } catch (err) {
        if (err instanceof PreconditionFailed) {
          return reply
            .code(412)
            .send({ error: 'stale', current: await getCalendar(app.db, request.user!.id, id) });
        }
        throw err;
      }
    },
  );

  app.delete('/api/calendars/:id', { preHandler: app.requireWrite }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (await denyAccess(app, request, reply, 'calendar', id, 'write')) return;
    await archiveCalendar(app.db, request.user!.id, id);
    return reply.code(204).send();
  });
}
