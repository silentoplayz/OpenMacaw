import { getDb, schema } from '../db/index.js';
import { nanoid } from 'nanoid';
import { getActiveSettings } from '../config.js';

export interface SessionData {
  id: string;
  userId: string;
  title: string;
  model: string;
  /** Operator-supplied personality/style text appended to the base system prompt. */
  personality?: string;
  mode: 'build' | 'plan';
  isPinned: boolean;
  folderId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function createSession(data: {
  userId?: string;
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

  let resolvedUserId: string = data.userId || '';
  if (!resolvedUserId) {
    const admin = db.select(schema.users as any).where((col: (k: string) => any) => col('role') === 'admin').all() as any[];
    resolvedUserId = admin.length > 0 ? admin[0].id : '';
  }

  // Store personality in the system_prompt DB column (reusing existing schema).
  const dbSession = {
    id,
    userId: resolvedUserId,
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
    userId: dbSession.userId,
    title: dbSession.title,
    model: dbSession.model,
    personality: dbSession.systemPrompt || undefined,
    mode: dbSession.mode,
    isPinned: false,
    folderId: null,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
}

export function getSession(id: string, userId?: string): SessionData | null {
  const db = getDb();
  let sessions;
  if (userId) {
    sessions = db.select(schema.sessions as any).where((getCol: (col: string) => any) => getCol('id') === id && getCol('userId') === userId).all() as any[];
  } else {
    sessions = db.select(schema.sessions as any).where((getCol: (col: string) => any) => getCol('id') === id).all() as any[];
  }

  if (sessions.length === 0) return null;

  const session = sessions[0];
  return {
    id: session.id,
    userId: session.userId,
    title: session.title,
    model: session.model,
    personality: session.systemPrompt || undefined,
    mode: session.mode as 'build' | 'plan',
    isPinned: !!session.isPinned,
    folderId: session.folderId || null,
    createdAt: new Date(session.createdAt),
    updatedAt: new Date(session.updatedAt),
  };
}

export function listSessions(userId: string): SessionData[] {
  const db = getDb();
  const sessions = db.select(schema.sessions as any).where((getCol: (col: string) => any) => getCol('userId') === userId).all() as any[];

  return sessions.map(session => ({
    id: session.id,
    userId: session.userId,
    title: session.title,
    model: session.model,
    personality: session.systemPrompt || undefined,
    mode: session.mode as 'build' | 'plan',
    isPinned: !!session.isPinned,
    folderId: session.folderId || null,
    createdAt: new Date(session.createdAt),
    updatedAt: new Date(session.updatedAt),
  }));
}

export function updateSession(id: string, userId: string | undefined, updates: Partial<{
  title: string;
  model: string;
  /** Personality text to store for this session. Appended to base system prompt at runtime. */
  personality: string;
  mode: 'build' | 'plan';
  isPinned: boolean;
  folderId: string | null;
}>): SessionData | null {
  const db = getDb();
  const dbUpdates: Record<string, unknown> = { updatedAt: Date.now() };

  if (updates.title !== undefined) dbUpdates.title = updates.title;
  if (updates.model !== undefined) dbUpdates.model = updates.model;
  // Map personality → systemPrompt column in the DB
  if (updates.personality !== undefined) dbUpdates.systemPrompt = updates.personality;
  if (updates.mode !== undefined) dbUpdates.mode = updates.mode;
  if (updates.isPinned !== undefined) dbUpdates.isPinned = updates.isPinned ? 1 : 0;
  if (updates.folderId !== undefined) dbUpdates.folderId = updates.folderId;

  if (userId) {
    db.update(schema.sessions as any).set(dbUpdates).where((getCol: (col: string) => any) => getCol('id') === id && getCol('userId') === userId);
  } else {
    db.update(schema.sessions as any).set(dbUpdates).where((getCol: (col: string) => any) => getCol('id') === id);
  }

  return getSession(id, userId);
}

export function deleteSession(id: string, userId?: string): void {
  const db = getDb();
  if (userId) {
    db.delete(schema.sessions as any).where((getCol: (col: string) => any) => getCol('id') === id && getCol('userId') === userId);
  } else {
    db.delete(schema.sessions as any).where((getCol: (col: string) => any) => getCol('id') === id);
  }
}

export function deleteMessage(messageId: string, sessionId: string): void {
  const db = getDb();
  db.delete(schema.messages as any).where((getCol: (col: string) => any) => getCol('id') === messageId && getCol('sessionId') === sessionId);
}

/**
 * Ensures at least one session exists in the database.
 * Called at server startup so the web UI always has a conversation to open.
 */
export function ensureDefaultSession(adminUserId: string): void {
  const existing = listSessions(adminUserId);
  if (existing.length > 0) return;

  createSession({ userId: adminUserId, title: 'New Conversation' });
  console.log('[Session] Created default session for admin');
}

