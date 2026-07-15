// db.ts — open SQLite (better-sqlite3), run the numbered .sql migrations, and
// expose a typed Kysely instance. Ported from backend/src/db.js; the migration
// runner is the same apply-in-order + schema_migrations pattern.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_DB_PATH =
  process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tdx.dev.db');
// overridable so the compiled image (dist/) can point at the copied .sql files
export const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR || path.join(__dirname, '..', 'migrations');

// ---- Kysely schema types ---------------------------------------------------
// SQLite has no boolean type; 0/1 integers are typed as `number`. Nullable
// columns are `T | null`. These mirror migrations/001_init.sql exactly.

export interface UsersTable {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  theme: string | null;
  week_start: number;
  sort_prefs: string | null;
  fib_sizing: number;
  notes_root_name: string; // the user's name for the vault's base directory ('' = hidden) — n.16
  calendars_all_name: string; // the user's name for the "all calendars" nav row ('' = hidden) — e.10
  is_admin: number;
  created_at: string;
  updated_at: string;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  last_seen: string | null;
}

export interface ProjectsTable {
  id: string;
  owner_id: string;
  parent_id: string | null;
  name: string;
  color: string;
  glyph: string;
  collapsed: number;
  position: number;
  archived: number;
  health: string;
  created_at: string;
  updated_at: string;
  readable_id: string | null;
}

export interface TasksTable {
  id: string;
  owner_id: string;
  creator_id: string;
  assignee_id: string | null;
  project_id: string | null;
  parent_id: string | null;
  title: string;
  done: number;
  due: string | null;
  reminder: string | null;
  recurrence: string | null;
  notes: string;
  priority: number;
  size: number;
  position: number;
  archived: number;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
  readable_id: string | null;
}

export interface EventsTable {
  id: string;
  owner_id: string;
  creator_id: string;
  assignee_id: string | null;
  calendar_id: string | null;
  title: string;
  notes: string;
  location: string | null;
  all_day: number;
  start_at: string;
  end_at: string | null;
  recurrence: string | null;
  reminder: string | null;
  position: number;
  archived: number;
  created_at: string;
  updated_at: string;
  readable_id: string | null;
}

export interface NotesTable {
  id: string;
  owner_id: string;
  path: string;
  folder_id: string | null;
  title: string;
  mtime: string;
  frontmatter: string | null;
  review_at: string | null;
  tombstoned: number;
  created_at: string;
  updated_at: string;
  readable_id: string | null;
}

export interface CalendarsTable {
  id: string;
  owner_id: string;
  name: string;
  color: string;
  glyph: string;
  position: number;
  archived: number;
  created_at: string;
  updated_at: string;
  readable_id: string | null;
}

export interface FoldersTable {
  id: string;
  owner_id: string;
  parent_id: string | null;
  name: string;
  path: string;
  color: string;
  glyph: string;
  collapsed: number;
  position: number;
  archived: number;
  created_at: string;
  updated_at: string;
  readable_id: string | null;
}

export interface EventLabelsTable {
  event_id: string;
  label_id: string;
}

export interface NoteLabelsTable {
  note_id: string;
  label_id: string;
}

export interface NoteLinksTable {
  id: string;
  owner_id: string;
  origin_note_id: string;
  target_type: string;
  target_id: string;
  rel: string;
  created_at: string;
}

export interface LinksTable {
  id: string;
  owner_id: string;
  t1_type: string;
  t1_id: string;
  t2_type: string;
  t2_id: string;
  rel: string;
  data: string | null;
  created_at: string;
}

export interface LabelsTable {
  id: string;
  owner_id: string;
  name: string;
  pinned: number;
}

export interface TaskLabelsTable {
  task_id: string;
  label_id: string;
}

export interface SavedQueriesTable {
  id: string;
  owner_id: string;
  name: string;
  glyph: string;
  query: string;
  system: number;
  color: string | null;
  position: number;
  pinned: number;
  display: string; // 'auto' | 'grid' | 'list' — how the view presents (e.1); see migration 007
}

export interface GrantsTable {
  id: string;
  resource_type: string;
  resource_id: string;
  principal_type: string;
  principal_id: string;
  role: string;
  created_at: string;
}

export interface GroupsTable {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

export interface GroupMembersTable {
  group_id: string;
  user_id: string;
  role: string;
  created_at: string;
}

export interface ApiTokensTable {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface IdCountersTable {
  owner_id: string;
  entity_type: string;
  next_seq: number;
}

export interface BackupConfigTable {
  id: number;
  enabled: number;
  dir: string;
  time_of_day: string;
  retention: number;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  next_run_at: string | null;
  vault_last_status: string | null; // git-vault backup health — 012, distinct from the DB backup's status
  vault_last_error: string | null;
  vault_last_run_at: string | null;
}

export interface Database_ {
  users: UsersTable;
  sessions: SessionsTable;
  projects: ProjectsTable;
  tasks: TasksTable;
  events: EventsTable;
  notes: NotesTable;
  calendars: CalendarsTable;
  folders: FoldersTable;
  note_links: NoteLinksTable;
  links: LinksTable;
  labels: LabelsTable;
  task_labels: TaskLabelsTable;
  event_labels: EventLabelsTable;
  note_labels: NoteLabelsTable;
  saved_queries: SavedQueriesTable;
  grants: GrantsTable;
  groups: GroupsTable;
  group_members: GroupMembersTable;
  api_tokens: ApiTokensTable;
  backup_config: BackupConfigTable;
  id_counters: IdCountersTable;
}

export type Sqlite = Database.Database;
export type DB = Kysely<Database_>;

// ---- migration runner ------------------------------------------------------
// Applies every *.sql file in migrations/ not yet recorded, in name order, each
// in its own transaction. Idempotent: re-running applies nothing new.
export function applyMigrations(sqlite: Sqlite, migrationsDir = MIGRATIONS_DIR): string[] {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`);

  const applied = new Set(
    sqlite
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((r) => (r as { version: string }).version),
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const record = sqlite.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );
  const newlyApplied: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    sqlite.transaction(() => {
      sqlite.exec(sql);
      record.run(file, new Date().toISOString());
    })();
    newlyApplied.push(file);
  }
  return newlyApplied;
}

// Open a database file (or ':memory:'), set pragmas, migrate, and wrap in Kysely.
export function openDatabase(dbPath = DEFAULT_DB_PATH): { sqlite: Sqlite; db: DB } {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');
  applyMigrations(sqlite);
  const db = new Kysely<Database_>({ dialect: new SqliteDialect({ database: sqlite }) });
  return { sqlite, db };
}

// `tsx src/db.ts --migrate` — apply migrations to DEFAULT_DB_PATH and report.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  fs.mkdirSync(path.dirname(DEFAULT_DB_PATH), { recursive: true });
  const sqlite = new Database(DEFAULT_DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const applied = applyMigrations(sqlite);
  console.log(
    applied.length ? `[db] applied: ${applied.join(', ')}` : '[db] up to date (nothing to apply)',
  );
  console.log(`[db] ${DEFAULT_DB_PATH}`);
  sqlite.close();
}
