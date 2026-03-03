import { getDb, schema } from '../db/index.js';
import { nanoid } from 'nanoid';
import { getConfig } from '../config.js';

export interface SessionData {
  id: string;
  title: string;
  model: string;
  systemPrompt?: string;
  mode: 'build' | 'plan';
  createdAt: Date;
  updatedAt: Date;
}

export function createSession(data: {
  title?: string;
  model: string;
  systemPrompt?: string;
  mode?: 'build' | 'plan';
}): SessionData {
  const db = getDb();
  const now = Date.now();
  const id = nanoid();

  const session = {
    id,
    title: data.title || 'New Conversation',
    model: data.model,
    systemPrompt: data.systemPrompt,
    mode: data.mode || 'build',
    createdAt: now,
    updatedAt: now,
  };

  db.insert(schema.sessions as any).values(session);

  return {
    ...session,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  } as SessionData;
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
    systemPrompt: session.systemPrompt || undefined,
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
    systemPrompt: session.systemPrompt || undefined,
    mode: session.mode as 'build' | 'plan',
    createdAt: new Date(session.createdAt),
    updatedAt: new Date(session.updatedAt),
  }));
}

export function updateSession(id: string, updates: Partial<{
  title: string;
  model: string;
  systemPrompt: string;
  mode: 'build' | 'plan';
}>): SessionData | null {
  const db = getDb();
  const dbUpdates: Record<string, unknown> = { updatedAt: Date.now() };

  if (updates.title !== undefined) dbUpdates.title = updates.title;
  if (updates.model !== undefined) dbUpdates.model = updates.model;
  if (updates.systemPrompt !== undefined) dbUpdates.systemPrompt = updates.systemPrompt;
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

  const config = getConfig();
  const db = getDb();
  const settings = db.select(schema.settings as any).where().all() as any[];
  const modelSetting = settings.find((s: any) => s.key === 'DEFAULT_MODEL');
  const model = modelSetting?.value || config.DEFAULT_MODEL;

  createSession({ title: 'New Conversation', model });
  console.log('[Session] Created default session');
}

