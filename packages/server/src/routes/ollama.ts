import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getConfig } from '../config.js';
import { getDb, schema } from '../db/index.js';

export async function ollamaRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/ollama/tags', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const config = getConfig();
      const db = getDb();
      const settings = db.select(schema.settings as any).where().all() as any[];
      const urlSetting = settings.find((s: any) => s.key === 'OLLAMA_BASE_URL');
      const baseUrl = urlSetting?.value || config.OLLAMA_BASE_URL;

      const response = await fetch(`${baseUrl}/api/tags`);
      
      if (!response.ok) {
        return reply.code(response.status).send({ error: `Ollama API error: ${response.statusText}` });
      }
      
      const data = await response.json();
      return reply.send(data);
    } catch (error) {
      console.error('[Ollama] Failed to fetch tags:', error);
      return reply.code(500).send({ error: 'Failed to connect to Ollama. Is it running?' });
    }
  });
}
