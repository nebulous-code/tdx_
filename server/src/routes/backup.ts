// routes/backup.ts — admin-only scheduled-backup config + actions (port of
// backend/src/routes/backup.js). A backup is the whole DB, so all routes require
// an admin session.

import fs from 'node:fs';
import path from 'node:path';
import { Type } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { BACKUP_RE } from '../backup.js';
import { ErrorSchema } from '../schemas.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // 00:00–23:59

// Backup routes hand-build their JSON, so responses stay loose (additionalProperties) — the
// point is to document + tag them, not to strip fields off a status payload.
const LooseObj = (description: string) =>
  Type.Object({}, { additionalProperties: true, description });
const StatusSchema = LooseObj(
  'Backup config + health (DB last_* and vault_last_* fields, plus dir probe).',
);

function statusPayload(app: FastifyInstance) {
  const cfg = app.backups.getConfig();
  const probe = app.backups.probeDir(cfg.dir);
  return {
    enabled: !!cfg.enabled,
    dir: cfg.dir,
    time_of_day: cfg.time_of_day,
    retention: cfg.retention,
    last_run_at: cfg.last_run_at,
    last_status: cfg.last_status,
    last_error: cfg.last_error,
    next_run_at: cfg.next_run_at,
    // git-vault backup health — reported independently of the DB backup (012)
    vault_last_status: cfg.vault_last_status,
    vault_last_error: cfg.vault_last_error,
    vault_last_run_at: cfg.vault_last_run_at,
    dirOk: probe.ok,
    dirError: probe.ok ? null : probe.error,
    backupCount: probe.ok ? probe.count : 0,
  };
}

export default async function backupRoutes(app: FastifyInstance): Promise<void> {
  const admin = { preHandler: app.authenticateAdmin };

  app.get(
    '/api/backups/config',
    {
      ...admin,
      schema: {
        summary: 'Get backup config & health',
        description: 'Current backup schedule + DB/vault health. **Admin only.**',
        tags: ['Backups'],
        response: { 200: StatusSchema },
      },
    },
    async () => statusPayload(app),
  );

  app.put(
    '/api/backups/config',
    {
      ...admin,
      schema: {
        summary: 'Update backup config',
        description:
          'Enable/schedule backups (DB **and** vault share one switch). `dir` must be absolute; ' +
          '`time_of_day` is `HH:MM`; `retention` is 1–365. **Admin only.** Invalid values return 400.',
        tags: ['Backups'],
        body: Type.Object(
          {
            enabled: Type.Optional(Type.Boolean()),
            dir: Type.Optional(Type.String()),
            time_of_day: Type.Optional(Type.String()),
            retention: Type.Optional(Type.Integer()),
          },
          {
            additionalProperties: true,
            examples: [{ enabled: true, dir: '/backups', time_of_day: '02:00', retention: 7 }],
          },
        ),
        response: { 200: StatusSchema, 400: ErrorSchema },
      },
    },
    async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const patch: { enabled?: boolean; dir?: string; time_of_day?: string; retention?: number } =
        {};

      if (body.enabled != null) patch.enabled = !!body.enabled;
      if (body.dir != null) {
        const dir = String(body.dir).trim();
        if (!dir.startsWith('/'))
          return reply
            .code(400)
            .send({ error: 'directory must be an absolute path (e.g. /backups)' });
        patch.dir = dir;
      }
      if (body.time_of_day != null) {
        const t = String(body.time_of_day).trim();
        if (!TIME_RE.test(t))
          return reply.code(400).send({ error: 'time must be HH:MM (24-hour)' });
        patch.time_of_day = t;
      }
      if (body.retention != null) {
        const n = Number(body.retention);
        if (!Number.isInteger(n) || n < 1 || n > 365)
          return reply.code(400).send({ error: 'retention must be an integer between 1 and 365' });
        patch.retention = n;
      }

      app.backups.updateConfig(patch);
      return statusPayload(app);
    },
  );

  app.post(
    '/api/backups/run',
    {
      ...admin,
      schema: {
        summary: 'Run a backup now',
        description: 'Trigger an immediate DB snapshot + vault git snapshot. **Admin only.**',
        tags: ['Backups'],
        response: {
          200: LooseObj('The new backup name plus the status payload.'),
          500: ErrorSchema,
        },
      },
    },
    async (_request, reply) => {
      try {
        const { name } = await app.backups.runBackup();
        return { ok: true, name, ...statusPayload(app) };
      } catch (e) {
        return reply.code(500).send({ error: (e as Error).message, ...statusPayload(app) });
      }
    },
  );

  app.get(
    '/api/backups',
    {
      ...admin,
      schema: {
        summary: 'List backup files',
        description: 'The DB snapshot files in the configured backup directory. **Admin only.**',
        tags: ['Backups'],
        response: { 200: LooseObj('`{ dir, files: [{ name, size, mtime }] }`.') },
      },
    },
    async () => {
      const cfg = app.backups.getConfig();
      return { dir: cfg.dir, files: app.backups.listBackups(cfg.dir) };
    },
  );

  app.get(
    '/api/backups/browse',
    {
      ...admin,
      schema: {
        summary: 'Browse the filesystem',
        description: 'Directory picker for choosing a backup location. **Admin only.**',
        tags: ['Backups'],
        querystring: Type.Object({ path: Type.Optional(Type.String()) }),
        response: { 200: LooseObj('Directory listing for the picker.'), 400: ErrorSchema },
      },
    },
    async (request, reply) => {
      const q = request.query as { path?: string } | undefined;
      const res = app.backups.browseDir(q?.path);
      if (!res.ok) return reply.code(400).send({ error: res.error, path: res.path });
      return res;
    },
  );

  app.get(
    '/api/backups/:name/download',
    {
      ...admin,
      schema: {
        summary: 'Download a backup file',
        description: 'Stream a backup `.db` file (octet-stream). **Admin only.**',
        tags: ['Backups'],
        params: Type.Object({
          name: Type.String({ description: 'Backup filename, e.g. tdx-20260715-020000.db' }),
        }),
        response: { 400: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { name } = request.params as { name: string };
      if (!BACKUP_RE.test(name)) return reply.code(400).send({ error: 'invalid backup name' });
      const cfg = app.backups.getConfig();
      const full = path.resolve(cfg.dir, name);
      // defense in depth: the resolved file must sit directly in dir
      if (path.dirname(full) !== path.resolve(cfg.dir))
        return reply.code(400).send({ error: 'invalid path' });
      if (!fs.existsSync(full)) return reply.code(404).send({ error: 'not found' });
      reply.header('Content-Disposition', `attachment; filename="${name}"`);
      reply.type('application/octet-stream');
      return reply.send(fs.createReadStream(full));
    },
  );
}
