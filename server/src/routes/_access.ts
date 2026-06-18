// Shared route guard: resolve access and reply 404 (invisible) / 403 (read-only)
// when the action isn't permitted. Returns true if it replied (caller should stop).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type Action, type ResourceType, accessLevel, denyStatus } from '../authz.js';

export async function denyAccess(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  type: ResourceType,
  id: string,
  action: Action,
): Promise<boolean> {
  const status = denyStatus(await accessLevel(app.db, request.user!, type, id), action);
  if (status) {
    reply.code(status).send({ error: status === 404 ? 'not found' : 'forbidden' });
    return true;
  }
  return false;
}

export const ifMatchOf = (request: FastifyRequest): string | undefined => {
  const h = request.headers['if-match'];
  return typeof h === 'string' ? h : undefined;
};
