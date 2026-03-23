import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// ── Table name mapping (schema export keys → SQL table names) ─────────────────

const TABLE_SQL: Record<string, string> = {
  users: 'users',
  servers: 'servers',
  permissions: 'permissions',
  sessions: 'sessions',
  messages: 'messages',
  activity_log: 'activity_log',
  pipeline_log: 'pipeline_log',
  settings: 'settings',
  pipelines: 'pipelines',
  user_settings: 'user_settings',
};

// Primary key column (snake_case) per SQL table name
const TABLE_PK: Record<string, string> = {
  users: 'id',
  servers: 'id',
  permissions: 'id',
  sessions: 'id',
  messages: 'id',
  activity_log: 'id',
  pipeline_log: 'id',
  settings: 'key',
  pipelines: 'id',
  user_settings: 'id',
};

import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schemaMappings from './schema.js';

// ── Key-case helpers ──────────────────────────────────────────────────────────

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function convertKeysToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key in obj) result[snakeToCamel(key)] = obj[key];
  return result;
}

function convertKeysToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key in obj) result[camelToSnake(key)] = obj[key];
  return result;
}

function serializeDates(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key in obj) {
    const val = obj[key];
    result[key] = val instanceof Date ? val.getTime() : val;
  }
  return result;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let sqlite: Database.Database | null = null;
let drizzleDb: BetterSQLite3Database<typeof schemaMappings> | null = null;

function getSqlite(): Database.Database {
  if (!sqlite) throw new Error('Database not initialized — call initDatabase() first');
  return sqlite;
}

export function getDrizzleDb(): BetterSQLite3Database<typeof schemaMappings> {
  if (!drizzleDb) throw new Error('Drizzle DB not initialized');
  return drizzleDb;
}

// ── Schema DDL ────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    is_super_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    transport TEXT NOT NULL DEFAULT 'stdio',
    command TEXT,
    args TEXT,
    env_vars TEXT,
    url TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'stopped',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS permissions (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    allowed_paths TEXT NOT NULL DEFAULT '[]',
    denied_paths TEXT NOT NULL DEFAULT '[]',
    path_read INTEGER NOT NULL DEFAULT 0,
    path_write INTEGER NOT NULL DEFAULT 0,
    path_create INTEGER NOT NULL DEFAULT 0,
    path_delete INTEGER NOT NULL DEFAULT 0,
    path_list_dir INTEGER NOT NULL DEFAULT 0,
    bash_allowed INTEGER NOT NULL DEFAULT 0,
    bash_allowed_commands TEXT NOT NULL DEFAULT '[]',
    webfetch_allowed INTEGER NOT NULL DEFAULT 0,
    webfetch_allowed_domains TEXT NOT NULL DEFAULT '[]',
    subprocess_allowed INTEGER NOT NULL DEFAULT 0,
    network_allowed INTEGER NOT NULL DEFAULT 0,
    max_calls_per_minute INTEGER NOT NULL DEFAULT 30,
    max_tokens_per_call INTEGER NOT NULL DEFAULT 100000,
    prompt_injection_prevention INTEGER NOT NULL DEFAULT 0,
    tool_prompt_injection_prevention TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    system_prompt TEXT,
    mode TEXT NOT NULL DEFAULT 'build',
    is_pinned INTEGER NOT NULL DEFAULT 0,
    folder_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_calls TEXT,
    tool_results TEXT,
    tool_call_id TEXT,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    parent_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    server_id TEXT REFERENCES servers(id) ON DELETE SET NULL,
    tool_name TEXT NOT NULL,
    tool_input TEXT,
    outcome TEXT NOT NULL,
    reason TEXT,
    latency REAL,
    timestamp INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pipeline_log (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    severity TEXT NOT NULL,
    details TEXT,
    timestamp INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pipelines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    config TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'stopped',
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_permissions_server ON permissions(server_id);
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
  CREATE INDEX IF NOT EXISTS idx_activity_session ON activity_log(session_id);
  CREATE INDEX IF NOT EXISTS idx_activity_server ON activity_log(server_id);
  CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp);

  CREATE TABLE IF NOT EXISTS user_settings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(user_id, key)
  );
`;

// ── JSON → SQLite migration ───────────────────────────────────────────────────

function migrateFromJson(db: Database.Database, jsonPath: string): void {
  if (!existsSync(jsonPath)) return;

  // Skip if there is already data in the DB (migration already done)
  const sessionCount = (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as any).c;
  const serverCount = (db.prepare('SELECT COUNT(*) as c FROM servers').get() as any).c;
  if (sessionCount > 0 || serverCount > 0) return;

  let data: Record<string, any[]>;
  try {
    data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  } catch {
    console.warn('[DB] Could not parse', jsonPath, '— skipping migration');
    return;
  }

  // Ordered so FK parents come before their children
  const tables = [
    'servers',
    'permissions',
    'sessions',
    'messages',
    'activity_log',
    'pipeline_log',
    'settings',
    'pipelines',
  ] as const;

  const migrate = db.transaction(() => {
    for (const table of tables) {
      const rows: Record<string, unknown>[] = data[table] || [];
      for (const row of rows) {
        const cols = Object.keys(row);
        if (cols.length === 0) continue;
        try {
          const values = cols.map(c => {
            const val = row[c];
            if (val instanceof Date) return val.getTime();
            // activity_log.timestamp may be an ISO string in old data
            if (table === 'activity_log' && c === 'timestamp' && typeof val === 'string') {
              const t = new Date(val).getTime();
              return isNaN(t) ? Date.now() : t;
            }
            return val;
          });
          db.prepare(
            `INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
          ).run(...values);
        } catch (err) {
          console.warn(`[DB] Migration: skipping row in ${table}:`, (err as Error).message);
        }
      }
    }
  });

  migrate();
  console.log('[DB] Migrated existing data from', jsonPath);
}

