// routes/labels.ts — label CRUD + merge. No updated_at → writes are unconditional.

import { Type } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import {
  ErrorSchema,
  IdParamSchema,
  LabelCreateSchema,
  LabelMergeSchema,
  LabelSchema,
  LabelUpdateSchema,
  OkSchema,
} from '../schemas.js';
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
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Create a label',
        description: 'Create a tag usable across tasks/events/notes. Requires **write** scope.',
        tags: ['Labels'],
        body: LabelCreateSchema,
        response: { 201: LabelSchema, 400: ErrorSchema },
      },
    },
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
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Merge two labels',
        description:
          'Re-point everything tagged `from` onto `to`, then delete `from`. Requires **write** scope.',
        tags: ['Labels'],
        body: LabelMergeSchema,
        response: { 200: OkSchema, 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { from, to } = request.body as { from: string; to: string };
      if (await denyAccess(app, request, reply, 'label', from, 'write')) return;
      if (await denyAccess(app, request, reply, 'label', to, 'write')) return;
      const ok = await mergeLabels(app.db, request.user!.id, from, to);
      if (!ok) return reply.code(400).send({ error: 'cannot merge those labels' });
      return { ok: true };
    },
  );

  app.get(
    '/api/labels/:id',
    {
      preHandler: app.authenticate,
      schema: {
        summary: 'Get a label',
        tags: ['Labels'],
        params: IdParamSchema,
        response: { 200: LabelSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'label', id, 'read')) return;
      return getLabel(app.db, id);
    },
  );

  app.put(
    '/api/labels/:id',
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Update a label',
        description: 'Rename or (un)pin a label. Requires **write** scope.',
        tags: ['Labels'],
        params: IdParamSchema,
        body: LabelUpdateSchema,
        response: { 200: LabelSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'label', id, 'write')) return;
      return updateLabel(app.db, id, request.body as { name?: string; pinned?: boolean });
    },
  );

  app.delete(
    '/api/labels/:id',
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Delete a label',
        description:
          'Delete a label (untags everything). Requires **write** scope. 204 on success.',
        tags: ['Labels'],
        params: IdParamSchema,
        response: { 204: Type.Null(), 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'label', id, 'write')) return;
      await deleteLabel(app.db, id);
      return reply.code(204).send();
    },
  );
}
