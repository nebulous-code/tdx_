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

// ---- per-user seed --------------------------------------------------------
// Multi-tenant: each user gets their own default inbox project + the built-in
// system smart-views. Called by tools/add-user.js when a NEW user is created
// (the very first user instead adopts the pre-auth '__unowned__' rows). No demo
// tasks. Seed ids (p_inbox, sv_*) are safe to repeat across users because the
// primary key is composite (user_id, id).
function seedUserDefaults(userId) {
  const seed = db.transaction(() => {
    db.prepare(
      'INSERT INTO projects (user_id, id, parent_id, name, color, glyph, collapsed, position) VALUES (?, ?, ?, ?, ?, ?, 0, 0)'
    ).run(userId, 'p_inbox', null, 'inbox', '#ffb000', '⌂');

    // system smart-views. "open" + "overdue" are pinned to the header by default;
    // "today" stays first so it remains the default landing view (savedQueries[0]).
    const sv = db.prepare(
      'INSERT INTO saved_queries (user_id, id, name, glyph, query, system, position, pinned) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
    );
    sv.run(userId, 'sv_today',   'Today',     '☉', 'status:open due:today',      0, 0);
    sv.run(userId, 'sv_open',    'Open',      '○', 'status:open',                1, 1);
    sv.run(userId, 'sv_overdue', 'Overdue',   '!', 'status:overdue',             2, 1);
    sv.run(userId, 'sv_week',    'This week', '☰', 'status:open due:week',       3, 0);
    sv.run(userId, 'sv_rec',     'Recurring', '↻', 'recurring:true status:open', 4, 0);
    sv.run(userId, 'sv_nodate',  'No date',   '∅', 'due:none status:open',       5, 0);
  });
  seed();
}

runMigrations();

// Default export stays the better-sqlite3 handle (every caller does
// `require('./db')`); helpers ride along as properties.
module.exports = db;
module.exports.seedUserDefaults = seedUserDefaults;
