// routes/query.ts — POST /api/query: the unified entity query. `type:task,event,note`
// selects which entity types to return (default: task); every other predicate is run by
// the parity-locked `Q` engine across all selected types (see services/unifiedQuery.ts).
// Read scope is sufficient.

import type { FastifyInstance } from 'fastify';
import { QueryRequestSchema, QueryResponseSchema } from '../schemas.js';
import { runUnifiedQuery } from '../services/unifiedQuery.js';

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
      const all = await runUnifiedQuery(app.db, user.id, user.week_start, query);
      const total = all.length;
      const start = offset ?? 0;
      const items = limit != null ? all.slice(start, start + limit) : all.slice(start);
      return { items, total };
    },
  );
}
