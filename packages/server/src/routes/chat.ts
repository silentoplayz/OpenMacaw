import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createAgentRuntime, getSession, type AgentEvent } from '../agent/index.js';
import { getActiveSettingsForUser } from '../config.js';
import { getDrizzleDb } from '../db/index.js';
import * as dbSchema from '../db/schema.js';
import { eq, and, or } from 'drizzle-orm';

const chatSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chat'),
    sessionId: z.string(),
    message: z.string(),
    model: z.string().optional(),
    mode: z.enum(['build', 'plan']).optional(),
  }),
  z.object({
    type: z.literal('join'),
    sessionId: z.string(),
  }),
  z.object({
    type: z.literal('regenerate'),
    sessionId: z.string(),
    model: z.string().optional(),
    mode: z.enum(['build', 'plan']).optional(),
  })
]);

// Registry to track active WebSocket connections for each session
export const socketRegistry = new Map<string, (event: AgentEvent) => void>();

// Per-session abort controllers — one per active LLM stream
export const sessionAbortControllers = new Map<string, AbortController>();

export function broadcastToSession(sessionId: string, event: AgentEvent) {
  const handler = socketRegistry.get(sessionId);
  if (handler) {
    handler(event);
  }
}

/** Abort the active stream for a session, if any. Returns true if something was aborted. */
export function abortSession(sessionId: string): boolean {
  const ctrl = sessionAbortControllers.get(sessionId);
  if (ctrl) {
    ctrl.abort();
    sessionAbortControllers.delete(sessionId);
    return true;
  }
  return false;
}

// Origins that are allowed to open the WebSocket.
// Kept in sync with the CORS allow-list in index.ts.
const WS_ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://localhost:4000',
  // Production: same-origin requests have no Origin header — handled below.
]);

