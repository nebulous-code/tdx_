import type { FastifyInstance } from 'fastify';
import type { DB, Sqlite } from '../db.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
    sqlite: Sqlite;
  }
}

// Decorate the root instance with the DB handles so routes/services reach a
// typed Kysely handle via `request.server.db` (child contexts inherit it).
export function registerDb(app: FastifyInstance, handle: { db: DB; sqlite: Sqlite }): void {
  app.decorate('db', handle.db);
  app.decorate('sqlite', handle.sqlite);
}
