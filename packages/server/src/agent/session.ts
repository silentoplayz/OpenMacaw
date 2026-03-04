import { getDb, schema } from '../db/index.js';
import { nanoid } from 'nanoid';
import { getActiveSettings } from '../config.js';

export interface SessionData {
  id: string;
  title: string;
  model: string;
  /** Operator-supplied personality/style text appended to the base system prompt. */
  personality?: string;
  mode: 'build' | 'plan';
  createdAt: Date;
  updatedAt: Date;
}

export function createSession(data: {
  title?: string;
  model?: string;
  /** Personality override for this session. Appended to base system prompt, not replacing it. */
  personality?: string;
  mode?: 'build' | 'plan';
}): SessionData {
  const db = getDb();
  const now = Date.now();
  const id = nanoid();
  const config = getActiveSettings();

  // Store personality in the system_prompt DB column (reusing existing schema).
  const dbSession = {
    id,
    title: data.title || 'New Conversation',
    model: data.model || config.DEFAULT_MODEL,
    systemPrompt: data.personality ?? config.PERSONALITY,
    mode: data.mode || 'build',
    createdAt: now,
    updatedAt: now,
  };

  db.insert(schema.sessions as any).values(dbSession);

  return {
    id: dbSession.id,
    title: dbSession.title,
    model: dbSession.model,
    personality: dbSession.systemPrompt || undefined,
    mode: dbSession.mode,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
}

export function getSession(id: string): SessionData | null {
  const db = getDb();
  const sessions = db.select(schema.sessions as any).where((getCol: (col: string) => any) => getCol('id') === id).all() as any[];

  if (sessions.length === 0) return null;

  const session = sessions[0];
  return {
    id: session.id,
    title: session.title,
    model: session.model,
    personality: session.systemPrompt || undefined,
    mode: session.mode as 'build' | 'plan',
    createdAt: new Date(session.createdAt),
    updatedAt: new Date(session.updatedAt),
  };
}

export function listSessions(): SessionData[] {
  const db = getDb();
  const sessions = db.select(schema.sessions as any).where().all() as any[];

  return sessions.map(session => ({
    id: session.id,
    title: session.title,
    model: session.model,
    personality: session.systemPrompt || undefined,
    mode: session.mode as 'build' | 'plan',
    createdAt: new Date(session.createdAt),
    updatedAt: new Date(session.updatedAt),
  }));
}

export function updateSession(id: string, updates: Partial<{
  title: string;
  model: string;
  /** Personality text to store for this session. Appended to base system prompt at runtime. */
  personality: string;
  mode: 'build' | 'plan';
}>): SessionData | null {
  const db = getDb();
  const dbUpdates: Record<string, unknown> = { updatedAt: Date.now() };

  if (updates.title !== undefined) dbUpdates.title = updates.title;
  if (updates.model !== undefined) dbUpdates.model = updates.model;
  // Map personality → systemPrompt column in the DB
  if (updates.personality !== undefined) dbUpdates.systemPrompt = updates.personality;
  if (updates.mode !== undefined) dbUpdates.mode = updates.mode;

  db.update(schema.sessions as any).set(dbUpdates).where((getCol: (col: string) => any) => getCol('id') === id);

  return getSession(id);
}

export function deleteSession(id: string): void {
  const db = getDb();
  db.delete(schema.sessions as any).where((getCol: (col: string) => any) => getCol('id') === id);
}

/**
 * Ensures at least one session exists in the database.
 * Called at server startup so the web UI always has a conversation to open.
 */
export function ensureDefaultSession(): void {
  const existing = listSessions();
  if (existing.length > 0) return;

  createSession({ title: 'New Conversation' });
  console.log('[Session] Created default session');
}

