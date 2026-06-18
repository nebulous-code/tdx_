// routes/tasks.ts — task CRUD. Reads need access read; writes need write scope +
// write access. Tasks/projects carry updated_at, so writes honor If-Match (stale
// → 412 with the current entity). Request bodies are TypeBox-validated; responses
// are built by the shared mappers (validated by the bootstrap/query schemas).

import type { FastifyInstance } from 'fastify';
import { accessLevel, denyStatus } from '../authz.js';
import { AssignSchema, TaskCreateSchema, TaskUpdateSchema } from '../schemas.js';
import { PreconditionFailed, etag } from '../services/concurrency.js';
import { completeTask } from '../services/recurrence.js';
import { archiveTask, assignTask, createTask, getTask, updateTask } from '../services/tasks.js';
import { denyAccess, ifMatchOf } from './_access.js';

export default async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/tasks',
    { preHandler: app.requireWrite, schema: { body: TaskCreateSchema } },
    async (request, reply) => {
      const body = request.body as { projectId?: string | null };
      if (body.projectId) {
        const status = denyStatus(
          await accessLevel(app.db, request.user!, 'project', body.projectId),
          'write',
        );
        if (status)
          return reply.code(status).send({ error: status === 404 ? 'not found' : 'forbidden' });
      }
      const task = await createTask(
        app.db,
        request.user!.id,
        request.body as Parameters<typeof createTask>[2],
      );
      return reply.code(201).header('etag', etag(task.updatedAt)).send(task);
    },
  );

  app.get('/api/tasks/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (await denyAccess(app, request, reply, 'task', id, 'read')) return;
    const task = await getTask(app.db, id);
    if (!task) return reply.code(404).send({ error: 'not found' });
    return reply.header('etag', etag(task.updatedAt)).send(task);
  });

  app.put(
    '/api/tasks/:id',
    { preHandler: app.requireWrite, schema: { body: TaskUpdateSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'task', id, 'write')) return;
      try {
        const task = await updateTask(
          app.db,
          id,
          request.body as Parameters<typeof updateTask>[2],
          ifMatchOf(request),
        );
        if (!task) return reply.code(404).send({ error: 'not found' });
        return reply.header('etag', etag(task.updatedAt)).send(task);
      } catch (err) {
        if (err instanceof PreconditionFailed) {
          return reply.code(412).send({ error: 'stale', current: await getTask(app.db, id) });
        }
        throw err;
      }
    },
  );

  app.delete('/api/tasks/:id', { preHandler: app.requireWrite }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (await denyAccess(app, request, reply, 'task', id, 'write')) return;
    await archiveTask(app.db, id);
    return reply.code(204).send();
  });

  // complete: marks done and, if recurring, spawns the next occurrence + a fresh
  // unchecked subtask subtree. Returns { task, created }.
  app.post('/api/tasks/:id/complete', { preHandler: app.requireWrite }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (await denyAccess(app, request, reply, 'task', id, 'write')) return;
    const result = await completeTask(app.db, id);
    if (!result) return reply.code(404).send({ error: 'not found' });
    return result;
  });

  app.post(
    '/api/tasks/:id/assign',
    { preHandler: app.requireWrite, schema: { body: AssignSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await denyAccess(app, request, reply, 'task', id, 'write')) return;
      const { assigneeId } = request.body as { assigneeId: string | null };
      const result = await assignTask(app.db, id, assigneeId);
      if (result === 'badAssignee')
        return reply.code(400).send({ error: 'assignee does not exist', field: 'assigneeId' });
      if (!result) return reply.code(404).send({ error: 'not found' });
      return result;
    },
  );
}
