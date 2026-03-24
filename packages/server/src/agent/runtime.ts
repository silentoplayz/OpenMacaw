import { getProviderForModel, type Message, type StreamDelta, type ToolCall } from '../llm/index.js';
import { buildSystemPrompt, type ActiveSkill } from './prompts.js';
import { looksLikeHallucinatedAction } from '../llm/ollama.js';
import { getAllTools, findServerIdForTool, getMCPServer, getToolDefinition } from '../mcp/registry.js';
import { evaluatePermission, extractServerIdFromToolName } from '../permissions/index.js';
import { scanAndRedactSecrets, scanToolArgsForSecrets } from '../permissions/secretScanner.js';
import { validateToolCallArgs } from '../mcp/toolSanitizer.js';
import { getConfig } from '../config.js';
import { getDrizzleDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq, asc, or, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getSession, updateSession } from './session.js';

export type AgentMode = 'build' | 'plan';

export interface AgentConfig {
  sessionId: string;
  model: string;
  /**
   * Operator-supplied personality/style text.  Appended to the immutable base
   * system prompt via `buildSystemPrompt()` — never replaces it.
   */
  personality?: string;
  /** Custom agent name from workspace settings. Overrides the default "OpenMacaw" identity. */
  agentName?: string;
  /** Custom agent description from workspace settings. */
  agentDescription?: string;
  /** LLM sampling temperature. */
  temperature?: number;
  mode: AgentMode;
  maxSteps: number;
  /**
   * When true, MCP tool calls are executed immediately without emitting a
   * `proposal` event or waiting for human approval. Used by pipeline adapters
   * (Discord, Telegram, LINE) which have no approval UI.
   */
  autoExecute?: boolean;

  /**
   * Optional signal that, when aborted, terminates the current LLM stream
   * mid-generation. Used by the stop-button endpoint.
   */
  signal?: AbortSignal;

  /**
   * Optional async gate called before each tool execution when autoExecute is
   * true. Return `true` to allow the call, `false` to deny it. When omitted,
   * all permitted tool calls execute without further confirmation.
   *
   * Used by the Discord pipeline to send an approval embed and wait for a
   * reaction before proceeding.
   */
  approvalFn?: (call: {
    serverId: string;
    toolName: string;
    input: Record<string, unknown>;
  }) => Promise<boolean>;
}

export type EventHandler = (event: AgentEvent) => void;

export type AgentEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call_start'; tool: string; server: string; input: Record<string, unknown> }
  | { type: 'tool_call_result'; outcome: 'allowed' | 'denied'; result?: unknown; reason?: string }
  | { type: 'message_end'; usage: { inputTokens: number; outputTokens: number } }
  | { type: 'proposal'; id: string; tool: string; input: Record<string, unknown> }
  | { type: 'batch_proposal'; id: string; toolCalls: Array<{ tool: string; server: string; input: Record<string, unknown> }> }
  | { type: 'error'; message: string; code?: string }
  | { type: 'step_count'; count: number }
  | { type: 'session_renamed'; sessionId: string; newTitle: string }
  | { type: 'pipeline_stage'; stage: string }
  | { type: 'canary_leak_detected'; step: string }
  | { type: 'sanitizer_flagged'; strippedSegments: string[] }
  | { type: 'step_verified'; stepId: string; confidence: number; passed: boolean; anomalies: string[] }
  | { type: 'pipeline_halted'; reason: string; anomalies: string[] }
  // ── Agentic Run lifecycle events ──────────────────────────────────────────
  | { type: 'agentic_plan_proposed'; runId: string; goal: string; plan: { id: string; description: string; tool?: string; server?: string }[]; requireFinalApproval?: boolean; completionGoal?: string }
  | { type: 'agentic_running'; runId: string }
  | { type: 'agentic_step_progress'; runId: string; stepIndex: number; tool: string; status: 'running' | 'done' | 'error' }
  | { type: 'agentic_final_checkpoint'; runId: string; pendingActions: { tool: string; server: string; input: Record<string, unknown>; result?: unknown; executedAt: string }[] }
  | { type: 'agentic_done'; runId: string }
  | { type: 'agentic_cancelled'; runId: string; reason?: string };

export const activeStreams = new Set<AbortController>();

