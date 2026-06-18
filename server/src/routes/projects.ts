// routes/projects.ts — project CRUD with If-Match concurrency + archive cascade.

import type { FastifyInstance } from 'fastify';
import { accessLevel, denyStatus } from '../authz.js';
import { ProjectCreateSchema, ProjectUpdateSchema } from '../schemas.js';
import { PreconditionFailed, etag } from '../services/concurrency.js';
import { archiveProject, createProject, getProject, updateProject } from '../services/projects.js';
import { denyAccess, ifMatchOf } from './_access.js';

export default async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/projects',
    { preHandler: app.requireWrite, schema: { body: ProjectCreateSchema } },
    async (request, reply) => {
      const body = request.body as { parentId?: string | null };
      if (body.parentId) {
        const status = denyStatus(
          await accessLevel(app.db, request.user!, 'project', body.parentId),
          'write',
        );
        if (status)
          return reply.code(status).send({ error: status === 404 ? 'not found' : 'forbidden' });
      }
      const project = await createProject(
        app.db,
        request.user!.id,
        request.body as Parameters<typeof createProject>[2],
      );
      return reply.code(201).header('etag', etag(project.updatedAt)).send(project);
    },
  );

  app.get('/api/projects/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (await denyAccess(app, request, reply, 'project', id, 'read')) return;
    const project = await getProject(app.db, id);
    if (!project) return reply.code(404).send({ error: 'not found' });
    return reply.header('etag', etag(project.updatedAt)).send(project);
  });

  app.put(
    '/api/projects/:id',
    { preHandler: app.requireWrite, schema: { body: ProjectUpdateSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'project', id, 'write')) return;
      try {
        const project = await updateProject(
          app.db,
          id,
          request.body as Parameters<typeof updateProject>[2],
          ifMatchOf(request),
        );
        if (!project) return reply.code(404).send({ error: 'not found' });
        return reply.header('etag', etag(project.updatedAt)).send(project);
      } catch (err) {
        if (err instanceof PreconditionFailed) {
          return reply.code(412).send({ error: 'stale', current: await getProject(app.db, id) });
        }
        throw err;
      }
    },
  );

  app.delete('/api/projects/:id', { preHandler: app.requireWrite }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (await denyAccess(app, request, reply, 'project', id, 'write')) return;
    await archiveProject(app.db, id);
    return reply.code(204).send();
  });
}
