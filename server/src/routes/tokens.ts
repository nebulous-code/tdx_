// routes/tokens.ts — API token (PAT) management. Create/revoke require write
// scope (a read-only PAT cannot mint or revoke tokens); listing is a read.

import type { FastifyInstance } from 'fastify';
import { createToken, listTokens, revokeToken } from '../tokens.js';

export default async function tokenRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/tokens', { preHandler: app.requireWrite }, async (request, reply) => {
    const body = (request.body ?? {}) as { name?: unknown; scopes?: unknown };
    const name = String(body.name ?? '').trim();
    if (!name) return reply.code(400).send({ error: 'name is required', field: 'name' });
    const scopes =
      Array.isArray(body.scopes) && body.scopes.length ? body.scopes.map(String) : ['*'];
    const { id, token } = await createToken(app.db, request.user!.id, name, scopes);
    return reply.code(201).send({ id, name, scopes, token }); // token shown once
  });

  app.get('/api/auth/tokens', { preHandler: app.authenticate }, async (request) => {
    return listTokens(app.db, request.user!.id);
  });

  app.delete('/api/auth/tokens/:id', { preHandler: app.requireWrite }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = await revokeToken(app.db, request.user!.id, id);
    if (!ok) return reply.code(404).send({ error: 'token not found' });
    return reply.code(204).send();
  });
}
