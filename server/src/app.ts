// app.ts — D1 service. Wires Fastify + TypeBox + OpenAPI/Swagger, the DB + auth
// plugins, and the domain route modules. `buildApp(opts)` accepts an injected DB
// handle so tests run against a fresh in-memory database.

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { type FastifyInstance } from 'fastify';
import { type Backups, createBackups } from './backup.js';
import { type DB, DEFAULT_DB_PATH, type Sqlite, openDatabase } from './db.js';
import { registerAuth } from './plugins/auth.js';
import { registerDb } from './plugins/db.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import backupRoutes from './routes/backup.js';
import bootstrapRoutes from './routes/bootstrap.js';
import calendarRoutes from './routes/calendars.js';
import eventRoutes from './routes/events.js';
import folderRoutes from './routes/folders.js';
import labelRoutes from './routes/labels.js';
import linkRoutes from './routes/links.js';
import noteRoutes from './routes/notes.js';
import projectRoutes from './routes/projects.js';
import queryRoutes from './routes/query.js';
import savedQueryRoutes from './routes/savedQueries.js';
import taskRoutes from './routes/tasks.js';
import tokenRoutes from './routes/tokens.js';
import { ensureDefaultCalendars } from './services/calendars.js';
import { migrateVaultLayout } from './services/notes.js';
import { backfillReadableIds } from './services/readableIds.js';
import { type VaultGit, createVaultGit } from './vault-git.js';

declare module 'fastify' {
  interface FastifyInstance {
    backups: Backups;
    vaultGit: VaultGit;
  }
}

// FRONTEND_DIR is overridable so the compiled image (dist/) can point at the
// right path; the default works for `tsx src/app.ts` in dev.
const FRONTEND_DIR =
  process.env.FRONTEND_DIR ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend');

export interface AppOpts {
  db?: DB;
  sqlite?: Sqlite;
  dbPath?: string;
  logger?: boolean;
  serveFrontend?: boolean; // serve ../../frontend statically (default true)
}

export async function buildApp(opts: AppOpts = {}): Promise<FastifyInstance> {
  const handle =
    opts.db && opts.sqlite
      ? { db: opts.db, sqlite: opts.sqlite }
      : openDatabase(opts.dbPath ?? DEFAULT_DB_PATH);

  const app = Fastify({ logger: opts.logger ?? true }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(fastifySwagger, {
    openapi: { info: { title: 'tdx API', version: '0.0.0', description: 'D1 backend' } },
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  registerDb(app, handle);
  await migrateVaultLayout(handle.db); // one-time: move legacy flat notes into per-owner subdirs
  await ensureDefaultCalendars(handle.db); // one-time: default calendar per user + assign orphan events
  await backfillReadableIds(handle.db); // one-time: assign readable ids to any legacy rows missing one
  await registerAuth(app);
  app.decorate('backups', createBackups(handle.sqlite));
  app.decorate('vaultGit', createVaultGit(handle.sqlite));

  await app.register(authRoutes);
  await app.register(adminRoutes);
  await app.register(tokenRoutes);
  await app.register(bootstrapRoutes);
  await app.register(queryRoutes);
  await app.register(taskRoutes);
  await app.register(eventRoutes);
  await app.register(calendarRoutes);
  await app.register(folderRoutes);
  await app.register(linkRoutes);
  await app.register(noteRoutes);
  await app.register(projectRoutes);
  await app.register(labelRoutes);
  await app.register(savedQueryRoutes);
  await app.register(backupRoutes);

  app.get(
    '/health',
    {
      schema: {
        description: 'Liveness probe',
        response: {
          200: Type.Object({
            status: Type.Literal('ok'),
            service: Type.String(),
            time: Type.String(),
          }),
        },
      },
    },
    async () => ({ status: 'ok' as const, service: 'tdx-server', time: new Date().toISOString() }),
  );

  // Serve the no-build Vue frontend same-origin (so its relative /api/... calls
  // and the session cookie just work). API/docs/health routes are registered
  // above and take precedence over the static wildcard.
  if (opts.serveFrontend ?? true) {
    await app.register(fastifyStatic, { root: FRONTEND_DIR, index: 'index.html' });
  }

  return app;
}

// Run the server when invoked directly; stay importable (no listen) for tests.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const app = await buildApp();
  const port = Number(process.env.PORT || 3002);
  const host = process.env.HOST || '0.0.0.0';
  try {
    await app.listen({ port, host });
    app.backups.init(); // arm the daily backup scheduler (real boot only, not tests)
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
