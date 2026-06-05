// db.js — open the SQLite database, run migrations, seed a first-run default.
//
// Exports the better-sqlite3 handle (synchronous; perfect for a single-user app).
// Everything else in the backend imports `db` from here.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'tdx.db');
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// Make sure the directory for the db file exists (e.g. ./data on first run).
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');   // better concurrency + durability
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL'); // safe with WAL, much faster

// ---- migration runner -----------------------------------------------------
// Applies any *.sql file in migrations/ that hasn't been applied yet, in name
// order. Tracks applied files in schema_migrations.
function runMigrations() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const record = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)'
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const apply = db.transaction(() => {
      db.exec(sql);
      record.run(file, new Date().toISOString());
    });
    apply();
    console.log(`[db] applied migration ${file}`);
  }
}

// ---- first-run seed -------------------------------------------------------
// If there are no projects yet, create a single `inbox` project (the default
// dumping ground / quick-add target) plus the built-in system smart-views.
// No demo tasks.
function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM projects').get().n;
  if (count > 0) return;

  const seed = db.transaction(() => {
    db.prepare(
      'INSERT INTO projects (id, parent_id, name, color, glyph, collapsed) VALUES (?, ?, ?, ?, ?, 0)'
    ).run('p_inbox', null, 'inbox', '#ffb000', '⌂');

    const sv = db.prepare(
      'INSERT INTO saved_queries (id, name, glyph, query, system) VALUES (?, ?, ?, ?, 1)'
    );
    sv.run('sv_today',   'Today',     '☉', 'status:open due:today');
    sv.run('sv_overdue', 'Overdue',   '!', 'status:overdue');
    sv.run('sv_week',    'This week', '☰', 'status:open due:week');
    sv.run('sv_rec',     'Recurring', '↻', 'recurring:true status:open');
    sv.run('sv_nodate',  'No date',   '∅', 'due:none status:open');
  });
  seed();
  console.log('[db] seeded first-run defaults (inbox + system views)');
}

runMigrations();
seedIfEmpty();

module.exports = db;
