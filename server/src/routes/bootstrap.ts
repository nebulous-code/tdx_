// routes/bootstrap.ts — GET /api/bootstrap: the SPA's startup read.

import type { FastifyInstance } from 'fastify';
import { BootstrapSchema } from '../schemas.js';
import { readBootstrap } from '../services/bootstrap.js';

export default async function bootstrapRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/bootstrap',
    {
      preHandler: app.authenticate,
      schema: {
        summary: 'Fetch the whole account',
        description:
          'The SPA startup read: every entity for the authenticated user (projects, calendars, ' +
          'folders, tasks, labels, saved queries) in one payload. Notes/events are fetched separately.',
        tags: ['Bootstrap'],
        response: { 200: BootstrapSchema },
      },
    },
    async (request) => readBootstrap(app.db, request.user!.id),
  );
}
