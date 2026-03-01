import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb, schema } from '../db/index.js';

export async function settingsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/settings', async (_request: FastifyRequest, reply: FastifyReply) => {
    const db = getDb();
    const settings = db.select(schema.settings as any).where().all() as any[];
    
    const result: Record<string, string> = {};
    for (const s of settings) {
      result[s.key] = s.value;
    }
    
    return reply.send(result);
  });

  fastify.get('/api/settings/:key', async (request: FastifyRequest<{ Params: { key: string } }>, reply: FastifyReply) => {
    const { key } = request.params;
    const db = getDb();
    const settings = db.select(schema.settings as any).where((getCol: (col: string) => any) => getCol('key') === key).all() as any[];
    
    if (settings.length === 0) {
      return reply.code(404).send({ error: 'Setting not found' });
    }
    
    const setting = settings[0];
    return reply.send({ key: setting.key, value: setting.value });
  });

  fastify.put('/api/settings/:key', async (request: FastifyRequest<{ Params: { key: string } }>, reply: FastifyReply) => {
    const { key } = request.params;
    const body = request.body as { value: string };
    const db = getDb();

    db.insert(schema.settings as any).onConflictDoUpdate({
      target: 'key',
      set: { key, value: body.value, updatedAt: Date.now() },
    });

    return reply.send({ key, value: body.value });
  });

  fastify.delete('/api/settings/:key', async (request: FastifyRequest<{ Params: { key: string } }>, reply: FastifyReply) => {
    const { key } = request.params;
    const db = getDb();
    db.delete(schema.settings as any).where((getCol: (col: string) => any) => getCol('key') === key);
    return reply.send({ success: true });
  });
}