export async function chatRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/ws/chat', { websocket: true }, async (socket, request) => {
    // ── 1. JWT authentication ────────────────────────────────────────────────
    // Accept token via Authorization header OR ?token= query param (WS clients
    // cannot set arbitrary headers in all environments, so both are supported).
    try {
      await request.jwtVerify();
    } catch {
      // Try query param fallback
      const queryToken = (request.query as Record<string, string>)?.token;
      if (queryToken) {
        try {
          await request.jwtVerify({ onlyCookie: false });
        } catch {
          socket.close(4001, 'Unauthorized — invalid or missing JWT');
          return;
        }
      } else {
        socket.close(4001, 'Unauthorized — invalid or missing JWT');
        return;
      }
    }

    // ── 2. Origin validation ─────────────────────────────────────────────────
    // Browsers always send Origin on cross-origin WS upgrades. A missing Origin
    // header is only possible for same-origin requests or non-browser clients
    // (curl, server-to-server) — allow those through.
    const origin = request.headers.origin;
    if (origin && !WS_ALLOWED_ORIGINS.has(origin)) {
      socket.close(4003, 'Forbidden — origin not allowed');
      return;
    }
    const authenticatedUserId: string = (request as any).user?.id;
    console.log('[WebSocket] New authenticated connection, userId:', authenticatedUserId);
    socket.on('error', (err) => {
      console.error('[WebSocket] Error:', err);
    });

    const sendEvent = (event: AgentEvent) => {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify(event));
      }
    };

    socket.on('message', async (data) => {
      console.log('[WebSocket] Received message');
      try {
        const parsed = chatSchema.parse(JSON.parse(data.toString()));

        if (parsed.type === 'chat') {
          const { sessionId, message: userMessage, model, mode } = parsed;
          console.log('[WebSocket] Chat message received for session:', sessionId);

          // Register this socket for the session
          socketRegistry.set(sessionId, sendEvent);

          // ── Session ownership check ──────────────────────────────────────────
          // Pass userId from the JWT so only the session owner can interact.
          const session = getSession(sessionId, authenticatedUserId);
          if (!session) {
            console.log('[WebSocket] Session not found or not owned by user:', sessionId);
            sendEvent({ type: 'error', message: 'Session not found' });
            return;
          }

          const config = getActiveSettingsForUser(session.userId);
          console.log('[WebSocket] Creating agent with model:', model || session.model || config.DEFAULT_MODEL);

          // Register an AbortController for this session so the stop endpoint can cancel it
          const abortCtrl = new AbortController();
          sessionAbortControllers.set(sessionId, abortCtrl);

          // Always route through the registry so that if the client reconnects mid-run
          // and re-registers a new socket via 'join', subsequent events reach the new socket.
          const liveEventHandler = (event: AgentEvent) => {
            const handler = socketRegistry.get(sessionId);
            if (handler) {
              handler(event);
            }
          };

          // ── Slash-command trigger: match /command against skill triggers ──────
          let resolvedMessage = userMessage;
          if (userMessage && userMessage.startsWith('/')) {
            const slashMatch = userMessage.match(/^(\/[a-z0-9_-]+)\s*([\s\S]*)$/i);
            if (slashMatch) {
              const trigger = slashMatch[1].toLowerCase();
              const remainder = slashMatch[2].trim();
              try {
                const db = getDrizzleDb();
                const allSkills = await db.select().from(dbSchema.skills)
                  .where(
                    and(
                      eq(dbSchema.skills.enabled, 1),
                      or(
                        eq(dbSchema.skills.userId, session.userId),
                        eq(dbSchema.skills.isGlobal, 1)
                      )
                    )
                  );
                const matched = allSkills.find(s => {
                  try {
                    const triggers: string[] = JSON.parse(s.triggers || '[]');
                    return triggers.some(t => t.toLowerCase() === trigger);
                  } catch { return false; }
                });
                if (matched) {
                  // Prepend skill instructions to the user message
                  resolvedMessage = `[Skill: ${matched.name}]\n${matched.instructions}\n\n---\nUser request: ${remainder || userMessage}`;
                  console.log(`[WebSocket] Slash-command ${trigger} matched skill "${matched.name}"`);
                }
              } catch (err) {
                console.warn('[WebSocket] Slash-command skill lookup failed:', err);
              }
            }
          }

          try {
            await createAgentRuntime(
              {
                sessionId,
                model: model || session.model || config.DEFAULT_MODEL,
                personality: session.personality || config.PERSONALITY,
                mode: mode || session.mode,
                maxSteps: config.MAX_STEPS,
                signal: abortCtrl.signal,
              },
              liveEventHandler
            ).run(resolvedMessage);
          } finally {
            // Always clean up — whether run completed, errored, or was aborted
            sessionAbortControllers.delete(sessionId);
          }

        } else if (parsed.type === 'regenerate') {
          const { sessionId, model, mode } = parsed;
          console.log('[WebSocket] Regenerate session:', sessionId);

          socketRegistry.set(sessionId, sendEvent);
          const session = getSession(sessionId, authenticatedUserId);
          if (!session) {
            sendEvent({ type: 'error', message: 'Session not found' });
            return;
          }

          const config = getActiveSettingsForUser(session.userId);
          const abortCtrl = new AbortController();
          sessionAbortControllers.set(sessionId, abortCtrl);

          const liveEventHandler = (event: AgentEvent) => {
            const handler = socketRegistry.get(sessionId);
            if (handler) {
              handler(event);
            }
          };

          try {
            await createAgentRuntime(
              {
                sessionId,
                model: model || session.model || config.DEFAULT_MODEL,
                personality: session.personality || config.PERSONALITY,
                mode: mode || session.mode,
                maxSteps: config.MAX_STEPS,
                signal: abortCtrl.signal,
              },
              liveEventHandler
            ).run(); // No message passed = regenerate from history
          } finally {
            sessionAbortControllers.delete(sessionId);
          }
        } else if (parsed.type === 'join') {
          const { sessionId } = parsed;
          console.log('[WebSocket] Join session:', sessionId);
          socketRegistry.set(sessionId, sendEvent);
        } else {
          console.log('[WebSocket] Unknown message type');
          sendEvent({ type: 'error', message: 'Unknown message type' });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('[WebSocket] Parse error:', errorMessage);
        sendEvent({ type: 'error', message: errorMessage });
      }
    });

    socket.on('close', () => {
      console.log('[WebSocket] Connection closed');
      // Clean up registry
      for (const [sid, handler] of socketRegistry.entries()) {
        if (handler === sendEvent) {
          socketRegistry.delete(sid);
          break;
        }
      }
    });
  });

  // POST /api/sessions/:id/stop — abort the active LLM stream for a session
  fastify.post('/api/sessions/:id/stop', async (request, reply) => {
    const { id } = request.params as { id: string };
    const aborted = abortSession(id);
    if (aborted) {
      broadcastToSession(id, { type: 'error', message: 'Generation stopped by user.' });
      return reply.send({ stopped: true });
    }
    return reply.code(404).send({ stopped: false, error: 'No active stream for this session' });
  });

}