export class AgentRuntime {
  private config: AgentConfig;
  private eventHandler: EventHandler;
  private messages: Message[] = [];
  private stepCount = 0;
  private maxSteps: number;
  private lastMessageId: string | null = null;

  // ── Task 4: Safety Brake state ────────────────────────────────────────────
  /** Timestamps (ms) of every tool call fired in the current run() turn. */
  private toolCallTimestamps: number[] = [];
  private readonly RATE_LIMIT_WINDOW_MS = 10_000;
  private readonly RATE_LIMIT_MAX_CALLS = 3;

  

  constructor(config: AgentConfig, eventHandler: EventHandler) {
    this.config = config;
    this.eventHandler = eventHandler;
    this.maxSteps = config.maxSteps || getConfig().MAX_STEPS;
    this.messages = [];
  }

  /**
   * Load active skills for the current session's user. Skills are loaded from:
   * 1. Per-session activated skills (stored in sessions.active_skill_ids JSON)
   * 2. Global enabled skills
   * 3. User's personal enabled skills
   * If the session has explicit skill IDs set, only those are used. Otherwise,
   * all enabled skills visible to the user are loaded.
   */
  private async loadActiveSkills(): Promise<ActiveSkill[]> {
    const db = getDrizzleDb();

    // Get the session to find the userId and active skill IDs
    const sessionRows = await db.select().from(schema.sessions)
      .where(eq(schema.sessions.id, this.config.sessionId));
    if (sessionRows.length === 0) return [];

    const session = sessionRows[0];
    const userId = session.userId;

    // Parse per-session skill activation list
    let activeIds: string[] = [];
    try {
      activeIds = JSON.parse(session.activeSkillIds || '[]');
    } catch { /* invalid JSON, ignore */ }

    let skills: typeof schema.skills.$inferSelect[];

    if (activeIds.length > 0) {
      // Load only the explicitly activated skills for this session
      const allSkills = await db.select().from(schema.skills)
        .where(eq(schema.skills.enabled, 1));
      skills = allSkills.filter(s => activeIds.includes(s.id));
    } else {
      // No per-session filter: load all enabled skills visible to this user
      skills = await db.select().from(schema.skills)
        .where(
          and(
            eq(schema.skills.enabled, 1),
            or(
              eq(schema.skills.userId, userId),
              eq(schema.skills.isGlobal, 1)
            )
          )
        );
    }

    return skills.map(s => ({
      name: s.name,
      instructions: s.instructions,
      toolHints: (() => { try { return JSON.parse(s.toolHints || '[]'); } catch { return []; } })(),
    }));
  }

