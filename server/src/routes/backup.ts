// routes/backup.ts — admin-only scheduled-backup config + actions (port of
// backend/src/routes/backup.js). A backup is the whole DB, so all routes require
// an admin session.

import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { BACKUP_RE } from '../backup.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // 00:00–23:59

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
    dirOk: probe.ok,
    dirError: probe.ok ? null : probe.error,
    backupCount: probe.ok ? probe.count : 0,
  };
}

export default async function backupRoutes(app: FastifyInstance): Promise<void> {
  const admin = { preHandler: app.authenticateAdmin };

  app.get('/api/backups/config', admin, async () => statusPayload(app));

  app.put('/api/backups/config', admin, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const patch: { enabled?: boolean; dir?: string; time_of_day?: string; retention?: number } = {};

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
      if (!TIME_RE.test(t)) return reply.code(400).send({ error: 'time must be HH:MM (24-hour)' });
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
  });

  app.post('/api/backups/run', admin, async (_request, reply) => {
    try {
      const { name } = await app.backups.runBackup();
      return { ok: true, name, ...statusPayload(app) };
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message, ...statusPayload(app) });
    }
  });

  app.get('/api/backups', admin, async () => {
    const cfg = app.backups.getConfig();
    return { dir: cfg.dir, files: app.backups.listBackups(cfg.dir) };
  });

  app.get('/api/backups/browse', admin, async (request, reply) => {
    const q = request.query as { path?: string } | undefined;
    const res = app.backups.browseDir(q?.path);
    if (!res.ok) return reply.code(400).send({ error: res.error, path: res.path });
    return res;
  });

  app.get('/api/backups/:name/download', admin, async (request, reply) => {
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
  });
}
