// routes/delete.js — soft-delete ("Delete" in the UI, archive on disk).
//
//   POST /api/projects/:id/delete  -> archive a project + its subprojects + their tasks
//   POST /api/tasks/:id/delete     -> archive a task + its subtasks
//
// Soft deletes can't ride the snapshot PUT: writeState now wipes only live rows, so a
// row merely missing from the snapshot would be hard-deleted (and would race the
// client's debounced autosave). These explicit mutations set archived = 1 server-side
// in one transaction, bump the version, and return the fresh (archived-filtered) state
// so the client re-hydrates in a single round-trip. Recovery is DB-only (archived = 1).

const db = require('../db');
const { readState, bumpVersion } = require('../state');

async function routes(fastify) {
  fastify.post('/api/projects/:id/delete', { preHandler: fastify.authenticate }, async (request) => {
    const userId = request.user.id;
    const rootId = request.params.id;
    const archive = db.transaction(() => {
      // collect the project subtree (root + all descendants) by walking parent_id
      const rows = db.prepare('SELECT id, parent_id FROM projects WHERE user_id = ?').all(userId);
      const kids = new Map();
      for (const r of rows) {
        if (!kids.has(r.parent_id)) kids.set(r.parent_id, []);
        kids.get(r.parent_id).push(r.id);
      }
      const subtree = [];
      const stack = [rootId];
      while (stack.length) {
        const id = stack.pop();
        subtree.push(id);
        for (const c of kids.get(id) || []) stack.push(c);
      }
      const ph = subtree.map(() => '?').join(',');
      db.prepare(`UPDATE projects SET archived = 1 WHERE user_id = ? AND id IN (${ph})`).run(userId, ...subtree);
      db.prepare(`UPDATE tasks SET archived = 1 WHERE user_id = ? AND project_id IN (${ph})`).run(userId, ...subtree);
      bumpVersion(userId);
    });
    archive();
    return readState(userId);
  });

  fastify.post('/api/tasks/:id/delete', { preHandler: fastify.authenticate }, async (request) => {
    const userId = request.user.id;
    const rootId = request.params.id;
    const archive = db.transaction(() => {
      // collect the task + all descendant subtasks by walking parent_id
      const rows = db.prepare('SELECT id, parent_id FROM tasks WHERE user_id = ?').all(userId);
      const kids = new Map();
      for (const r of rows) {
        if (!kids.has(r.parent_id)) kids.set(r.parent_id, []);
        kids.get(r.parent_id).push(r.id);
      }
      const subtree = [];
      const stack = [rootId];
      while (stack.length) {
        const id = stack.pop();
        subtree.push(id);
        for (const c of kids.get(id) || []) stack.push(c);
      }
      const ph = subtree.map(() => '?').join(',');
      db.prepare(`UPDATE tasks SET archived = 1 WHERE user_id = ? AND id IN (${ph})`).run(userId, ...subtree);
      bumpVersion(userId);
    });
    archive();
    return readState(userId);
  });
}

module.exports = routes;
