// state.js — translate between a user's full-state SNAPSHOT and the normalized
// SQLite rows. "Snapshot transport, relational storage", now scoped per user.
//
//   readState(userId)                 -> { projects, tasks, labels, savedQueries, version }
//   writeState(userId, snapshot, ver) -> { version }   (throws ConflictError on stale ver)
//
// Every query is scoped by user_id; the optimistic-concurrency version lives in
// users.state_version (per user). The JSON shape matches what frontend/js/data.js
// expects (labels as an id-array on each task; booleans as real booleans).

const db = require('./db');

// Thrown when the client's expected version doesn't match the server's.
// The route layer turns this into a 409 and returns the current server state.
class ConflictError extends Error {
  constructor(currentState) {
    super('version conflict');
    this.name = 'ConflictError';
    this.currentState = currentState;
  }
}

function getVersion(userId) {
  const row = db.prepare('SELECT state_version FROM users WHERE id = ?').get(userId);
  return row ? row.state_version : 0;
}

// ---- read -----------------------------------------------------------------
function readState(userId) {
  const projects = db
    .prepare('SELECT id, parent_id, name, color, glyph, collapsed FROM projects WHERE user_id = ?')
    .all(userId)
    .map((p) => ({
      id: p.id,
      parentId: p.parent_id,
      name: p.name,
      color: p.color,
      glyph: p.glyph,
      collapsed: !!p.collapsed,
    }));

  // labels per task, gathered in one pass (scoped to the user)
  const labelsByTask = new Map();
  for (const row of db.prepare('SELECT task_id, label_id FROM task_labels WHERE user_id = ?').all(userId)) {
    if (!labelsByTask.has(row.task_id)) labelsByTask.set(row.task_id, []);
    labelsByTask.get(row.task_id).push(row.label_id);
  }

  const tasks = db
    .prepare(
      `SELECT id, project_id, parent_id, title, done, due, reminder,
              recurrence, notes, created_at, completed_at
       FROM tasks WHERE user_id = ?`
    )
    .all(userId)
    .map((t) => ({
      id: t.id,
      projectId: t.project_id,
      parentId: t.parent_id,
      title: t.title,
      done: !!t.done,
      due: t.due,
      reminder: t.reminder,
      labels: labelsByTask.get(t.id) || [],
      recurrence: t.recurrence,
      notes: t.notes || '',
      collapsed: false, // transient view state; not persisted
      createdAt: t.created_at,
      completedAt: t.completed_at,
    }));

  const labels = db
    .prepare('SELECT id, name FROM labels WHERE user_id = ?')
    .all(userId)
    .map((l) => ({ id: l.id, name: l.name }));

  const savedQueries = db
    .prepare('SELECT id, name, glyph, query, system FROM saved_queries WHERE user_id = ?')
    .all(userId)
    .map((s) => ({
      id: s.id,
      name: s.name,
      glyph: s.glyph,
      query: s.query,
      system: !!s.system,
    }));

  return { projects, tasks, labels, savedQueries, version: getVersion(userId) };
}

// ---- write ----------------------------------------------------------------
// Replaces this user's rows to match the snapshot, inside one transaction, after
// checking the per-user version. Hard-delete by design: anything absent from the
// snapshot is gone. Only this user's rows are touched.
function writeState(userId, snapshot, expectedVersion) {
  const current = getVersion(userId);
  // Strict optimistic concurrency: the client MUST supply a version that matches
  // the server's. A missing/non-numeric version is treated as a conflict, never
  // as "force write" — otherwise a stale tab (or a proxy that strips the version)
  // could silently clobber another device's changes.
  const expected = Number(expectedVersion);
  if (!Number.isFinite(expected) || expected !== current) {
    throw new ConflictError(readState(userId));
  }

  const projects = Array.isArray(snapshot.projects) ? snapshot.projects : [];
  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : [];
  const labels = Array.isArray(snapshot.labels) ? snapshot.labels : [];
  const savedQueries = Array.isArray(snapshot.savedQueries) ? snapshot.savedQueries : [];

  const insProject = db.prepare(
    'INSERT INTO projects (user_id, id, parent_id, name, color, glyph, collapsed) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insTask = db.prepare(
    `INSERT INTO tasks (user_id, id, project_id, parent_id, title, done, due, reminder,
                        recurrence, notes, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insLabel = db.prepare('INSERT INTO labels (user_id, id, name) VALUES (?, ?, ?)');
  const insTaskLabel = db.prepare(
    'INSERT OR IGNORE INTO task_labels (user_id, task_id, label_id) VALUES (?, ?, ?)'
  );
  const insSaved = db.prepare(
    'INSERT INTO saved_queries (user_id, id, name, glyph, query, system) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const delTaskLabels = db.prepare('DELETE FROM task_labels WHERE user_id = ?');
  const delTasks = db.prepare('DELETE FROM tasks WHERE user_id = ?');
  const delProjects = db.prepare('DELETE FROM projects WHERE user_id = ?');
  const delLabels = db.prepare('DELETE FROM labels WHERE user_id = ?');
  const delSaved = db.prepare('DELETE FROM saved_queries WHERE user_id = ?');

  const apply = db.transaction(() => {
    // Children first (task_labels FK to tasks/labels), then the rest.
    delTaskLabels.run(userId);
    delTasks.run(userId);
    delProjects.run(userId);
    delLabels.run(userId);
    delSaved.run(userId);

    for (const p of projects) {
      insProject.run(userId, p.id, p.parentId ?? null, p.name, p.color, p.glyph, p.collapsed ? 1 : 0);
    }
    for (const l of labels) {
      insLabel.run(userId, l.id, l.name);
    }
    const knownLabels = new Set(labels.map((l) => l.id));
    for (const t of tasks) {
      insTask.run(
        userId,
        t.id,
        t.projectId ?? null,
        t.parentId ?? null,
        t.title ?? 'untitled',
        t.done ? 1 : 0,
        t.due ?? null,
        t.reminder ?? null,
        t.recurrence ?? null,
        t.notes ?? '',
        t.createdAt ?? new Date().toISOString().slice(0, 10),
        t.completedAt ?? null
      );
      for (const lid of t.labels || []) {
        if (knownLabels.has(lid)) insTaskLabel.run(userId, t.id, lid);
      }
    }
    for (const s of savedQueries) {
      insSaved.run(userId, s.id, s.name, s.glyph, s.query, s.system ? 1 : 0);
    }

    const next = current + 1;
    db.prepare('UPDATE users SET state_version = ?, updated_at = ? WHERE id = ?')
      .run(next, new Date().toISOString(), userId);
    return next;
  });

  const version = apply();
  return { version };
}

module.exports = { readState, writeState, getVersion, ConflictError };
