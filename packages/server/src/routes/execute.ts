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
      const db = getDb();

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
          // ── Task 3: Specific error for explicit server IDs ─────────────────
          const errorMsg = call.resolvedServerId
            ? `Server '${serverId}' is not currently connected. Please restart it in the Servers tab.`
            : `Server ${serverId} not found or not connected`;

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

        // ── Zombie Execution Guard ──────────────────────────────────────────────
        // If the user Denied the proposal then immediately clicked Approve
        // (race condition), the message status will already be 'denied'.
        // The denied state is FINAL — reject with 409 Conflict.
        if (call.id) {
          const proposalMsg = (db.select(schema.messages as any)
            .where((getCol: (col: string) => any) => getCol('toolCallId') === call.id)
            .all() as any[]).at(-1);
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
            db.update(schema.messages as any).set({ status: 'approved' }).where(
              (getCol: (col: string) => any) => getCol('toolCallId') === call.id
            );
          }

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

          // ── State machine: mark proposal as 'executed' ────────────────────────────
          if (call.id) {
            db.update(schema.messages as any).set({ status: 'executed' }).where(
              (getCol: (col: string) => any) => getCol('toolCallId') === call.id
            );
          }
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

          // Status stays 'approved' on failure — was approved, execution crashed.
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

  // ── Denial Feedback Loop ────────────────────────────────────────────────
  fastify.post('/api/deny', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { sessionId, toolName, reason } = request.body as { sessionId: string; toolName?: string; reason?: string };
      if (!sessionId) return reply.code(400).send({ error: 'sessionId required' });

      const db = getDb();

      // Save a system-level denial message so the LLM has context
      const reasonText = reason ? `Reason: "${reason}"` : 'No specific reason was given.';
      const denialContent = `The user DENIED your proposed execution of tool "${toolName || 'unknown'}". ${reasonText}\n\nDo NOT attempt the same action again. Reconsider your approach: if you used a filesystem tool for a network resource, use a web/search tool instead. If no suitable tool exists, explain that to the user in plain language.`;

      // ── State machine: mark the proposal message as 'denied' ──────────────
      // The frontend passes toolName. We find the most recent pending proposal
      // for this session, giving priority to matching toolName if available.
      // This is deterministic: denied state is immediate and permanent.
      const allPending = (db.select(schema.messages as any)
        .where((getCol: (col: string) => any) =>
          getCol('sessionId') === sessionId &&
          getCol('status') === 'pending'
        ).all() as any[]);

      // Prefer a match on tool name inside the serialised toolCalls JSON
      const nameMatches = toolName
        ? allPending.filter((m: any) => m.toolCalls && m.toolCalls.includes(`"name":"${toolName}"`))
        : [];
      const targetMsg = (nameMatches.length > 0 ? nameMatches : allPending).at(-1);

      if (targetMsg?.id) {
        db.update(schema.messages as any).set({ status: 'denied' }).where(
          (getCol: (col: string) => any) => getCol('id') === targetMsg.id
        );
        console.log(`[Deny API] Marked message ${targetMsg.id} (tool: ${toolName || 'unknown'}) → status:'denied'`);
      } else {
        console.warn('[Deny API] No pending proposal found to mark as denied for session:', sessionId);
      }

      db.insert(schema.messages as any).values({
        id: nanoid(),
        sessionId,
        role: 'tool',
        content: denialContent,
        toolCallId: `denied-${Date.now()}`,
        createdAt: Date.now(),
      });

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
