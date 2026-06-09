// routes/backup.js — admin-only scheduled-backup config + actions.
//
//   GET  /api/backups/config            -> config + status + live writability probe
//   PUT  /api/backups/config            -> { enabled?, dir?, time_of_day?, retention? }
//   POST /api/backups/run               -> run a backup now
//   GET  /api/backups                   -> list existing backup files
//   GET  /api/backups/:name/download    -> download one file
//
// All routes require an admin session (a backup is the whole multi-tenant DB).
// See backend/src/backup.js and docs/BACKUP_DESIGN.md.

const fs = require('fs');
const path = require('path');
const backup = require('../backup');

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;     // 00:00–23:59

// Config + last-run status + a live probe of the target directory.
function statusPayload() {
  const cfg = backup.getConfig();
  const probe = backup.probeDir(cfg.dir);
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

async function routes(fastify) {
  const admin = { preHandler: fastify.authenticateAdmin };

  fastify.get('/api/backups/config', admin, async () => statusPayload());

  fastify.put('/api/backups/config', admin, async (request, reply) => {
    const body = request.body || {};
    const patch = {};

    if (body.enabled != null) patch.enabled = !!body.enabled;

    if (body.dir != null) {
      const dir = String(body.dir).trim();
      if (!dir.startsWith('/')) return reply.code(400).send({ error: 'directory must be an absolute path (e.g. /backups)' });
      patch.dir = dir;
    }
    if (body.time_of_day != null) {
      const t = String(body.time_of_day).trim();
      if (!TIME_RE.test(t)) return reply.code(400).send({ error: 'time must be HH:MM (24-hour)' });
      patch.time_of_day = t;
    }
    if (body.retention != null) {
      const n = Number(body.retention);
      if (!Number.isInteger(n) || n < 1 || n > 365) return reply.code(400).send({ error: 'retention must be an integer between 1 and 365' });
      patch.retention = n;
    }

    backup.updateConfig(patch);
    return statusPayload();
  });

  fastify.post('/api/backups/run', admin, async (_request, reply) => {
    try {
      const { name } = await backup.runBackup();
      return { ok: true, name, ...statusPayload() };
    } catch (e) {
      return reply.code(500).send({ error: e.message, ...statusPayload() });
    }
  });

  fastify.get('/api/backups', admin, async () => {
    const cfg = backup.getConfig();
    return { dir: cfg.dir, files: backup.listBackups(cfg.dir) };
  });

  // Read-only filesystem browser to pick / confirm the backup directory.
  fastify.get('/api/backups/browse', admin, async (request, reply) => {
    const res = backup.browseDir(request.query && request.query.path);
    if (!res.ok) return reply.code(400).send({ error: res.error, path: res.path });
    return res;
  });

  fastify.get('/api/backups/:name/download', admin, async (request, reply) => {
    const name = request.params.name;
    if (!backup.BACKUP_RE.test(name)) return reply.code(400).send({ error: 'invalid backup name' });
    const cfg = backup.getConfig();
    const full = path.resolve(cfg.dir, name);
    // Defense in depth against traversal: the resolved file must sit directly in dir.
    if (path.dirname(full) !== path.resolve(cfg.dir)) return reply.code(400).send({ error: 'invalid path' });
    if (!fs.existsSync(full)) return reply.code(404).send({ error: 'not found' });
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    reply.type('application/octet-stream');
    return reply.send(fs.createReadStream(full));
  });
}

module.exports = routes;
