// routes/state.js — the snapshot endpoints.
//
//   GET /api/state            -> full snapshot + version
//   PUT /api/state            -> replace state; optimistic concurrency via If-Match
//
// The client sends `If-Match: <version>` on PUT. If it doesn't match the server's
// current version we return 409 + the current server state so the client can
// resync instead of silently clobbering another device's changes.

const { readState, writeState, ConflictError } = require('../state');

async function routes(fastify) {
  fastify.get('/api/state', { preHandler: fastify.authenticate }, async (request) => {
    return readState(request.user.id);
  });

  fastify.put('/api/state', { preHandler: fastify.authenticate }, async (request, reply) => {
    const snapshot = request.body || {};
    // Prefer the version carried in the body — unlike the conditional `If-Match`
    // header, it survives proxies (e.g. a TLS front-end) that may drop or rewrite
    // conditional request headers. Fall back to the header for older clients.
    const ifMatch = request.headers['if-match'];
    const expectedVersion =
      snapshot.version != null ? snapshot.version : ifMatch != null ? ifMatch : null;

    try {
      const { version } = writeState(request.user.id, snapshot, expectedVersion);
      return { version };
    } catch (err) {
      if (err instanceof ConflictError) {
        reply.code(409);
        return err.currentState; // current server snapshot, so the client can resync
      }
      throw err;
    }
  });
}

module.exports = routes;
