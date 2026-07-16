// routes/query.ts — POST /api/query: the unified entity query. `type:task,event,note`
// selects which entity types to return (default: task); every other predicate is run by
// the parity-locked `Q` engine across all selected types (see services/unifiedQuery.ts).
// Read scope is sufficient.

import type { FastifyInstance } from 'fastify';
import { ErrorSchema, QueryRequestSchema, QueryResponseSchema } from '../schemas.js';
import { UnknownTypeError, runUnifiedQuery } from '../services/unifiedQuery.js';

export default async function queryRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/query',
    {
      preHandler: app.authenticate,
      schema: {
        summary: 'Run a unified query',
        description:
          'Run a tdx query across tasks/events/notes and get back matching entities. The query is a ' +
          'space-separated set of predicates, e.g. `status:open due:<7d label:urgent`. `type:task,event,note` ' +
          'selects which entity kinds to return (default `task`); `category:`/`project:`/`folder:`/`calendar:` ' +
          'filter by name; `limit`/`offset` paginate. Each result carries a `type` discriminator plus that ' +
          "entity's fields. An unknown `type:` token returns 400.",
        tags: ['Query'],
        body: QueryRequestSchema,
        response: {
          200: QueryResponseSchema,
          400: ErrorSchema, // unknown type: token
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
        all = await runUnifiedQuery(app.db, user.id, user.week_start, query, user.notes_root_name);
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