// ── Public init ───────────────────────────────────────────────────────────────

export function initDatabase(): void {
  const dbPath = process.env.DATABASE_URL || './data/app.db';
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(SCHEMA_SQL);
  
  try {
    sqlite.exec("ALTER TABLE messages ADD COLUMN status TEXT DEFAULT 'pending'");
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // ── Phase 57: Multi-Tenant Data Migration ────────────────────────────────
  try {
    sqlite.exec("ALTER TABLE sessions ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE");
    
    // Assign orphaned sessions to the first available admin user
    const firstAdmin = sqlite.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as { id: string } | undefined;
    if (firstAdmin?.id) {
      sqlite.prepare("UPDATE sessions SET user_id = ? WHERE user_id IS NULL").run(firstAdmin.id);
      console.log(`[DB Migration] Assigned orphaned sessions to admin user ${firstAdmin.id}`);
    } else {
      console.warn('[DB Migration] No admin user found to assign orphaned sessions to.');
    }
  } catch (e) { /* column already exists */ }

  // ── Trust Policy columns (Phase 46) ──────────────────────────────────────
  try {
    sqlite.exec("ALTER TABLE permissions ADD COLUMN auto_approve_reads INTEGER DEFAULT 0");
  } catch (e) { /* column already exists */ }
  try {
    sqlite.exec("ALTER TABLE permissions ADD COLUMN trusted_paths TEXT DEFAULT '[]'");
  } catch (e) { /* column already exists */ }

  // ── Auto-Approve All — skip Discord approval for ALL permitted tool calls ──
  try {
    sqlite.exec("ALTER TABLE permissions ADD COLUMN auto_approve_all INTEGER DEFAULT 0");
  } catch (e) { /* column already exists */ }

  // ── Per-tool auto-approve map (replaces auto_approve_reads / auto_approve_all) ──
  try {
    sqlite.exec("ALTER TABLE permissions ADD COLUMN tool_auto_approve TEXT DEFAULT '{}'");
  } catch (e) { /* column already exists */ }

  // ── Phase 64: Last Active tracking ──────────────────────────────────────
  try {
    sqlite.exec("ALTER TABLE users ADD COLUMN last_active INTEGER");
  } catch (e) { /* column already exists */ }

  // ── Phase 68: Sidebar & Context Menu Migration ─────────────────────────────
  try {
    sqlite.exec("ALTER TABLE sessions ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0");
  } catch (e) { /* column already exists */ }
  try {
    sqlite.exec("ALTER TABLE sessions ADD COLUMN folder_id TEXT");
  } catch (e) { /* column already exists */ }

  // ── Phase 74: Immutable Root Admin ──────────────────────────────────────────
  try {
    sqlite.exec("ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0");
    // Crown the first-ever registered user (oldest created_at)
    sqlite.exec(`
      UPDATE users SET is_super_admin = 1
      WHERE id = (
        SELECT id FROM users ORDER BY created_at ASC LIMIT 1
      ) AND is_super_admin = 0
    `);
    console.log('[DB Migration] Phase 74: is_super_admin column added and root admin crowned.');
  } catch (e) { /* column already exists — still attempt the crown grant */ 
    try {
      sqlite.exec(`
        UPDATE users SET is_super_admin = 1
        WHERE id = (
          SELECT id FROM users ORDER BY created_at ASC LIMIT 1
        ) AND is_super_admin = 0
      `);
    } catch { /* already crowned */ }
  }

  // ── Phase 76: Gatekeeper Registration Flow & Profile Pictures ─────────────
  try {
    sqlite.exec("ALTER TABLE users ADD COLUMN profile_image_url TEXT");
    console.log('[DB Migration] Phase 76: profile_image_url column added.');
  } catch (e) { /* column already exists */ }

  // ── Phase 7: Response Navigation Migration ──────────────────────────────
  try {
    sqlite.exec("ALTER TABLE messages ADD COLUMN parent_id TEXT");
    sqlite.exec("ALTER TABLE messages ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
    console.log('[DB Migration] Phase 7: parent_id and is_active columns added.');
  } catch (e) { /* columns already exist */ }

  drizzleDb = drizzle(sqlite, { schema: schemaMappings });

  // Migrate from legacy JSON store on first run
  const jsonPath = dbPath.replace(/\.db$/, '.json');
  migrateFromJson(sqlite, jsonPath);
}

// ── getDb() — same API surface as before ─────────────────────────────────────

export function getDb() {
  const db = getSqlite();

  return {
    // ── SELECT ────────────────────────────────────────────────────────────────
    select: (table: string) => ({
      where: (conditionFn?: (getCol: (col: string) => unknown) => unknown) => {
        const sqlTable = TABLE_SQL[table] ?? table;
        const rows = (db.prepare(`SELECT * FROM "${sqlTable}"`).all() as Record<string, unknown>[])
          .map(convertKeysToCamel);

        const filtered = conditionFn
          ? rows.filter(row => conditionFn((key: string) => row[key]))
          : rows;

        return {
          all: () => filtered,
          limit: (n: number) => ({ all: () => filtered.slice(0, n) }),
        };
      },
    }),

    // ── INSERT ────────────────────────────────────────────────────────────────
    insert: (table: string) => ({
      values: (data: Record<string, unknown>) => {
        const sqlTable = TABLE_SQL[table] ?? table;
        const snake = serializeDates(convertKeysToSnake(data));
        const cols = Object.keys(snake);
        db.prepare(
          `INSERT OR IGNORE INTO "${sqlTable}" (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
        ).run(...cols.map(c => snake[c]));
      },

      // Used only by settings route (upsert)
      onConflictDoUpdate: ({ target, set }: { target: string; set: Record<string, unknown> }) => {
        const sqlTable = TABLE_SQL[table] ?? table;
        const snake = serializeDates(convertKeysToSnake(set));
        const snakeTarget = camelToSnake(target);
        const targetValue = snake[snakeTarget];

        const setCols = Object.keys(snake).filter(k => k !== snakeTarget);
        if (setCols.length === 0) return;

        // Try UPDATE first, then INSERT if the row doesn't exist yet
        const setClause = setCols.map(c => `${c} = ?`).join(', ');
        const result = db
          .prepare(`UPDATE "${sqlTable}" SET ${setClause} WHERE ${snakeTarget} = ?`)
          .run(...setCols.map(c => snake[c]), targetValue) as Database.RunResult;

        if (result.changes === 0) {
          const allCols = Object.keys(snake);
          db.prepare(
            `INSERT OR IGNORE INTO "${sqlTable}" (${allCols.join(', ')}) VALUES (${allCols.map(() => '?').join(', ')})`
          ).run(...allCols.map(c => snake[c]));
        }
      },
    }),

    // ── UPDATE ────────────────────────────────────────────────────────────────
    update: (table: string) => ({
      set: (data: Record<string, unknown>) => ({
        where: (conditionFn?: (getCol: (col: string) => unknown) => unknown) => {
          const sqlTable = TABLE_SQL[table] ?? table;
          const pkCol = TABLE_PK[sqlTable] ?? 'id';
          const snake = serializeDates(convertKeysToSnake(data));
          const setCols = Object.keys(snake);
          if (setCols.length === 0) return;
          const setClause = setCols.map(c => `${c} = ?`).join(', ');

          if (conditionFn) {
            // Find matching rows in JS, then UPDATE by PK
            const all = (db.prepare(`SELECT * FROM "${sqlTable}"`).all() as Record<string, unknown>[])
              .map(convertKeysToCamel);
            const pkValues = all
              .filter(row => conditionFn((key: string) => row[key]))
              .map(row => row[snakeToCamel(pkCol)]);

            if (pkValues.length === 0) return;

            const placeholders = pkValues.map(() => '?').join(', ');
            db.prepare(
              `UPDATE "${sqlTable}" SET ${setClause} WHERE ${pkCol} IN (${placeholders})`
            ).run(...setCols.map(c => snake[c]), ...pkValues);
          } else {
            db.prepare(`UPDATE "${sqlTable}" SET ${setClause}`).run(...setCols.map(c => snake[c]));
          }
        },
      }),
    }),

    // ── DELETE ────────────────────────────────────────────────────────────────
    delete: (table: string) => ({
      where: (conditionFn: (getCol: (col: string) => unknown) => unknown) => {
        const sqlTable = TABLE_SQL[table] ?? table;
        const pkCol = TABLE_PK[sqlTable] ?? 'id';

        const all = (db.prepare(`SELECT * FROM "${sqlTable}"`).all() as Record<string, unknown>[])
          .map(convertKeysToCamel);
        const pkValues = all
          .filter(row => conditionFn((key: string) => row[key]))
          .map(row => row[snakeToCamel(pkCol)]);

        if (pkValues.length === 0) return;

        const placeholders = pkValues.map(() => '?').join(', ');
        db.prepare(`DELETE FROM "${sqlTable}" WHERE ${pkCol} IN (${placeholders})`).run(...pkValues);
      },
    }),
  };
}

// ── Schema export (unchanged — callers pass these as table keys) ──────────────

export const schema = {
  users: 'users',
  servers: 'servers',
  permissions: 'permissions',
  sessions: 'sessions',
  messages: 'messages',
  activityLog: 'activity_log',
  pipelineLog: 'pipeline_log',
  settings: 'settings',
  pipelines: 'pipelines',
  userSettings: 'user_settings',
} as const;
