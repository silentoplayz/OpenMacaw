import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getMCPServer } from '../mcp/registry.js';
import { getDrizzleDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';
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
      // ── Task 3: Explicit server ID from the UI's live lookup ──────────────
      // When present, skip backend guessing entirely and use this server directly.
      resolvedServerId: z.string().optional(),
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
      const db = getDrizzleDb();

      for (const call of payload.toolCalls) {
        // ── Resolution priority ──────────────────────────────────────────────
        // 1. UI-provided explicitServerId (most reliable — live lookup done in browser)
        // 2. Encoded tool name (SERVERID__toolName or server:toolName)
        let serverId: string;
        let toolName: string;

        if (call.resolvedServerId) {
          serverId = call.resolvedServerId;
          // Bare tool name — strip any prefix that may have crept in
          const bare = call.name.includes('__') ? call.name.split('__')[1]
            : call.name.includes(':') ? call.name.split(':')[1]
            : call.name;
          toolName = bare;
          console.log(`[Execute API] Using explicit serverId: ${serverId}, tool: ${toolName}`);
        } else {
          const extracted = extractServerIdFromToolName(call.name);
          serverId = extracted.serverId;
          toolName = extracted.toolName;
        }

        if (!serverId) {
          const errorMsg = 'Tool name must include server ID (server:tool)';

          await db.insert(schema.activityLog).values({
            id: nanoid(),
            sessionId: payload.sessionId ?? null,
            serverId: null,
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
          // ── Task 3: Specific error for explicit server IDs ─────────────────
          const errorMsg = call.resolvedServerId
            ? `Server '${serverId}' is not currently connected. Please restart it in the Servers tab.`
            : `Server ${serverId} not found or not connected`;

          await db.insert(schema.activityLog).values({
            id: nanoid(),
            sessionId: payload.sessionId ?? null,
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

        // ── Zombie Execution Guard ──────────────────────────────────────────────
        // If the user Denied the proposal then immediately clicked Approve
        // (race condition), the message status will already be 'denied'.
        // The denied state is FINAL — reject with 409 Conflict.
        if (call.id) {
          const proposalMsg = (await db.select()
            .from(schema.messages)
            .where(eq(schema.messages.toolCallId, call.id))
            .limit(1))[0];
          if (proposalMsg?.status === 'denied') {
            console.warn(`[Execute API] ZOMBIE GUARD: toolCallId ${call.id} is already 'denied'. Refusing execution.`);
            results.push({
              name: call.name,
              status: 'failed',
              error: 'This action was already denied and cannot be executed.',
            });
            continue;
          }
        }

        try {
          // ── State machine: mark proposal as 'approved' (execution starting) ─────────
          if (call.id) {
            await db.update(schema.messages)
              .set({ status: 'approved' })
              .where(eq(schema.messages.toolCallId, call.id));
          }

          const startTime = Date.now();
          const result = await server.client.callTool(toolName, call.arguments);
          const latency = Date.now() - startTime;

          await db.insert(schema.activityLog).values({
            id: nanoid(),
            sessionId: payload.sessionId ?? null,
            serverId,
            toolName,
            toolInput: JSON.stringify(call.arguments),
            outcome: 'allowed',
            latency,
            timestamp: new Date(),
          });

          const resultStr = JSON.stringify(result);
          if (payload.sessionId) {
            await db.insert(schema.messages).values({
              id: nanoid(),
              sessionId: payload.sessionId,
              role: 'tool',
              content: `The user approved the action, and here is the result: ${resultStr}\n\nNow, finish your response to the user.`,
              toolCallId: call.id,
              createdAt: new Date(),
            });
          }

          // ── State machine: mark proposal as 'executed' ────────────────────────────
          if (call.id) {
            await db.update(schema.messages)
              .set({ status: 'executed' })
              .where(eq(schema.messages.toolCallId, call.id));
          }
          console.log('[Execute API] Tool result saved to DB, sessionId:', payload.sessionId ?? '(none)');

          results.push({ name: call.name, status: 'success', result });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error during execution';

          await db.insert(schema.activityLog).values({
            id: nanoid(),
            sessionId: payload.sessionId ?? null,
            serverId,
            toolName,
            toolInput: JSON.stringify(call.arguments),
            outcome: 'denied',
            reason: errorMsg,
            timestamp: new Date(),
          });

          if (payload.sessionId) {
            await db.insert(schema.messages).values({
              id: nanoid(),
              sessionId: payload.sessionId,
              role: 'tool',
              content: `The user approved the action, but it failed with error: ${errorMsg}\n\nNow, inform the user about the failure.`,
              toolCallId: call.id,
              createdAt: new Date(),
            });
          }

          // Status stays 'approved' on failure — was approved, execution crashed.
          results.push({ name: call.name, status: 'failed', error: errorMsg });
        }
      }

      // Fire and forget agent completion in the background
      if (payload.sessionId) {
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

  // ── Denial Feedback Loop ────────────────────────────────────────────────
  fastify.post('/api/deny', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { sessionId, toolName, reason } = request.body as { sessionId: string; toolName?: string; reason?: string };
      if (!sessionId) return reply.code(400).send({ error: 'sessionId required' });

      const db = getDrizzleDb();

      // Save a system-level denial message so the LLM has context
      const reasonText = reason ? `Reason: "${reason}"` : 'No specific reason was given.';
      const denialContent = `The user DENIED your proposed execution of tool "${toolName || 'unknown'}". ${reasonText}\n\nDo NOT attempt the same action again. Reconsider your approach: if you used a filesystem tool for a network resource, use a web/search tool instead. If no suitable tool exists, explain that to the user in plain language.`;

      // ── State machine: mark the proposal message as 'denied' ──────────────
      // The frontend passes toolName. We find the most recent pending proposal
      // for this session, giving priority to matching toolName if available.
      // This is deterministic: denied state is immediate and permanent.
      const allPending = await db.select()
        .from(schema.messages)
        .where(
          eq(schema.messages.sessionId, sessionId)
        );
      
      const pendingProps = allPending.filter(m => m.status === 'pending');

      // Prefer a match on tool name inside the serialised toolCalls JSON
      const nameMatches = toolName
        ? pendingProps.filter(m => m.toolCalls && m.toolCalls.includes(`"name":"${toolName}"`))
        : [];
      const targetMsg = (nameMatches.length > 0 ? nameMatches : pendingProps).at(-1);

      // The real tool_use_id from the proposal — needed so the tool_result can
      // be correctly paired with its tool_use block when history is replayed.
      // Fall back to a synthetic ID only if we truly can't find the proposal.
      const realToolCallId = targetMsg?.toolCallId ?? null;

      if (targetMsg?.id) {
        await db.update(schema.messages).set({ status: 'denied' }).where(
          eq(schema.messages.id, targetMsg.id)
        );
        console.log(`[Deny API] Marked message ${targetMsg.id} (tool: ${toolName || 'unknown'}) → status:'denied'`);
      } else {
        console.warn('[Deny API] No pending proposal found to mark as denied for session:', sessionId);
      }

      // Only insert a tool_result row when we have a real tool_call_id to pair
      // it with.  A synthetic/orphaned ID would break the Anthropic message
      // sequence on the next LLM turn.
      if (realToolCallId) {
        await db.insert(schema.messages).values({
          id: nanoid(),
          sessionId,
          role: 'tool',
          content: denialContent,
          toolCallId: realToolCallId,
          createdAt: new Date(),
        });
      }

      // Fire background LLM run so it responds to the denial
      const session = getSession(sessionId);
      if (session) {
        const config = getConfig();
        createAgentRuntime(
          {
            sessionId,
            model: session.model || config.DEFAULT_MODEL,
            systemPrompt: session.systemPrompt || config.SYSTEM_PROMPT,
            mode: session.mode,
            maxSteps: config.MAX_STEPS,
          },
          (event) => broadcastToSession(sessionId, event)
        ).run().catch(err => console.error('[Deny API] Background LLM error:', err));
      }

      return reply.send({ success: true });
    } catch (error) {
      console.error('[Deny API] Error:', error);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