  private async loadHistory(): Promise<void> {
    const db = getDrizzleDb();
    const history = await db.select().from(schema.messages)
      .where(eq(schema.messages.sessionId, this.config.sessionId))
      .orderBy(asc(schema.messages.createdAt));

    // Load active skills for system prompt injection
    const activeSkills = await this.loadActiveSkills();

    const identity = {
      agentName: this.config.agentName,
      agentDescription: this.config.agentDescription,
      personality: this.config.personality,
    };

    if (history.length === 0) {
      this.messages = [{ role: 'system', content: buildSystemPrompt(identity, activeSkills) }];
      return;
    }

    // Filter for active branch only
    const activeHistory = history.filter(msg => msg.isActive === 1);

    const raw: Message[] = activeHistory.map(msg => ({
      id: msg.id,
      role: msg.role as Message['role'],
      content: msg.content,
      toolCalls: msg.toolCalls || undefined,
      toolCallId: msg.toolCallId || undefined,
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

    // Ensure system prompt is at the top (always present — even with no personality).
    if (this.messages.length === 0 || this.messages[0].role !== 'system') {
      this.messages.unshift({ role: 'system', content: buildSystemPrompt(identity, activeSkills) });
    } else {
      // Set lastMessageId from the last message of the loaded history
      const lastMsg = activeHistory[activeHistory.length - 1];
      if (lastMsg) this.lastMessageId = lastMsg.id;
    }

    console.log(`[Agent] Loaded ${history.length} messages (${activeHistory.length} active) from history`);
  }

  async run(userMessage?: string): Promise<void> {
    // Reset Safety Brake counters for this fresh run turn
    this.toolCallTimestamps = [];

    // Load conversation history so Claude has context from previous turns
    await this.loadHistory();

    if (userMessage) {
      console.log('[Agent] Received user message:', userMessage.substring(0, 50));
      this.messages.push({ role: 'user', content: userMessage });
      await this.saveMessage('user', userMessage);

      // Fire-and-forget: auto-generate conversation title in the background
      this.generateTitleIfNeeded(userMessage).catch(err =>
        console.error('[Agent] Background title generation failed:', err)
      );
    }

    while (this.stepCount < this.maxSteps) {
      // Emit a stage event so the UI can show "Checking available tools…" even
      // when the agent never makes an actual tool call (e.g. "what tools do you have?").
      const tools = getAllTools();
      console.log('[Agent] Available tools:', tools.length);
      this.eventHandler({ type: 'pipeline_stage', stage: 'fetching_tools' });

      const provider = getProviderForModel(this.config.model);

      let deltaText = '';
      let interceptedProposal = false;
      let currentTurnHadToolCall = false;
      let pendingUsage: { inputTokens: number; outputTokens: number } | null = null;

      const abortController = new AbortController();
      activeStreams.add(abortController);

      // If a session-level abort signal was provided, forward it to this turn's controller
      if (this.config.signal) {
        this.config.signal.addEventListener('abort', () => abortController.abort(), { once: true });
      }

      // Signal that we are now waiting on the LLM.
      this.eventHandler({ type: 'pipeline_stage', stage: 'generating' });

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
              // Pass the accumulated text so the assistant message stored in the
              // DB includes any prose the model emitted before the tool call.
              interceptedProposal = await this.handleToolCall(delta.toolCall, deltaText);
              // Clear so a second tool call in the same turn doesn't re-emit the same text.
              deltaText = '';
            } else if ((delta as any).type === 'clear_text') {
              deltaText = '';
            } else if (delta.type === 'message_end' && delta.usage) {
               // Defer message_end emission and DB save until AFTER the hallucination
               // check below. Emitting here would signal "done" to the client before
               // we know whether to reject this response and retry.
               pendingUsage = delta.usage;
             } else if (delta.type === 'error') {
              this.eventHandler({ type: 'error', message: delta.error || 'Unknown error' });
            }
          },
          { signal: abortController.signal, temperature: this.config.temperature }
        );
      } catch (e: any) {
        if (e.name === 'AbortError') {
          console.log('[Agent] Stream aborted by user (Halt All)');
          this.eventHandler({ type: 'error', message: 'Stream aborted (System Halt)' });
          break;
        }
        if (e.code === 'MODEL_NO_TOOLS') {
          console.warn('[Agent] MODEL_NO_TOOLS:', e.message);
          this.eventHandler({ type: 'error', code: 'MODEL_NO_TOOLS', message: e.message });
          break;
        }
        throw e;
      } finally {
        activeStreams.delete(abortController);
      }

      this.stepCount++;

      // Stop loop if we intercepted a tool proposal (Human-in-the-Loop breakpoint)
      if (interceptedProposal) {
        console.log(`[Agent] [session:${this.config.sessionId}] Execution halted for human approval (proposal intercepted).`);
        break;
      }

      // ── Task 2: Hallucination Retry Loop ─────────────────────────────────
      // Ollama/local models don't support native tool_use blocks — they emit
      // tool calls as plain JSON text. This means they can "roleplay" actions
      // by describing results in prose. Detect and reject that here.
      // Cloud providers (Anthropic, OpenAI) use proper tool_use API blocks and
      // will never produce this pattern — skip the check for them to avoid
      // false-positives on legitimate final summaries.
      if (provider.name === 'ollama' && deltaText && !currentTurnHadToolCall && looksLikeHallucinatedAction(deltaText)) {
        console.warn('[Agent] HALLUCINATION DETECTED: Model simulated action without tool call. Rejecting response and retrying.');
        console.warn('[Agent] Rejected text (first 200 chars):', deltaText.substring(0, 200));

        // Message was not yet saved to DB (save is deferred to after this check).
        // Remove it from the in-memory message list if it was accidentally added.
        this.messages = this.messages.filter(m => m.content !== deltaText);

        // Inject a corrective system message to steer the model back
        const correctionMsg: Message = {
          role: 'user',
          content: 'SYSTEM ERROR: You simulated a tool action by describing the result in plain text, but you did NOT actually trigger the tool call. This is not allowed. You MUST output a valid JSON tool call in the exact format: {"name": "server:tool", "arguments": {...}}. Do not describe what you would do. Execute it now.'
        };
        this.messages.push(correctionMsg);
        // Emit a system event so the frontend shows this (optional, for debugging)
        this.eventHandler({ type: 'text_delta', content: '\n⚠️ Hallucination detected — forcing retry...' });

        // Reset delta and usage for next iteration
        deltaText = '';
        pendingUsage = null;
        // Continue the loop (do NOT break — we want the model to try again)
        continue;
      }

      // Save the assistant message and emit message_end now that we know the
      // response is legitimate (not a hallucinated action).
      // IMPORTANT: save to DB first so the message exists before message_end
      // signals the client to call invalidateQueries and re-fetch the session.
      if (pendingUsage) {
        const usageToReport = pendingUsage;
        pendingUsage = null;
        // Only save text if there was NO tool call this turn.
        // When there IS a tool call, handleToolCall already saves the proposal
        // as the single assistant message for this turn. Saving a second
        // assistant message would create an invalid consecutive-assistant
        // sequence that the Anthropic API rejects.
        if (deltaText && !currentTurnHadToolCall) {
          await this.saveMessage('assistant', deltaText, usageToReport);
          this.messages.push({ role: 'assistant', content: deltaText });
        }
        this.eventHandler({ type: 'message_end', usage: usageToReport });
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
  private async handleToolCall(toolCall: ToolCall, precedingText = ''): Promise<boolean> {
    // ── Task 4: Safety Brake ─────────────────────────────────────────────────
    // Only applies in interactive (non-agentic) mode. In autoExecute mode the
    // user already approved the full plan, so rapid sequential tool calls are
    // expected and should NOT be throttled.
    if (!this.config.autoExecute) {
      const now = Date.now();
      this.toolCallTimestamps = this.toolCallTimestamps.filter(
        (t) => now - t < this.RATE_LIMIT_WINDOW_MS
      );
      this.toolCallTimestamps.push(now);

      if (this.toolCallTimestamps.length > this.RATE_LIMIT_MAX_CALLS) {
        console.error(
          `[Agent] [session:${this.config.sessionId}] Safety Brake triggered: ${this.toolCallTimestamps.length} tool calls in ${this.RATE_LIMIT_WINDOW_MS / 1000}s. Halting run.`
        );
        this.eventHandler({
          type: 'error',
          message: 'Loop detected. Guardian engaged.',
        });
        return true; // halt the run() loop immediately
      }
    }

    let { serverId, toolName } = extractServerIdFromToolName(toolCall.name);
    console.log(`[Agent] [session:${this.config.sessionId}] Tool call (raw):`, toolCall.name, '→ serverId:', serverId, 'toolName:', toolName);

    // ── Task 1: Tool-to-Server Lookup ─────────────────────────────────────
    // If the LLM output a bare tool name (no server prefix), resolve it via
    // the MCP registry before reaching the permission evaluator.
    if (!serverId) {
      const resolvedServerId = findServerIdForTool(toolCall.name);
      if (resolvedServerId) {
        console.log(`[Agent] Resolved bare tool name '${toolCall.name}' → serverId: '${resolvedServerId}'`);
        serverId = resolvedServerId;
        // toolName is already the bare name from extractServerIdFromToolName
      } else {
        // ── Task 3: Kill the Infinite Loop ──────────────────────────────
        // Cannot resolve tool → HALT cleanly. Do NOT send error back to LLM
        // (that would cause a hallucination retry spiral).
        console.error(`[Agent] HALT: Tool '${toolCall.name}' could not be mapped to any active server.`);
        this.eventHandler({
          type: 'error',
          message: `Tool '${toolCall.name}' could not be mapped to an active server. Ensure an MCP server exposing this tool is connected and running.`,
        });
        return true; // true = halt the run() loop
      }
    }

    this.stepCount++;
    this.eventHandler({ type: 'step_count', count: this.stepCount });

    console.log(`[Agent] [session:${this.config.sessionId}] Tool call start:`, toolName, 'input:', JSON.stringify(toolCall.input).substring(0, 100));
    this.eventHandler({
      type: 'tool_call_start',
      tool: toolName,
      server: serverId,
      input: toolCall.input,
    });

    const permResult = await evaluatePermission({
      serverId,
      toolName,
      toolInput: toolCall.input,
    });

    // ── Three-verdict routing ─────────────────────────────────────────────────
    if (permResult.verdict === 'DENY') {
      console.log(`[Agent] [session:${this.config.sessionId}] DENIED by permission guard:`, permResult.reason);
      this.eventHandler({
        type: 'tool_call_result',
        outcome: 'denied',
        reason: permResult.reason,
      });

      await this.logActivity(serverId, toolName, toolCall.input, 'denied', permResult.reason);

      // Persist the assistant tool_use + denial tool_result as a matched pair so
      // that when history is replayed the Anthropic API sees a valid sequence.
      // Without both rows the orphan-filter would drop the tool_result, leaving
      // a bare tool_use block that causes a 400 on the next LLM call.
      const toolCallPayload = JSON.stringify([{
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.input,
      }]);
      await this.saveMessage('assistant', '', undefined, toolCallPayload, toolCall.id, 'denied');

      const denyContent = `Tool call denied: ${permResult.reason}`;
      await this.saveMessage('tool', denyContent, undefined, undefined, toolCall.id);

      this.messages.push({
        role: 'assistant',
        content: '',
        toolCallId: toolCall.id,
        toolCalls: toolCallPayload,
      });
      this.messages.push({
        role: 'tool',
        content: denyContent,
        toolCallId: toolCall.id,
        toolName,
      });

      return false;
    }

    // ── ALLOW_SILENT: trusted zone — run immediately, no human pause ──────────
    if (permResult.verdict === 'ALLOW_SILENT') {
      console.log(`[Agent] [session:${this.config.sessionId}] ALLOW_SILENT: Trusted zone hit for`, toolName);
      return await this.executeToolDirectly(toolCall, serverId, toolName, precedingText, true);
    }

    // ── Auto-execute mode (pipelines) ─────────────────────────────────────────
    if (this.config.autoExecute) {
      return await this.executeToolDirectly(toolCall, serverId, toolName, precedingText);
    }

    // ── Proposal mode (web UI — requires human approval) ─────────────────────
    this.messages.push({
      role: 'assistant',
      content: precedingText,
      toolCallId: toolCall.id,
      toolName,
    });

    // Save with BARE tool name (not serverId__toolName) so history stays clean.
    // Use the model's actual preceding prose as the content — this preserves the
    // assistant's reasoning text in the DB so history replays correctly.
    const toolCallPayload = JSON.stringify([{ id: toolCall.id, name: toolName, arguments: toolCall.input }]);
    await this.saveMessage(
      'assistant',
      precedingText,
      undefined,
      toolCallPayload,
      toolCall.id,
      'pending'  // ── State machine: this proposal is awaiting human decision
    );

    this.eventHandler({
      type: 'proposal',
      id: toolCall.id,
      tool: `${serverId}:${toolName}`,
      input: toolCall.input,
    });

    return true;
  }

  /** Execute a tool call immediately — used in autoExecute (pipeline) mode and ALLOW_SILENT (trusted zone). */
  private async executeToolDirectly(
    toolCall: ToolCall,
    serverId: string,
    toolName: string,
    precedingText = '',
    silent = false,     // true = triggered by ALLOW_SILENT verdict
  ): Promise<boolean> {
    // ── CRITICAL: record the assistant's tool_use BEFORE any tool_result ──────
    // The Anthropic API requires every tool_result to be immediately preceded
    // by an assistant message containing the matching tool_use block. Without
    // this, subsequent turns get a 400 "unexpected tool_use_id" error.
    const toolCallPayload = JSON.stringify([{
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.input,
    }]);
    this.messages.push({
      role: 'assistant',
      content: precedingText,
      toolCallId: toolCall.id,
      toolCalls: toolCallPayload,
    });
    await this.saveMessage('assistant', precedingText, undefined, toolCallPayload, toolCall.id, 'executed');

    const server = getMCPServer(serverId);

    if (!server || !server.client.isConnected()) {
      const reason = `MCP server "${serverId}" is not connected`;
      console.log('[Agent] Auto-execute FAILED:', reason);
      this.eventHandler({ type: 'tool_call_result', outcome: 'denied', reason });
      this.messages.push({
        role: 'tool',
        content: `Tool execution failed: ${reason}`,
        toolCallId: toolCall.id,
        toolName,
      });
      await this.saveMessage('tool', `Tool execution failed: ${reason}`, undefined, undefined, toolCall.id);
      return false;
    }

    // Ask the approval gate (if any) before executing.
    if (this.config.approvalFn) {
      let approved: boolean;
      try {
        approved = await this.config.approvalFn({ serverId, toolName, input: toolCall.input });
      } catch (err) {
        approved = false;
        console.error('[Agent] approvalFn threw:', err);
      }

      if (!approved) {
        const reason = 'Denied by user';
        console.log('[Agent] Auto-execute denied by approvalFn:', toolName);
        this.eventHandler({ type: 'tool_call_result', outcome: 'denied', reason });
        await this.logActivity(serverId, toolName, toolCall.input, 'denied', reason);
        const denyContent = `Tool call denied by user.`;
        this.messages.push({ role: 'tool', content: denyContent, toolCallId: toolCall.id, toolName });
        await this.saveMessage('tool', denyContent, undefined, undefined, toolCall.id);
        return false;
      }
    }

    // ── Fix 5: Validate tool call args against declared schema ──────────────
    const toolDef = getToolDefinition(serverId, toolName);
    if (toolDef) {
      const schemaCheck = validateToolCallArgs(toolCall.input, toolDef.inputSchema);
      if (!schemaCheck.valid) {
        const reason = `Tool call contains undeclared parameters: ${schemaCheck.unexpectedKeys.join(', ')}. Possible exfiltration attempt.`;
        console.warn('[Agent] Schema validation failed:', reason);
        this.eventHandler({ type: 'tool_call_result', outcome: 'denied', reason });
        await this.logActivity(serverId, toolName, toolCall.input, 'denied', reason);
        const denyContent = `Tool call denied: ${reason}`;
        this.messages.push({ role: 'tool', content: denyContent, toolCallId: toolCall.id, toolName });
        await this.saveMessage('tool', denyContent, undefined, undefined, toolCall.id);
        return false;
      }
    }

    // ── Fix 4: Scan outbound tool args for leaked secrets ─────────────────
    const OUTBOUND_TOOL_PATTERNS = [
      'webfetch', 'fetch', 'http_request', 'send_message', 'send_email',
      'post', 'slack_post', 'webhook', 'notify', 'upload',
    ];
    const lowerToolName = toolName.toLowerCase();
    const isOutbound = OUTBOUND_TOOL_PATTERNS.some(p => lowerToolName.includes(p));
    if (isOutbound && scanToolArgsForSecrets(toolCall.input)) {
      const reason = 'Potential secret exfiltration detected in outbound tool arguments';
      console.warn('[Agent] Outbound secret scan blocked:', toolName);
      this.eventHandler({ type: 'tool_call_result', outcome: 'denied', reason });
      await this.logActivity(serverId, toolName, toolCall.input, 'denied', reason);
      const denyContent = `Tool call denied: ${reason}`;
      this.messages.push({ role: 'tool', content: denyContent, toolCallId: toolCall.id, toolName });
      await this.saveMessage('tool', denyContent, undefined, undefined, toolCall.id);
      return false;
    }

    const startTime = Date.now();
    try {
      const result = await server.client.callTool(toolName, toolCall.input);
      const latency = Date.now() - startTime;
      const resultStr = JSON.stringify(result);

      // ── Fix 3: Scan tool results for leaked secrets before LLM injection ──
      const secretScan = scanAndRedactSecrets(resultStr);
      if (secretScan.found) {
        console.warn(`[Agent] Redacted ${secretScan.count} secret(s) from tool result of ${toolName}`);
      }
      const safeResultStr = secretScan.found ? secretScan.redacted : resultStr;

      console.log(`[Agent] [session:${this.config.sessionId}] Auto-execute OK:`, toolName, 'latency:', latency, 'ms');
      this.eventHandler({ type: 'tool_call_result', outcome: 'allowed', result });
      await this.logActivity(serverId, toolName, toolCall.input, silent ? 'auto_approved' : 'allowed', undefined, latency);

      const toolResultContent = `Tool result: ${safeResultStr}`;
      this.messages.push({
        role: 'tool',
        content: toolResultContent,
        toolCallId: toolCall.id,
        toolName,
      });
      await this.saveMessage('tool', toolResultContent, undefined, undefined, toolCall.id);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[Agent] Auto-execute ERROR:', toolName, errMsg);
      this.eventHandler({ type: 'tool_call_result', outcome: 'denied', reason: errMsg });
      await this.logActivity(serverId, toolName, toolCall.input, 'denied', errMsg);

      const failContent = `Tool execution failed: ${errMsg}`;
      this.messages.push({
        role: 'tool',
        content: failContent,
        toolCallId: toolCall.id,
        toolName,
      });
      await this.saveMessage('tool', failContent, undefined, undefined, toolCall.id);
    }

    // Do NOT halt the loop — let the agent continue to produce a text response.
    return false;
  }

  private async saveMessage(
    role: 'user' | 'assistant' | 'tool',
    content: string,
    usage?: { inputTokens: number; outputTokens: number },
    toolCalls?: string,
    toolCallId?: string,
    status?: string,
    parentId?: string | null,
    isActive = 1
  ): Promise<string> {
    console.log(`[Agent] [session:${this.config.sessionId}] Saving message:`, role, 'content length:', content.length);
    const db = getDrizzleDb();
    const messageId = nanoid();
    const pid = parentId === undefined ? this.lastMessageId : parentId;

    try {
      await db.insert(schema.messages).values({
        id: messageId,
        sessionId: this.config.sessionId,
        role,
        content,
        toolCalls,
        toolCallId,
        status,
        parentId: pid,
        isActive,
        model: role === 'assistant' ? this.config.model : undefined,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        createdAt: new Date(),
      });
      console.log(`[Agent] [session:${this.config.sessionId}] Message saved: ${messageId} (parent: ${pid})`);
      this.lastMessageId = messageId;
      return messageId;
    } catch (e) {
      console.error('[Agent] Failed to save message:', e instanceof Error ? e.message : e);
      return messageId; // Return something even on failure
    }
  }

  private async logActivity(
    serverId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    outcome: 'allowed' | 'denied' | 'auto_approved',
    reason?: string,
    latency?: number
  ): Promise<void> {
    try {
      const db = getDrizzleDb();
      await db.insert(schema.activityLog).values({
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
    } catch (e) {
      // Non-fatal: activity log failures must never crash the agent run.
      // Common cause: session or server row was deleted while the agent was
      // mid-flight (e.g. user deleted the conversation during a Discord
      // approval wait). Log the warning and continue.
      console.warn('[Agent] Failed to write activity log (non-fatal):', e instanceof Error ? e.message : e);
    }
  }

  private async generateTitleIfNeeded(userMessage: string): Promise<void> {
    const session = getSession(this.config.sessionId);
    if (!session || (session.title && session.title !== 'New Conversation')) {
      return; // Already has a custom title
    }

    try {
      const provider = getProviderForModel(this.config.model);
      let title = '';

      await provider.chat(
        this.config.model,
        [
          {
            role: 'system',
            content: 'You are a title generator. Output ONLY a concise 3-5 word title for the user\'s request. No quotes, no punctuation at the end, no explanation.'
          },
          { role: 'user', content: userMessage.substring(0, 300) }
        ],
        [], // no tools
        (delta: StreamDelta) => {
          if (delta.type === 'text_delta' && delta.content) {
            title += delta.content;
          }
        }
      );

      title = title.trim().replace(/^["']|["']$/g, '').substring(0, 60);
      if (title) {
        updateSession(this.config.sessionId, undefined, { title });
        this.eventHandler({ type: 'session_renamed', sessionId: this.config.sessionId, newTitle: title });
        console.log('[Agent] Auto-titled session:', title);
      }
    } catch (e: any) {
      console.error('[Agent] Title generation error:', e?.message || e);
    }
  }
}

export function createAgentRuntime(config: AgentConfig, eventHandler: EventHandler): AgentRuntime {
  return new AgentRuntime(config, eventHandler);
}
