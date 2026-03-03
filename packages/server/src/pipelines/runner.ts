import { createAgentRuntime, getSession, type AgentEvent, type AgentConfig } from '../agent/index.js';
import { getActiveSettings } from '../config.js';

export type ApprovalFn = NonNullable<AgentConfig['approvalFn']>;

/**
 * Called by a pipeline adapter when the session ID it holds is no longer in the
 * database (e.g. the user deleted the conversation from the web UI). Should
 * return a new valid session ID, or null if recovery is not possible.
 */
export type SessionRecoveryFn = () => Promise<string | null>;

/**
 * Run the agent for a single pipeline message and return the assembled text
 * response. Tool-call events are processed internally but not surfaced here —
 * only the final assistant text is returned to the calling pipeline adapter.
 *
 * @param sessionId         Active session ID
 * @param userMessage       The user's message text
 * @param approvalFn        Optional per-tool approval gate (e.g. Discord reactions)
 * @param sessionRecoveryFn Optional callback invoked when the session is missing.
 *                          Should return a fresh session ID so the conversation
 *                          can continue, or null to abort.
 */
export async function runAgentForPipelineAsync(
  sessionId: string,
  userMessage: string,
  approvalFn?: ApprovalFn,
  sessionRecoveryFn?: SessionRecoveryFn,
): Promise<string> {
  let resolvedSessionId = sessionId;
  let session = getSession(resolvedSessionId);

  if (!session) {
    // The session was deleted while the pipeline was running (e.g. user cleared
    // the conversation from the web UI during a long approval wait).
    if (sessionRecoveryFn) {
      console.warn(`[PipelineRunner] Session ${sessionId} no longer exists — attempting recovery`);
      const newId = await sessionRecoveryFn();
      if (newId) {
        resolvedSessionId = newId;
        session = getSession(resolvedSessionId);
        console.log(`[PipelineRunner] Session recovered: ${resolvedSessionId}`);
      }
    }

    if (!session) {
      throw new Error(`Pipeline session ${sessionId} not found`);
    }
  }

  const config = getActiveSettings();
  const textParts: string[] = [];

  const eventHandler = (event: AgentEvent): void => {
    if (event.type === 'text_delta') {
      textParts.push(event.content);
    }
  };

  await createAgentRuntime(
    {
      sessionId: resolvedSessionId,
      model: session.model || config.DEFAULT_MODEL,
      systemPrompt: session.systemPrompt || config.SYSTEM_PROMPT,
      mode: session.mode,
      maxSteps: config.MAX_STEPS,
      // Pipelines have no approval UI — execute tools automatically.
      autoExecute: true,
      // Optional per-message approval gate (e.g. Discord reactions).
      approvalFn,
    },
    eventHandler
  ).run(userMessage);

  return textParts.join('').trim();
}

/** Split a long string into chunks that respect a max byte/char limit. */
export function splitMessage(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    // Try to break at a newline or space boundary
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.5) splitAt = remaining.lastIndexOf(' ', maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
