import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createSession, getSession, listSessions, updateSession, deleteSession } from '../agent/session.js';
import { getDb, schema } from '../db/index.js';

const createSessionSchema = z.object({
  title: z.string().optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  mode: z.enum(['build', 'plan']).optional(),
});

export async function sessionsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/sessions', async (_request: FastifyRequest, reply: FastifyReply) => {
    const sessions = listSessions();
    return reply.send(sessions);
  });

  fastify.post('/api/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createSessionSchema.parse(request.body);
    
    const session = createSession({
      title: body.title,
      model: body.model,
      systemPrompt: body.systemPrompt,
      mode: body.mode,
    });
    return reply.code(201).send(session);
  });

  fastify.get('/api/sessions/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const session = getSession(id);
    
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
        model: m.model,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        createdAt: m.createdAt,
      })),
    });
  });

  fastify.put('/api/sessions/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const body = createSessionSchema.partial().parse(request.body);
    
    const updated = updateSession(id, body);
    if (!updated) {
      return reply.code(404).send({ error: 'Session not found' });
    }
    
    return reply.send(updated);
  });

  fastify.delete('/api/sessions/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    deleteSession(id);
    return reply.send({ success: true });
  });
}
