// routes/admin.ts — admin-only user creation (replaces tools/add-user.js).

import type { FastifyInstance } from 'fastify';
import { validateEmail, validatePassword, validateUsername } from '../auth.js';
import { createUser } from '../seed.js';

export default async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/admin/users', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const body = (request.body ?? {}) as {
      username?: unknown;
      email?: unknown;
      password?: unknown;
      isAdmin?: unknown;
    };

    const u = validateUsername(body.username);
    if (!u.ok) return reply.code(400).send({ error: u.error, field: 'username' });
    const e = validateEmail(body.email);
    if (!e.ok) return reply.code(400).send({ error: e.error, field: 'email' });
    const p = validatePassword(body.password);
    if (!p.ok) return reply.code(400).send({ error: p.error, field: 'password' });

    const clashU = await app.db
      .selectFrom('users')
      .select('id')
      .where('username', '=', u.value)
      .executeTakeFirst();
    if (clashU)
      return reply.code(409).send({ error: 'username is already taken', field: 'username' });
    const clashE = await app.db
      .selectFrom('users')
      .select('id')
      .where('email', '=', e.value)
      .executeTakeFirst();
    if (clashE) return reply.code(409).send({ error: 'email is already in use', field: 'email' });

    try {
      const created = await createUser(
        app.db,
        { username: u.value, email: e.value, password: p.value },
        { isAdmin: !!body.isAdmin },
      );
      return reply.code(201).send(created);
    } catch (err) {
      if (/UNIQUE/.test((err as Error).message))
        return reply.code(409).send({ error: 'username or email already in use' });
      throw err;
    }
  });
}
