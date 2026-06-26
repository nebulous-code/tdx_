// routes/query.ts — POST /api/query: the unified entity query. `type:task,event,note`
// selects which entity types to return (default: task); every other predicate is run by
// the parity-locked `Q` engine across all selected types (see services/unifiedQuery.ts).
// Read scope is sufficient.

import { Type } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { QueryRequestSchema, QueryResponseSchema } from '../schemas.js';
import { UnknownTypeError, runUnifiedQuery } from '../services/unifiedQuery.js';

export default async function queryRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/query',
    {
      preHandler: app.authenticate,
      schema: {
        body: QueryRequestSchema,
        response: {
          200: QueryResponseSchema,
          400: Type.Object({ error: Type.String() }), // unknown type: token
        },
      },
    },
    async (request, reply) => {
      const { query, limit, offset } = request.body as {
        query: string;
        limit?: number;
        offset?: number;
      };
      const user = request.user!;
      let all: Awaited<ReturnType<typeof runUnifiedQuery>>;
      try {
        all = await runUnifiedQuery(app.db, user.id, user.week_start, query);
      } catch (err) {
        if (err instanceof UnknownTypeError) return reply.code(400).send({ error: err.message });
        throw err;
      }
      const total = all.length;
      const start = offset ?? 0;
      const items = limit != null ? all.slice(start, start + limit) : all.slice(start);
      return { items, total };
    },
  );
}
