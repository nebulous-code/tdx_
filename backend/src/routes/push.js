// routes/push.js — Web Push subscription endpoints.
//
//   GET  /api/push/vapid-public-key  -> { key, configured }
//   POST /api/push/subscribe         -> store this device's push subscription

const push = require('../push');

async function routes(fastify) {
  fastify.get('/api/push/vapid-public-key', async () => {
    return { key: push.publicKey(), configured: push.isConfigured() };
  });

  fastify.post('/api/push/subscribe', async (request, reply) => {
    try {
      push.saveSubscription(request.body);
      reply.code(201);
      return { ok: true };
    } catch (err) {
      reply.code(400);
      return { ok: false, error: err.message };
    }
  });
}

module.exports = routes;
