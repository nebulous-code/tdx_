// routes/folders.ts — folder CRUD with If-Match concurrency. Owner-only.
// Delete only succeeds on an EMPTY folder (no subfolders/notes) → 409 otherwise.

import { Type } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { accessLevel, denyStatus } from '../authz.js';
import {
  ErrorSchema,
  FolderCreateSchema,
  FolderSchema,
  FolderUpdateSchema,
  IdParamSchema,
} from '../schemas.js';
import { PreconditionFailed, etag } from '../services/concurrency.js';
import { createFolder, deleteFolder, getFolder, updateFolder } from '../services/folders.js';
import { denyAccess, ifMatchOf } from './_access.js';

export default async function folderRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/folders',
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Create a folder',
        description:
          'Create a vault folder (a real directory) to group notes. Requires **write** scope. ' +
          'Renaming later moves the directory and its notes.',
        tags: ['Folders'],
        body: FolderCreateSchema,
        response: { 201: FolderSchema, 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const body = request.body as { parentId?: string | null };
      if (body.parentId) {
        const status = denyStatus(
          await accessLevel(app.db, request.user!, 'folder', body.parentId),
          'write',
        );
        if (status)
          return reply.code(status).send({ error: status === 404 ? 'not found' : 'forbidden' });
      }
      const folder = await createFolder(
        app.db,
        request.user!.id,
        request.body as Parameters<typeof createFolder>[2],
      );
      return reply.code(201).header('etag', etag(folder.updatedAt)).send(folder);
    },
  );

  app.get(
    '/api/folders/:id',
    {
      preHandler: app.authenticate,
      schema: {
        summary: 'Get a folder',
        tags: ['Folders'],
        params: IdParamSchema,
        response: { 200: FolderSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'folder', id, 'read')) return;
      const folder = await getFolder(app.db, request.user!.id, id);
      if (!folder) return reply.code(404).send({ error: 'not found' });
      return reply.header('etag', etag(folder.updatedAt)).send(folder);
    },
  );

  app.put(
    '/api/folders/:id',
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Update (or rename/move) a folder',
        description:
          'Partial update. Requires **write** scope. A name change moves the directory and re-paths its ' +
          'notes. Honors `If-Match`; a stale write returns **412** with the current entity under `current`.',
        tags: ['Folders'],
        params: IdParamSchema,
        body: FolderUpdateSchema,
        response: {
          200: FolderSchema,
          400: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          412: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'folder', id, 'write')) return;
      try {
        const folder = await updateFolder(
          app.db,
          request.user!.id,
          id,
          request.body as Parameters<typeof updateFolder>[3],
          ifMatchOf(request),
        );
        if (!folder) return reply.code(404).send({ error: 'not found' });
        return reply.header('etag', etag(folder.updatedAt)).send(folder);
      } catch (err) {
        if (err instanceof PreconditionFailed) {
          return reply
            .code(412)
            .send({ error: 'stale', current: await getFolder(app.db, request.user!.id, id) });
        }
        throw err;
      }
    },
  );

  app.delete(
    '/api/folders/:id',
    {
      preHandler: app.requireWrite,
      schema: {
        summary: 'Delete a folder',
        description:
          'Delete an **empty** folder. Requires **write** scope. A non-empty folder returns **409** — ' +
          'move or delete its contents first. Returns 204 on success.',
        tags: ['Folders'],
        params: IdParamSchema,
        response: { 204: Type.Null(), 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'folder', id, 'write')) return;
      const res = await deleteFolder(app.db, request.user!.id, id);
      if (res === 'not-empty')
        return reply
          .code(409)
          .send({ error: 'folder is not empty (move or delete its contents first)' });
      return reply.code(204).send();
    },
  );
}
