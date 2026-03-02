import { getProviderForModel, type Message, type StreamDelta, type ToolCall } from '../llm/index.js';
import { getAllTools } from '../mcp/registry.js';
import { evaluatePermission, extractServerIdFromToolName } from '../permissions/index.js';
import { getConfig } from '../config.js';
import { getDb, schema } from '../db/index.js';
import { nanoid } from 'nanoid';

export type AgentMode = 'build' | 'plan';

export interface AgentConfig {
  sessionId: string;
  model: string;
  systemPrompt?: string;
  mode: AgentMode;
  maxSteps: number;
}

export type EventHandler = (event: AgentEvent) => void;

export type AgentEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call_start'; tool: string; server: string; input: Record<string, unknown> }
  | { type: 'tool_call_result'; outcome: 'allowed' | 'denied'; result?: unknown; reason?: string }
  | { type: 'message_end'; usage: { inputTokens: number; outputTokens: number } }
  | { type: 'proposal'; id: string; tool: string; input: Record<string, unknown> }
  | { type: 'error'; message: string }
  | { type: 'step_count'; count: number }
  | { type: 'pipeline_stage'; stage: string }
  | { type: 'canary_leak_detected'; step: string }
  | { type: 'sanitizer_flagged'; strippedSegments: string[] }
  | { type: 'step_verified'; stepId: string; confidence: number; passed: boolean; anomalies: string[] }
  | { type: 'pipeline_halted'; reason: string; anomalies: string[] };

export const activeStreams = new Set<AbortController>();

export class AgentRuntime {
  private config: AgentConfig;
  private eventHandler: EventHandler;
  private messages: Message[];
  private stepCount = 0;
  private maxSteps: number;

  constructor(config: AgentConfig, eventHandler: EventHandler) {
    this.config = config;
    this.eventHandler = eventHandler;
    this.maxSteps = config.maxSteps || getConfig().MAX_STEPS;
    this.messages = [];
  }

  private loadHistory(): void {
    const db = getDb();
    const history = db.select(schema.messages as any)
      .where((getCol: (col: string) => any) => getCol('sessionId') === this.config.sessionId)
      .all() as any[];

    if (history.length === 0) {
      if (this.config.systemPrompt) {
        this.messages = [{ role: 'system', content: this.config.systemPrompt }];
      }
      return;
    }

    const raw: Message[] = history.map(msg => ({
      role: msg.role as Message['role'],
      content: msg.content,
      toolCalls: msg.toolCalls,
      toolCallId: msg.toolCallId,
    }));

    // Collect all tool_use IDs that exist in assistant messages so we can
    // drop orphaned tool_result blocks that have no matching tool_use.
    const toolUseIds = new Set<string>();
    for (const msg of raw) {
      if (msg.role === 'assistant' && msg.toolCallId) {
        toolUseIds.add(msg.toolCallId);
      }
    }

    this.messages = raw.filter(msg => {
      if (msg.role === 'tool' && msg.toolCallId && !toolUseIds.has(msg.toolCallId)) {
        console.warn(`[Agent] Dropping orphaned tool_result for toolCallId ${msg.toolCallId}`);
        return false;
      }
      return true;
    });

    // Ensure system prompt is at the top
    if (this.messages.length === 0 || this.messages[0].role !== 'system') {
      if (this.config.systemPrompt) {
        this.messages.unshift({ role: 'system', content: this.config.systemPrompt });
      }
    }

    console.log(`[Agent] Loaded ${history.length} messages from history (${this.messages.length} after filtering)`);
  }

