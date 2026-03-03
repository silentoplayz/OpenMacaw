import { createAgentRuntime, getSession, type AgentEvent, type AgentConfig } from '../agent/index.js';
import { getConfig } from '../config.js';

export type ApprovalFn = NonNullable<AgentConfig['approvalFn']>;

/**
 * Run the agent for a single pipeline message and return the assembled text
 * response. Tool-call events are processed internally but not surfaced here —
 * only the final assistant text is returned to the calling pipeline adapter.
 */
export async function runAgentForPipelineAsync(
  sessionId: string,
  userMessage: string,
  approvalFn?: ApprovalFn
): Promise<string> {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error(`Pipeline session ${sessionId} not found`);
  }

  const config = getConfig();
  const textParts: string[] = [];

  const eventHandler = (event: AgentEvent): void => {
    if (event.type === 'text_delta') {
      textParts.push(event.content);
    }
  };

  await createAgentRuntime(
    {
      sessionId,
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
