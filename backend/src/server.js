// server.js — application entry point.
//
// Serves the static frontend AND the JSON API from one origin (so there's no
// CORS), so the whole app is reachable at a single http://host:port.

const path = require('path');
// Load backend/.env if present (in Docker, env comes from compose instead).
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const fastifyCookie = require('@fastify/cookie');

require('./db'); // opens DB, runs migrations
const { authenticate, authenticateAdmin } = require('./auth');
const backup = require('./backup');
const stateRoutes = require('./routes/state');
const authRoutes = require('./routes/auth');
const backupRoutes = require('./routes/backup');
const deleteRoutes = require('./routes/delete');

// Cookie signing needs a stable secret; without it sessions can't be trusted.
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET is not set (see .env / compose.yaml).');
  process.exit(1);
}

const PORT = Number(process.env.PORT || 3000);
// Inside Docker we must listen on 0.0.0.0 to be reachable via the published
// port; the compose file maps it to 127.0.0.1 on the host, and Tailscale Serve
// fronts that. Override with HOST if running bare on a trusted machine.
const HOST = process.env.HOST || '0.0.0.0';

const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend');

async function main() {
  const fastify = Fastify({ logger: true, bodyLimit: 5 * 1024 * 1024 });

  // Cookie support (signed session cookie). Registered first so routes can use it.
  await fastify.register(fastifyCookie, { secret: SESSION_SECRET });
  // `authenticate` / `authenticateAdmin` preHandlers guard protected routes.
  fastify.decorate('authenticate', authenticate);
  fastify.decorate('authenticateAdmin', authenticateAdmin);

  // API routes (registered before static; the specific /api/* paths take
  // precedence over the static wildcard).
  await fastify.register(authRoutes);
  await fastify.register(stateRoutes);
  await fastify.register(backupRoutes);
  await fastify.register(deleteRoutes);

  // Static frontend. `index: 'index.html'` serves the app at '/'.
  await fastify.register(fastifyStatic, {
    root: FRONTEND_DIR,
    index: 'index.html',
  });

  await fastify.listen({ port: PORT, host: HOST });

  // Arm the daily backup scheduler (and run a catch-up if a scheduled run was
  // missed while the container was down). Safe no-op when backups are disabled.
  backup.init();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
