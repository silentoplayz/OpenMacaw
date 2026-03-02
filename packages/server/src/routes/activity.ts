import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb, schema } from '../db/index.js';

export async function activityRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/activity', async (request: FastifyRequest<{ Querystring: { serverId?: string; type?: string; limit?: string; search?: string } }>, reply: FastifyReply) => {
    const { serverId, type, limit, search } = request.query;
    const db = getDb();
    
    let entries = db.select(schema.activityLog as any).where().all() as any[];
    
    if (serverId) {
      entries = entries.filter(e => e.serverId === serverId);
    }
    
    if (type) {
      entries = entries.filter(e => e.outcome === type);
    }
    
    if (search) {
      const s = search.toLowerCase();
      entries = entries.filter(e => 
        (e.toolName && typeof e.toolName === 'string' && e.toolName.toLowerCase().includes(s)) ||
        (e.toolInput && typeof e.toolInput === 'string' && e.toolInput.toLowerCase().includes(s)) ||
        (e.reason && typeof e.reason === 'string' && e.reason.toLowerCase().includes(s))
      );
    }
    
    const limitNum = limit ? parseInt(limit, 10) : 100;
    entries = entries.slice(0, limitNum);
    
    const result = entries.map(e => ({
      id: e.id,
      sessionId: e.sessionId,
      serverId: e.serverId,
      toolName: e.toolName,
      toolInput: e.toolInput,
      outcome: e.outcome,
      reason: e.reason,
      latency: e.latency,
      timestamp: e.timestamp,
    }));
    
    return reply.send(result);
  });
}
