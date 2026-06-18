// auth plugin — registers signed cookies and decorates the authentication
// guards. Stage 1 resolves the session cookie only; Bearer/PAT support is added
// in the tokens stage (extends resolveRequestPrincipal).

import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  COOKIE_NAME,
  type ResolvedPrincipal,
  type SessionUser,
  hasScope,
  resolveSession,
} from '../auth.js';
import { resolveBearer } from '../tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
    principal?: ResolvedPrincipal;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    authenticateAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    requireWrite: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  }
}

// Resolve a request to a principal: `Authorization: Bearer <PAT>` first (scoped),
// else the signed session cookie (full scope). Returns null if unauthenticated.
async function resolveRequestPrincipal(request: FastifyRequest): Promise<ResolvedPrincipal | null> {
  const authz = request.headers.authorization;
  if (authz?.startsWith('Bearer ')) {
    return resolveBearer(request.server.db, authz.slice(7).trim());
  }
  const raw = request.cookies?.[COOKIE_NAME];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  const user = await resolveSession(request.server.db, unsigned.value);
  if (!user) return null;
  return { user, scopes: ['*'], full: true };
}

function attach(request: FastifyRequest, principal: ResolvedPrincipal): void {
  request.user = principal.user;
  request.principal = principal;
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set (required for signed session cookies)');
  await app.register(fastifyCookie, { secret });

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = await resolveRequestPrincipal(request);
    if (!principal) return reply.code(401).send({ error: 'unauthorized' });
    attach(request, principal);
  });

  app.decorate('authenticateAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = await resolveRequestPrincipal(request);
    if (!principal) return reply.code(401).send({ error: 'unauthorized' });
    if (!principal.user.is_admin) return reply.code(403).send({ error: 'forbidden' });
    attach(request, principal);
  });

  // For write routes: authenticate, then require the credential carries write
  // scope (read-only PATs are rejected; sessions are full-scope).
  app.decorate('requireWrite', async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = await resolveRequestPrincipal(request);
    if (!principal) return reply.code(401).send({ error: 'unauthorized' });
    if (!hasScope(principal, 'write')) return reply.code(403).send({ error: 'insufficient scope' });
    attach(request, principal);
  });
}

export { resolveRequestPrincipal };
