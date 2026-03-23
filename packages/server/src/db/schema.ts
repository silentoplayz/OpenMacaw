import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('user'),
  isSuperAdmin: integer('is_super_admin').notNull().default(0),
  profileImageUrl: text('profile_image_url'),
  lastActive: integer('last_active', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const userSettings = sqliteTable('user_settings', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const servers = sqliteTable('servers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  transport: text('transport').notNull().default('stdio'),
  command: text('command'),
  args: text('args'),
  envVars: text('env_vars'),
  url: text('url'),
  enabled: integer('enabled').notNull().default(1),
  status: text('status').notNull().default('stopped'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const permissions = sqliteTable('permissions', {
  id: text('id').primaryKey(),
  serverId: text('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  
  allowedPaths: text('allowed_paths').notNull(),
  deniedPaths: text('denied_paths').notNull(),
  pathRead: integer('path_read').notNull().default(0),
  pathWrite: integer('path_write').notNull().default(0),
  pathCreate: integer('path_create').notNull().default(0),
  pathDelete: integer('path_delete').notNull().default(0),
  pathListDir: integer('path_list_dir').notNull().default(0),
  
  bashAllowed: integer('bash_allowed').notNull().default(0),
  bashAllowedCommands: text('bash_allowed_commands').notNull(),
  
  webfetchAllowed: integer('webfetch_allowed').notNull().default(0),
  webfetchAllowedDomains: text('webfetch_allowed_domains').notNull(),
  
  subprocessAllowed: integer('subprocess_allowed').notNull().default(0),
  networkAllowed: integer('network_allowed').notNull().default(0),
  
  maxCallsPerMinute: integer('max_calls_per_minute').notNull().default(30),
  maxTokensPerCall: integer('max_tokens_per_call').notNull().default(100000),
  // Prompt-injection prevention toggle (false by default)
  promptInjectionPrevention: integer('prompt_injection_prevention').notNull().default(0),
  // Per-tool PIP overrides: { "toolName": "inherit" | "enable" | "disable" }
  toolPromptInjectionPrevention: text('tool_prompt_injection_prevention').notNull().default('{}'),

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  model: text('model').notNull(),
  systemPrompt: text('system_prompt'),
  mode: text('mode').notNull().default('build'),
  isPinned: integer('is_pinned').notNull().default(0),
  folderId: text('folder_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  toolCalls: text('tool_calls'),
  toolResults: text('tool_results'),
  toolCallId: text('tool_call_id'),
  // ── State machine ────────────────────────────────────────────────────────
  // pending   = proposal shown to user, awaiting decision
  // approved  = user clicked Approve (execution in progress)
  // executed  = tool call completed successfully
  // denied    = user clicked Deny
  status: text('status').default('pending'),
  model: text('model'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  parentId: text('parent_id'),
  isActive: integer('is_active').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const activityLog = sqliteTable('activity_log', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  serverId: text('server_id').references(() => servers.id, { onDelete: 'set null' }),
  toolName: text('tool_name').notNull(),
  toolInput: text('tool_input'),
  outcome: text('outcome').notNull(),
  reason: text('reason'),
  latency: real('latency'),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
});

export const pipelineLog = sqliteTable('pipeline_log', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  event: text('event').notNull(),
  severity: text('severity').notNull(),
  details: text('details'),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const pipelines = sqliteTable('pipelines', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  enabled: integer('enabled').notNull().default(1),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  config: text('config').notNull().default('{}'),
  status: text('status').notNull().default('stopped'),
  errorMessage: text('error_message'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export type Server = typeof servers.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type ActivityLogEntry = typeof activityLog.$inferSelect;
export type PipelineLogEntry = typeof pipelineLog.$inferSelect;
export type Pipeline = typeof pipelines.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type User = typeof users.$inferSelect;

