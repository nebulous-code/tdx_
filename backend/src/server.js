// server.js — application entry point.
//
// Serves the static frontend AND the JSON API from one origin (so there's no
// CORS and the service worker scope is clean), then starts the reminder scheduler.

const path = require('path');
// Load backend/.env if present (in Docker, env comes from compose instead).
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');

require('./db'); // opens DB, runs migrations, seeds first-run defaults
const scheduler = require('./scheduler');
const stateRoutes = require('./routes/state');
const pushRoutes = require('./routes/push');

const PORT = Number(process.env.PORT || 3000);
// Inside Docker we must listen on 0.0.0.0 to be reachable via the published
// port; the compose file maps it to 127.0.0.1 on the host, and Tailscale Serve
// fronts that. Override with HOST if running bare on a trusted machine.
const HOST = process.env.HOST || '0.0.0.0';

const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend');

async function main() {
  const fastify = Fastify({ logger: true, bodyLimit: 5 * 1024 * 1024 });

  // API routes (registered before static; the specific /api/* paths take
  // precedence over the static wildcard).
  await fastify.register(stateRoutes);
  await fastify.register(pushRoutes);

  // Static frontend. `index: 'index.html'` serves the app at '/'.
  await fastify.register(fastifyStatic, {
    root: FRONTEND_DIR,
    index: 'index.html',
  });

  await fastify.listen({ port: PORT, host: HOST });
  scheduler.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
