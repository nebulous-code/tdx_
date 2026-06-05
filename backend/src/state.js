// state.js — translate between the client's full-state SNAPSHOT and the
// normalized SQLite rows. This is the heart of the "snapshot transport,
// relational storage" design.
//
//   readState()                 -> { projects, tasks, labels, savedQueries, version }
//   writeState(snapshot, ver)   -> { version }   (throws ConflictError on stale ver)
//
// The JSON shape produced/consumed here matches exactly what the Vue store in
// frontend/js/data.js expects (labels as an id-array on each task; booleans as
// real booleans).

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

function getVersion() {
  return db.prepare('SELECT version FROM meta WHERE id = 1').get().version;
}

// ---- read -----------------------------------------------------------------
function readState() {
  const projects = db
    .prepare('SELECT id, parent_id, name, color, glyph, collapsed FROM projects')
    .all()
    .map((p) => ({
      id: p.id,
      parentId: p.parent_id,
      name: p.name,
      color: p.color,
      glyph: p.glyph,
      collapsed: !!p.collapsed,
    }));

  // labels per task, gathered in one pass
  const labelsByTask = new Map();
  for (const row of db.prepare('SELECT task_id, label_id FROM task_labels').all()) {
    if (!labelsByTask.has(row.task_id)) labelsByTask.set(row.task_id, []);
    labelsByTask.get(row.task_id).push(row.label_id);
  }

  const tasks = db
    .prepare(
      `SELECT id, project_id, parent_id, title, done, due, reminder,
              recurrence, notes, created_at, completed_at
       FROM tasks`
    )
    .all()
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
    .prepare('SELECT id, name FROM labels')
    .all()
    .map((l) => ({ id: l.id, name: l.name }));

  const savedQueries = db
    .prepare('SELECT id, name, glyph, query, system FROM saved_queries')
    .all()
    .map((s) => ({
      id: s.id,
      name: s.name,
      glyph: s.glyph,
      query: s.query,
      system: !!s.system,
    }));

  return { projects, tasks, labels, savedQueries, version: getVersion() };
}

// ---- write ----------------------------------------------------------------
// Replaces every table's rows to match the snapshot, inside one transaction,
// after checking the optimistic-concurrency version. Hard-delete by design:
// anything absent from the snapshot is gone.
function writeState(snapshot, expectedVersion) {
  const current = getVersion();
  // Strict optimistic concurrency: the client MUST supply a version that matches
  // the server's. A missing/non-numeric version is treated as a conflict, never
  // as "force write" — otherwise a stale tab (or a proxy that strips the version)
  // could silently clobber another device's changes.
  const expected = Number(expectedVersion);
  if (!Number.isFinite(expected) || expected !== current) {
    throw new ConflictError(readState());
  }

  const projects = Array.isArray(snapshot.projects) ? snapshot.projects : [];
  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : [];
  const labels = Array.isArray(snapshot.labels) ? snapshot.labels : [];
  const savedQueries = Array.isArray(snapshot.savedQueries) ? snapshot.savedQueries : [];

  const insProject = db.prepare(
    'INSERT INTO projects (id, parent_id, name, color, glyph, collapsed) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insTask = db.prepare(
    `INSERT INTO tasks (id, project_id, parent_id, title, done, due, reminder,
                        recurrence, notes, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insLabel = db.prepare('INSERT INTO labels (id, name) VALUES (?, ?)');
  const insTaskLabel = db.prepare(
    'INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)'
  );
  const insSaved = db.prepare(
    'INSERT INTO saved_queries (id, name, glyph, query, system) VALUES (?, ?, ?, ?, ?)'
  );

  const apply = db.transaction(() => {
    db.exec(
      'DELETE FROM task_labels; DELETE FROM tasks; DELETE FROM projects; DELETE FROM labels; DELETE FROM saved_queries;'
    );

    for (const p of projects) {
      insProject.run(p.id, p.parentId ?? null, p.name, p.color, p.glyph, p.collapsed ? 1 : 0);
    }
    for (const l of labels) {
      insLabel.run(l.id, l.name);
    }
    const knownLabels = new Set(labels.map((l) => l.id));
    for (const t of tasks) {
      insTask.run(
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
        if (knownLabels.has(lid)) insTaskLabel.run(t.id, lid);
      }
    }
    for (const s of savedQueries) {
      insSaved.run(s.id, s.name, s.glyph, s.query, s.system ? 1 : 0);
    }

    const next = current + 1;
    db.prepare('UPDATE meta SET version = ? WHERE id = 1').run(next);
    return next;
  });

  const version = apply();
  return { version };
}

module.exports = { readState, writeState, getVersion, ConflictError };
