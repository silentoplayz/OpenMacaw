import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  listPipelines,
  getPipeline,
  createPipeline,
  updatePipeline,
  deletePipeline,
  startPipelineAsync,
  stopPipelineAsync,
  restartPipelineAsync,
  getLinePipeline,
  isRunning,
} from '../pipelines/index.js';

// ── Zod validators ────────────────────────────────────────────────────────────

const pipelineTypeSchema = z.enum(['discord', 'telegram', 'line']);

const discordConfigSchema = z.object({
  botToken: z.string().min(1),
  channelId: z.string().optional(),
});

const telegramConfigSchema = z.object({
  botToken: z.string().min(1),
  allowedChatIds: z.array(z.string()).optional(),
});

const lineConfigSchema = z.object({
  channelAccessToken: z.string().min(1),
  channelSecret: z.string().min(1),
});

const configSchema = z.union([discordConfigSchema, telegramConfigSchema, lineConfigSchema]);

const createPipelineSchema = z.object({
  name: z.string().min(1),
  type: pipelineTypeSchema,
  config: configSchema,
});

const updatePipelineSchema = z.object({
  name: z.string().optional(),
  config: configSchema.optional(),
  enabled: z.boolean().optional(),
});

// ── Route helpers ─────────────────────────────────────────────────────────────

function enrichPipeline(record: ReturnType<typeof getPipeline>) {
  if (!record) return null;
  return { ...record, running: isRunning(record.id) };
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function pipelinesRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /api/pipelines
  fastify.get('/api/pipelines', async (_request: FastifyRequest, reply: FastifyReply) => {
    const pipelines = listPipelines().map(enrichPipeline);
    return reply.send(pipelines);
  });

  // POST /api/pipelines
  fastify.post('/api/pipelines', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createPipelineSchema.parse(request.body);
    const pipeline = createPipeline(body);
    return reply.code(201).send(enrichPipeline(pipeline));
  });

  // GET /api/pipelines/:id
  fastify.get(
    '/api/pipelines/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const pipeline = getPipeline(request.params.id);
      if (!pipeline) return reply.code(404).send({ error: 'Pipeline not found' });
      return reply.send(enrichPipeline(pipeline));
    }
  );

  // PUT /api/pipelines/:id
  fastify.put(
    '/api/pipelines/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const body = updatePipelineSchema.parse(request.body);
      const updated = updatePipeline(request.params.id, body);
      if (!updated) return reply.code(404).send({ error: 'Pipeline not found' });
      return reply.send(enrichPipeline(updated));
    }
  );

  // DELETE /api/pipelines/:id
  fastify.delete(
    '/api/pipelines/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      // Stop first if running
      if (isRunning(id)) {
        await stopPipelineAsync(id).catch((err) =>
          console.error(`[Pipelines] Error stopping before delete:`, err)
        );
      }
      deletePipeline(id);
      return reply.send({ success: true });
    }
  );

  // POST /api/pipelines/:id/start
  fastify.post(
    '/api/pipelines/:id/start',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        await startPipelineAsync(request.params.id);
        return reply.send(enrichPipeline(getPipeline(request.params.id)));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: message });
      }
    }
  );

  // POST /api/pipelines/:id/stop
  fastify.post(
    '/api/pipelines/:id/stop',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      await stopPipelineAsync(request.params.id);
      return reply.send(enrichPipeline(getPipeline(request.params.id)));
    }
  );

  // POST /api/pipelines/:id/restart
  fastify.post(
    '/api/pipelines/:id/restart',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        await restartPipelineAsync(request.params.id);
        return reply.send(enrichPipeline(getPipeline(request.params.id)));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: message });
      }
    }
  );

  // ── LINE Webhook ─────────────────────────────────────────────────────────────
  // LINE signs every request with HMAC-SHA256. We need the raw body string to
  // validate the signature, so this endpoint uses its own content-type parser
  // (scoped to this plugin scope) that returns the body as a raw string instead
  // of pre-parsed JSON. The handler JSON-parses it after validation.

  fastify.register(async (lineScope) => {
    lineScope.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (_req, body, done) => {
        done(null, body as string);
      }
    );

    lineScope.post<{ Params: { id: string }; Body: string }>(
      '/api/pipelines/:id/webhook',
      async (request, reply) => {
        const { id } = request.params;
        const rawBody = request.body;
        const signature = request.headers['x-line-signature'];

        if (!signature || Array.isArray(signature)) {
          return reply.code(400).send({ error: 'Missing X-Line-Signature header' });
        }

        const linePipeline = getLinePipeline(id);
        if (!linePipeline) {
          return reply
            .code(404)
            .send({ error: 'LINE pipeline not found or not running' });
        }

        const result = await linePipeline.handleWebhookAsync(rawBody, signature);

        if (result.error) {
          return reply.code(400).send({ error: result.error });
        }

        return reply.send({ ok: true, processed: result.processed });
      }
    );
  });
}