  async run(userMessage?: string): Promise<void> {
    // Load conversation history so Claude has context from previous turns
    this.loadHistory();

    if (userMessage) {
      console.log('[Agent] Received user message:', userMessage.substring(0, 50));
      this.messages.push({ role: 'user', content: userMessage });
      await this.saveMessage('user', userMessage);
    }

    while (this.stepCount < this.maxSteps) {
      const tools = getAllTools();
      console.log('[Agent] Available tools:', tools.length);
      
      const provider = getProviderForModel(this.config.model);
      
      let deltaText = '';
      let interceptedProposal = false;
      let currentTurnHadToolCall = false;

      const abortController = new AbortController();
      activeStreams.add(abortController);

      try {
        await provider.chat(
          this.config.model,
          this.messages,
          tools,
          async (delta: StreamDelta) => {
            if (delta.type === 'text_delta' && delta.content) {
              deltaText += delta.content;
              this.eventHandler({ type: 'text_delta', content: delta.content });
            } else if (delta.type === 'tool_use' && delta.toolCall) {
              currentTurnHadToolCall = true;
              interceptedProposal = await this.handleToolCall(delta.toolCall);
            } else if ((delta as any).type === 'clear_text') {
              deltaText = '';
            } else if (delta.type === 'message_end' && delta.usage) {
              this.eventHandler({ type: 'message_end', usage: delta.usage });
              // Only save text if there was NO tool call this turn.
              // When there IS a tool call, handleToolCall already saves the proposal
              // as the single assistant message for this turn. Saving a second
              // assistant message would create an invalid consecutive-assistant
              // sequence that the Anthropic API rejects.
              if (deltaText && !currentTurnHadToolCall) {
                await this.saveMessage('assistant', deltaText, delta.usage);
                this.messages.push({ role: 'assistant', content: deltaText });
              }
            } else if (delta.type === 'error') {
              this.eventHandler({ type: 'error', message: delta.error || 'Unknown error' });
            }
          },
          abortController.signal
        );
      } catch (e: any) {
        if (e.name === 'AbortError') {
          console.log('[Agent] Stream aborted by user (Halt All)');
          this.eventHandler({ type: 'error', message: 'Stream aborted (System Halt)' });
          break; // Break the runtime loop entirely
        }
        throw e;
      } finally {
        activeStreams.delete(abortController);
      }

      this.stepCount++;

      // Stop loop if we intercepted a tool proposal (Human-in-the-Loop breakpoint)
      if (interceptedProposal) {
        console.log('[Agent] Execution halted for human approval (proposal intercepted).');
        break;
      }

      if (!deltaText && this.stepCount >= this.maxSteps) {
        this.eventHandler({ type: 'error', message: 'Max steps reached' });
        break;
      }

      if (!currentTurnHadToolCall) {
        break;
      }
    }

    this.eventHandler({ type: 'step_count', count: this.stepCount });
  }

  // Returns true if execution should halt because a proposal was emitted.
  private async handleToolCall(toolCall: ToolCall): Promise<boolean> {
    const { serverId, toolName } = extractServerIdFromToolName(toolCall.name);
    console.log('[Agent] Tool call:', toolName, 'from server:', serverId);

    if (!serverId) {
      console.log('[Agent] DENIED: No server ID in tool name');
      this.eventHandler({
        type: 'tool_call_result',
        outcome: 'denied',
        reason: 'Tool name must include server ID (server:tool)',
      });
      return false;
    }

    this.stepCount++;
    this.eventHandler({ type: 'step_count', count: this.stepCount });

    console.log('[Agent] Tool call start:', toolName, 'input:', JSON.stringify(toolCall.input).substring(0, 100));
    this.eventHandler({
      type: 'tool_call_start',
      tool: toolName,
      server: serverId,
      input: toolCall.input,
    });

    const permResult = evaluatePermission({
      serverId,
      toolName,
      toolInput: toolCall.input,
    });

    if (!permResult.allowed) {
      console.log('[Agent] DENIED by permission guard:', permResult.reason);
      this.eventHandler({
        type: 'tool_call_result',
        outcome: 'denied',
        reason: permResult.reason,
      });

      await this.logActivity(serverId, toolName, toolCall.input, 'denied', permResult.reason);

      this.messages.push({
        role: 'tool',
        content: `Tool call denied: ${permResult.reason}`,
        toolCallId: toolCall.id,
        toolName,
      });

      return false;
    }


    this.messages.push({
      role: 'assistant',
      content: `I will now execute the ${toolName} tool. Please review and approve the action.`,
      toolCallId: toolCall.id,
    });

    const toolCallPayload = JSON.stringify([{ id: toolCall.id, name: `${serverId}__${toolName}`, arguments: toolCall.input }]);
    await this.saveMessage(
      'assistant', 
      `I proposed executing ${serverId}__${toolName} (Waiting for approval).`,
      undefined,
      toolCallPayload,
      toolCall.id
    );

    this.eventHandler({
      type: 'proposal',
      id: toolCall.id,
      tool: `${serverId}:${toolName}`,
      input: toolCall.input,
    });

    return true;
  }

  private async saveMessage(
    role: 'user' | 'assistant' | 'tool',
    content: string,
    usage?: { inputTokens: number; outputTokens: number },
    toolCalls?: string,
    toolCallId?: string
  ): Promise<void> {
    console.log('[Agent] Saving message:', role, 'content length:', content.length);
    const db = getDb();
    const messageId = nanoid();

    db.insert(schema.messages as any).values({
      id: messageId,
      sessionId: this.config.sessionId,
      role,
      content,
      toolCalls,
      toolCallId,
      model: role === 'assistant' ? this.config.model : undefined,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      createdAt: Date.now(),
    });
    console.log('[Agent] Message saved:', messageId);
  }

  private async logActivity(
    serverId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    outcome: 'allowed' | 'denied',
    reason?: string,
    latency?: number
  ): Promise<void> {
    const db = getDb();
    
    db.insert(schema.activityLog as any).values({
      id: nanoid(),
      sessionId: this.config.sessionId,
      serverId,
      toolName,
      toolInput: JSON.stringify(toolInput),
      outcome,
      reason,
      latency,
      timestamp: new Date(),
    });
  }
}

export function createAgentRuntime(config: AgentConfig, eventHandler: EventHandler): AgentRuntime {
  return new AgentRuntime(config, eventHandler);
}
