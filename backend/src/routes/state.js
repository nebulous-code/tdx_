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
  fastify.get('/api/state', async () => {
    return readState();
  });

  fastify.put('/api/state', async (request, reply) => {
    const snapshot = request.body || {};
    // Prefer the If-Match header; fall back to a body field for convenience.
    const ifMatch = request.headers['if-match'];
    const expectedVersion =
      ifMatch != null ? ifMatch : snapshot.version != null ? snapshot.version : null;

    try {
      const { version } = writeState(snapshot, expectedVersion);
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
