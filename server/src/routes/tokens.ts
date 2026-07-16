// routes/tokens.ts — API token (PAT) management. Create/revoke require write
// scope (a read-only PAT cannot mint or revoke tokens); listing is a read.

import { Type } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { ErrorSchema, IdParamSchema } from '../schemas.js';
import { createToken, listTokens, revokeToken } from '../tokens.js';

const TokenCreatedSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    scopes: Type.Array(Type.String()),
    token: Type.String({ description: 'The raw token — shown ONCE and never retrievable again.' }),
  },
  {
    additionalProperties: true,
    description:
      'A freshly minted personal access token. Store `token` now; it is not stored server-side.',
  },
);
const TokenListSchema = Type.Array(Type.Object({}, { additionalProperties: true }), {
  description:
    "The account's tokens (metadata only — the raw token is never returned after creation).",
});

export default async function tokenRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/auth/tokens',
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Create a personal access token',
        description:
          'Mint a PAT for an agent/integration. Requires **write** scope. `scopes` defaults to `["*"]` ' +
          '(full); pass e.g. `["read"]` for a read-only token. The raw `token` is returned **once**.',
        tags: ['Tokens'],
        body: Type.Object(
          {
            name: Type.Optional(Type.String({ description: 'A label for the token.' })),
            scopes: Type.Optional(
              Type.Unknown({ description: 'Array of scope strings; defaults to `["*"]` (full).' }),
            ),
          },
          { additionalProperties: true, examples: [{ name: 'claude-read', scopes: ['read'] }] },
        ),
        response: { 201: TokenCreatedSchema, 400: ErrorSchema },
      },
    },
    async (request, reply) => {
      const body = (request.body ?? {}) as { name?: unknown; scopes?: unknown };
      const name = String(body.name ?? '').trim();
      if (!name) return reply.code(400).send({ error: 'name is required', field: 'name' });
      const scopes =
        Array.isArray(body.scopes) && body.scopes.length ? body.scopes.map(String) : ['*'];
      const { id, token } = await createToken(app.db, request.user!.id, name, scopes);
      return reply.code(201).send({ id, name, scopes, token }); // token shown once
    },
  );

  app.get(
    '/api/auth/tokens',
    {
      preHandler: app.authenticate,
      schema: {
        summary: 'List personal access tokens',
        description: 'Token metadata for the account (never the raw token).',
        tags: ['Tokens'],
        response: { 200: TokenListSchema },
      },
    },
    async (request) => {
      return listTokens(app.db, request.user!.id);
    },
  );

  app.delete(
    '/api/auth/tokens/:id',
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Revoke a personal access token',
        description: 'Revoke a token by id. Requires **write** scope. Returns 204 on success.',
        tags: ['Tokens'],
        params: IdParamSchema,
        response: { 204: Type.Null(), 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const ok = await revokeToken(app.db, request.user!.id, id);
      if (!ok) return reply.code(404).send({ error: 'token not found' });
      return reply.code(204).send();
    },
  );
}
