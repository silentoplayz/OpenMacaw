import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const DB_PATH = process.env.DATABASE_URL || './data/app.db';

if (!existsSync(dirname(DB_PATH))) {
  mkdirSync(dirname(DB_PATH), { recursive: true });
}

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');

sqlite.exec(`
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
    allowed_paths TEXT NOT NULL,
    denied_paths TEXT NOT NULL,
    path_read INTEGER NOT NULL DEFAULT 0,
    path_write INTEGER NOT NULL DEFAULT 0,
    path_create INTEGER NOT NULL DEFAULT 0,
    path_delete INTEGER NOT NULL DEFAULT 0,
    path_list_dir INTEGER NOT NULL DEFAULT 0,
    bash_allowed INTEGER NOT NULL DEFAULT 0,
    bash_allowed_commands TEXT NOT NULL,
    webfetch_allowed INTEGER NOT NULL DEFAULT 0,
    webfetch_allowed_domains TEXT NOT NULL,
    subprocess_allowed INTEGER NOT NULL DEFAULT 0,
    network_allowed INTEGER NOT NULL DEFAULT 0,
    max_calls_per_minute INTEGER NOT NULL DEFAULT 30,
  max_tokens_per_call INTEGER NOT NULL DEFAULT 100000,
  prompt_injection_prevention INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    system_prompt TEXT,
    mode TEXT NOT NULL DEFAULT 'build',
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
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
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

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_permissions_server ON permissions(server_id);
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_activity_session ON activity_log(session_id);
  CREATE INDEX IF NOT EXISTS idx_activity_server ON activity_log(server_id);
  CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp);
`);

console.log('Database initialized successfully');
sqlite.close();
