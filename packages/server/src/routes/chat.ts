import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createAgentRuntime, getSession, type AgentEvent } from '../agent/index.js';
import { getActiveSettingsForUser } from '../config.js';

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

export async function chatRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/ws/chat', { websocket: true }, (socket, _request) => {
    console.log('[WebSocket] New connection');
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
          console.log('[WebSocket] Chat message:', userMessage.substring(0, 50), 'session:', sessionId);

          // Register this socket for the session
          socketRegistry.set(sessionId, sendEvent);

          const session = getSession(sessionId);
          if (!session) {
            console.log('[WebSocket] Session not found:', sessionId);
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
            ).run(userMessage);
          } finally {
            // Always clean up — whether run completed, errored, or was aborted
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

  // HTTP test endpoint for quick testing without WebSocket
  fastify.post('/api/chat-test', async (request, reply) => {
    const body = request.body as { sessionId?: string; message?: string; model?: string };
    const { sessionId, message, model } = body;

    console.log('[HTTP Test] Chat request:', message?.substring(0, 50), 'session:', sessionId);

    if (!sessionId || !message) {
      return reply.code(400).send({ error: 'sessionId and message required' });
    }

    const session = getSession(sessionId);
    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const config = getActiveSettingsForUser(session.userId);
    const events: AgentEvent[] = [];

    const eventHandler = (event: AgentEvent) => {
      console.log('[HTTP Test] Event:', event.type);
      events.push(event);
    };

    try {
      await createAgentRuntime(
        {
          sessionId,
          model: model || session.model || config.DEFAULT_MODEL,
          personality: session.personality || config.PERSONALITY,
          mode: session.mode,
          maxSteps: config.MAX_STEPS,
        },
        eventHandler
      ).run(message);

      return reply.send({ events });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[HTTP Test] Error:', errorMessage);
      return reply.code(500).send({ error: errorMessage, events });
    }
  });
}
