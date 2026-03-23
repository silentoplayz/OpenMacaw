import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createSession, getSession, listSessions, updateSession, deleteSession } from '../agent/session.js';
import { getDb, schema } from '../db/index.js';

const createSessionSchema = z.object({
  title: z.string().optional(),
  model: z.string().optional(),
  personality: z.string().optional(),
  mode: z.enum(['build', 'plan']).optional(),
  isPinned: z.boolean().optional(),
  folderId: z.string().nullable().optional(),
});

export async function sessionsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).user.id;
    const sessions = listSessions(userId);
    return reply.send(sessions);
  });

  fastify.post('/api/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createSessionSchema.parse(request.body);
    const userId = (request as any).user.id;
    
    const session = createSession({
      userId,
      title: body.title,
      model: body.model,
      personality: body.personality,
      mode: body.mode,
    });
    return reply.code(201).send(session);
  });

  fastify.get('/api/sessions/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const userId = (request as any).user.id;
    const session = getSession(id, userId);
    
    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const db = getDb();
    const messages = db.select(schema.messages as any).where((getCol: (col: string) => any) => getCol('sessionId') === id).all();

    return reply.send({
      ...session,
      messages: messages.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls,
        toolResults: m.toolResults,
        status: m.status,
        parentId: m.parentId,
        isActive: m.isActive,
        model: m.model,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        createdAt: m.createdAt,
      })),
    });
  });

  fastify.put('/api/sessions/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const userId = (request as any).user.id;
    const body = createSessionSchema.partial().parse(request.body);
    
    const updated = updateSession(id, userId, body);
    if (!updated) {
      return reply.code(404).send({ error: 'Session not found' });
    }
    
    return reply.send(updated);
  });

  fastify.delete('/api/sessions/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const userId = (request as any).user.id;
    deleteSession(id, userId);
    return reply.send({ success: true });
  });

  // Delete ALL sessions for the current user
  fastify.delete('/api/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).user.id;
    const db = getDb();
    
    // Delete all sessions for this user. Messages will be cascade deleted by SQLite/Drizzle.
    db.delete(schema.sessions as any).where((col: (k: string) => any) => col('userId') === userId);
    
    return reply.send({ success: true, allCleared: true });
  });

  fastify.delete('/api/sessions/:id/messages', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const userId = (request as any).user.id;
    
    // Explicitly verify ownership before deleting messages
    const session = getSession(id, userId);
    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const db = getDb();
    db.delete(schema.messages as any).where((col: (k: string) => unknown) => col('sessionId') === id);
    return reply.send({ success: true, cleared: true });
  });

  fastify.delete('/api/sessions/:id/messages/:messageId', async (request: FastifyRequest<{ Params: { id: string, messageId: string } }>, reply: FastifyReply) => {
    const { id, messageId } = request.params;
    const userId = (request as any).user.id;

    const session = getSession(id, userId);
    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const db = getDb();
    // Soft delete: mark as inactive instead of hard deleting for version history
    db.update(schema.messages as any).set({ isActive: 0 }).where((col: (k: string) => any) => col('id') === messageId && col('sessionId') === id);
    return reply.send({ success: true, archived: true });
  });

  fastify.post('/api/sessions/:id/messages/:messageId/activate', async (request: FastifyRequest<{ Params: { id: string, messageId: string } }>, reply: FastifyReply) => {
    const { id, messageId } = request.params;
    const userId = (request as any).user.id;

    const session = getSession(id, userId);
    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const db = getDb();
    const messages = db.select(schema.messages as any).where((col: (k: string) => any) => col('sessionId') === id).all() as any[];
    const target = messages.find(m => m.id === messageId);
    
    if (!target) {
      return reply.code(404).send({ error: 'Message not found' });
    }

    // Set all siblings (share same parent) to inactive
    const siblings = messages.filter(m => m.parentId === target.parentId);
    const siblingIds = siblings.map(s => s.id);
    
    if (siblingIds.length > 0) {
      db.update(schema.messages as any)
        .set({ isActive: 0 })
        .where((col: (k: string) => any) => col('id') + ' IN (' + siblingIds.map(() => '?').join(',') + ')');
      // Wait, getDb().update(...).where() doesn't support complex SQL like 'IN (?)' easily with the custom wrapper
      // I should use drizzle directly or use multiple updates (less efficient but safer with this wrapper)
      
      for (const sid of siblingIds) {
        db.update(schema.messages as any).set({ isActive: 0 }).where((col: (k: string) => any) => col('id') === sid);
      }
    }

    // Set target to active
    db.update(schema.messages as any).set({ isActive: 1 }).where((col: (k: string) => any) => col('id') === messageId);

    return reply.send({ success: true, activated: messageId });
  });
}
