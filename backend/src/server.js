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
const { authenticate } = require('./auth');
const stateRoutes = require('./routes/state');
const authRoutes = require('./routes/auth');

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
  // `authenticate` preHandler used to guard protected routes.
  fastify.decorate('authenticate', authenticate);

  // API routes (registered before static; the specific /api/* paths take
  // precedence over the static wildcard).
  await fastify.register(authRoutes);
  await fastify.register(stateRoutes);

  // Static frontend. `index: 'index.html'` serves the app at '/'.
  await fastify.register(fastifyStatic, {
    root: FRONTEND_DIR,
    index: 'index.html',
  });

  await fastify.listen({ port: PORT, host: HOST });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
