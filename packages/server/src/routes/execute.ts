import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getMCPServer } from '../mcp/registry.js';
import { getDb, schema } from '../db/index.js';
import { nanoid } from 'nanoid';
import { extractServerIdFromToolName } from '../permissions/index.js';
import { createAgentRuntime, getSession } from '../agent/index.js';
import { getConfig } from '../config.js';
import { broadcastToSession } from './chat.js';

const executeSchema = z.object({
  toolCalls: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string(),
      arguments: z.record(z.unknown()),
    })
  ),
  user_approved: z.boolean(),
  sessionId: z.string().optional(),
});

export async function executeRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/api/execute', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = executeSchema.parse(request.body);
      console.log('[Execute API] Payload received, sessionId:', payload.sessionId);

      if (!payload.user_approved) {
        return reply.code(403).send({ error: 'Forbidden: user_approved must be true' });
      }

      if (payload.toolCalls.length === 0) {
        return reply.code(400).send({ error: 'No tool calls provided' });
      }

      const results = [];
      const db = getDb();

      for (const call of payload.toolCalls) {
        const { serverId, toolName } = extractServerIdFromToolName(call.name);

        if (!serverId) {
          const errorMsg = 'Tool name must include server ID (server:tool)';
          
          db.insert(schema.activityLog as any).values({
            id: nanoid(),
            sessionId: payload.sessionId || 'anonymous',
            serverId: 'unknown',
            toolName: call.name,
            toolInput: JSON.stringify(call.arguments),
            outcome: 'denied',
            reason: errorMsg,
            timestamp: new Date(),
          });

          results.push({ name: call.name, status: 'failed', error: errorMsg });
          continue;
        }

        const server = getMCPServer(serverId);
        if (!server || !server.client.isConnected()) {
          const errorMsg = `Server ${serverId} not found or not connected`;

          db.insert(schema.activityLog as any).values({
            id: nanoid(),
            sessionId: payload.sessionId || 'anonymous',
            serverId,
            toolName,
            toolInput: JSON.stringify(call.arguments),
            outcome: 'denied',
            reason: errorMsg,
            timestamp: new Date(),
          });

          results.push({ name: call.name, status: 'failed', error: errorMsg });
          continue;
        }

        try {
          const startTime = Date.now();
          const result = await server.client.callTool(toolName, call.arguments);
          const latency = Date.now() - startTime;

          db.insert(schema.activityLog as any).values({
            id: nanoid(),
            sessionId: payload.sessionId || 'anonymous',
            serverId,
            toolName,
            toolInput: JSON.stringify(call.arguments),
            outcome: 'allowed',
            latency,
            timestamp: new Date(),
          });

          const resultStr = JSON.stringify(result);
          db.insert(schema.messages as any).values({
            id: nanoid(),
            sessionId: payload.sessionId || 'anonymous',
            role: 'tool',
            content: `The user approved the action, and here is the result: ${resultStr}\n\nNow, finish your response to the user.`,
            toolCallId: call.id,
            createdAt: Date.now(),
          });
          console.log('[Execute API] Tool result saved to DB, sessionId:', payload.sessionId || 'anonymous');

          results.push({ name: call.name, status: 'success', result });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error during execution';

          db.insert(schema.activityLog as any).values({
            id: nanoid(),
            sessionId: payload.sessionId || 'anonymous',
            serverId,
            toolName,
            toolInput: JSON.stringify(call.arguments),
            outcome: 'denied',
            reason: errorMsg,
            timestamp: new Date(),
          });

          db.insert(schema.messages as any).values({
            id: nanoid(),
            sessionId: payload.sessionId || 'anonymous',
            role: 'tool',
            content: `The user approved the action, but it failed with error: ${errorMsg}\n\nNow, inform the user about the failure.`,
            toolCallId: call.id,
            createdAt: Date.now(),
          });

          results.push({ name: call.name, status: 'failed', error: errorMsg });
        }
      }

      // Fire and forget agent completion in the background
      if (payload.sessionId && payload.sessionId !== 'anonymous') {
        const session = getSession(payload.sessionId);
        if (session) {
          const config = getConfig();
          createAgentRuntime(
            {
              sessionId: payload.sessionId,
              model: session.model || config.DEFAULT_MODEL,
              systemPrompt: session.systemPrompt || config.SYSTEM_PROMPT,
              mode: session.mode,
              maxSteps: config.MAX_STEPS,
            },
            (event) => broadcastToSession(payload.sessionId!, event)
          ).run().catch(err => console.error('[Execute API] Background LLM completion error:', err));
        }
      }

      return reply.send({ results });
    } catch (error) {
      console.error('[Execute API] Validation or processing error:', error);
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid payload', details: error.errors });
      }
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
