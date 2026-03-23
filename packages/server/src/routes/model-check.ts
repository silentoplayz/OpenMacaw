import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getProviderForModel } from '../llm/index.js';

/**
 * POST /api/check-model
 * Body: { model: string; provider?: string }
 *
 * Probes the given model with a minimal single-tool request to determine
 * whether it supports tool use. Returns { supportsTools: boolean }.
 * This is a "dry run" — any response (even empty) counts as success.
 * A 400 "does not support tools" error is caught and returns false.
 */
export async function modelCheckRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/api/check-model',
    async (
      request: FastifyRequest<{ Body: { model: string } }>,
      reply: FastifyReply
    ) => {
      const { model } = request.body as { model: string };
      if (!model) {
        return reply.code(400).send({ error: 'model is required' });
      }

      const dummyTool = [
        {
          name: 'capability_probe',
          description: 'Probe tool for capability detection.',
          inputSchema: {
            type: 'object',
            properties: { noop: { type: 'string', description: 'unused' } },
          },
        },
      ];

      try {
        const provider = getProviderForModel(model);
        // Fire a minimal 1-token request with a dummy tool.
        // We abort immediately after getting any response — we only care
        // whether the provider threw a "does not support tools" error.
        const controller = new AbortController();
        let resolved = false;

        await provider.chat(
          model,
          [{ role: 'user', content: 'hi' }],
          dummyTool,
          () => {
            if (!resolved) {
              resolved = true;
              // Got at least one delta — tool use is supported, abort early.
              controller.abort();
            }
          },
          controller.signal
        );

        return reply.send({ supportsTools: true });
      } catch (err: any) {
        // Abort from the early-exit is not an error
        if (err?.name === 'AbortError') {
          return reply.send({ supportsTools: true });
        }
        const msg: string = err?.message ?? String(err);
        if (/does not support tools/i.test(msg) || /tool.*not.*support/i.test(msg)) {
          return reply.send({ supportsTools: false });
        }
        // Other errors (network, auth, etc.) — report unknown
        console.warn('[ModelCheck] Unexpected error checking model:', msg);
        return reply.send({ supportsTools: null, error: msg });
      }
    }
  );
}
