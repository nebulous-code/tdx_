// routes/query.ts — POST /api/query: run the ported query engine server-side
// over the owner's live tasks. Read scope is sufficient.

import type { FastifyInstance } from 'fastify';
import { type Ctx, Q } from '../query.js';
import { QueryRequestSchema, QueryResponseSchema, type TaskJson } from '../schemas.js';
import { readBootstrap } from '../services/bootstrap.js';

export default async function queryRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/query',
    {
      preHandler: app.authenticate,
      schema: { body: QueryRequestSchema, response: { 200: QueryResponseSchema } },
    },
    async (request) => {
      const { query, limit, offset } = request.body as {
        query: string;
        limit?: number;
        offset?: number;
      };
      const user = request.user!;
      const { tasks, projects, labels } = await readBootstrap(app.db, user.id);
      const ctx = { tasks, projects, labels, weekStart: user.week_start } as unknown as Ctx;

      const all = Q.run(query, ctx) as unknown as TaskJson[];
      const total = all.length;
      const start = offset ?? 0;
      const items = limit != null ? all.slice(start, start + limit) : all.slice(start);
      return { items, total };
    },
  );
}
