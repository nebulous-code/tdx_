// routes/labels.ts — label CRUD + merge. No updated_at → writes are unconditional.

import type { FastifyInstance } from 'fastify';
import { LabelCreateSchema, LabelMergeSchema, LabelUpdateSchema } from '../schemas.js';
import {
  createLabel,
  deleteLabel,
  getLabel,
  mergeLabels,
  updateLabel,
} from '../services/labels.js';
import { denyAccess } from './_access.js';

export default async function labelRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/labels',
    { preHandler: app.requireWrite, schema: { body: LabelCreateSchema } },
    async (request, reply) => {
      const label = await createLabel(
        app.db,
        request.user!.id,
        request.body as { name: string; pinned?: boolean },
      );
      return reply.code(201).send(label);
    },
  );

  // static route before the param route so '/api/labels/merge' isn't read as :id
  app.post(
    '/api/labels/merge',
    { preHandler: app.requireWrite, schema: { body: LabelMergeSchema } },
    async (request, reply) => {
      const { from, to } = request.body as { from: string; to: string };
      if (await denyAccess(app, request, reply, 'label', from, 'write')) return;
      if (await denyAccess(app, request, reply, 'label', to, 'write')) return;
      const ok = await mergeLabels(app.db, request.user!.id, from, to);
      if (!ok) return reply.code(400).send({ error: 'cannot merge those labels' });
      return { ok: true };
    },
  );

  app.get('/api/labels/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (await denyAccess(app, request, reply, 'label', id, 'read')) return;
    return getLabel(app.db, id);
  });

  app.put(
    '/api/labels/:id',
    { preHandler: app.requireWrite, schema: { body: LabelUpdateSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'label', id, 'write')) return;
      return updateLabel(app.db, id, request.body as { name?: string; pinned?: boolean });
    },
  );

  app.delete('/api/labels/:id', { preHandler: app.requireWrite }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (await denyAccess(app, request, reply, 'label', id, 'write')) return;
    await deleteLabel(app.db, id);
    return reply.code(204).send();
  });
}
