import { createAgentRuntime, getSession, type AgentEvent, type AgentConfig } from '../agent/index.js';
import { getActiveSettings } from '../config.js';
import { getMCPServer } from '../mcp/registry.js';
import { extractServerIdFromToolName } from '../permissions/index.js';
import { getDrizzleDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import { nanoid } from 'nanoid';
import {
  createAgenticRun,
  getAgenticRun,
  updateAgenticRun,
  addPendingAction,
  type AgenticPlanStep,
} from '../agent/agenticRun.js';
import { getProviderForModel, type StreamDelta } from '../llm/index.js';

export type ApprovalFn = NonNullable<AgentConfig['approvalFn']>;

/**
 * Called by a pipeline adapter when the session ID it holds is no longer in the
 * database (e.g. the user deleted the conversation from the web UI). Should
 * return a new valid session ID, or null if recovery is not possible.
 */
export type SessionRecoveryFn = () => Promise<string | null>;

// ── New types for the Discord batch-approval and agentic flows ────────────────

/** A single MCP tool call proposed by the agent, awaiting user approval. */
export type Proposal = {
  /** Tool call ID assigned by the LLM (matches the assistant DB row's toolCallId). */
  id: string;
  /** Tool identifier in "serverId:toolName" format as emitted by the runtime. */
  tool: string;
  /** Raw input arguments the LLM passed for this tool call. */
  input: Record<string, unknown>;
};

/**
 * Entry in the `pendingApprovals` map inside `DiscordPipeline`.
 * Created by `runWithBatchApprovalAsync` (batch approval) or by
 * `DiscordPipeline.handleAgentCommandAsync` (plan / checkpoint approval).
 * Resolved when the user clicks a Discord button.
 */
export type PendingApproval = {
  resolve: (result: { approved: boolean; checkpointStepIdx?: number }) => void;
  authorId: string;
  /**
   * Mutated by the StringSelectMenu interaction handler BEFORE the Approve
   * button fires.  The button handler reads this value when resolving.
   */
  checkpointStepIdx?: number;
};

/**
 * Passed to `runWithBatchApprovalAsync` by the Discord pipeline.
 * Called once per approval round with the current set of proposals and
 * the `approvalId` that was registered in `pendingApprovals` before the
 * call.  Should send the approval embed and return — the promise resolution
 * is handled separately via the button interaction handler.
 */
export type BatchApprovalSendFn = (
  proposals: Proposal[],
  approvalId: string,
) => Promise<void>;

/**
 * Callback supplied to `runAgenticTaskAsync` by the Discord pipeline.
 * Shows the generated plan to the user (plan embed + Approve/Deny buttons)
 * and resolves once the user makes a decision.
 */
export type AgenticApprovalFn = (
  plan: AgenticPlanStep[],
) => Promise<{ approved: boolean; checkpointStepIdx?: number }>;

/**
 * Callback supplied to `runAgenticTaskAsync`.
 * Called unconditionally after phase 1 completes when `requireFinalApproval`
 * is true (regardless of whether the LLM emitted any marker token).
 *
 * @param pendingActions  All tool calls executed during phase 1.
 * @param isEndOfPlan     True when there is no phase 2 (checkpoint is at the end).
 * @returns true → proceed (run phase 2 or finish),  false → cancel.
 */
export type AgenticCheckpointFn = (
  pendingActions: Array<{ tool: string; server: string; input: Record<string, unknown> }>,
  isEndOfPlan: boolean,
) => Promise<boolean>;

// ─────────────────────────────────────────────────────────────────────────────
// Backward-compatible single-shot runner (Telegram / LINE pipelines)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the agent for a single pipeline message and return the assembled text
 * response.  Tool-call events are processed internally but not surfaced here —
 * only the final assistant text is returned to the calling pipeline adapter.
 */
export async function runAgentForPipelineAsync(
  sessionId: string,
  userMessage: string,
  approvalFn?: ApprovalFn,
  sessionRecoveryFn?: SessionRecoveryFn,
  onToolCallStart?: (tool: string, server: string) => void,
): Promise<string> {
  let resolvedSessionId = sessionId;
  let session = getSession(resolvedSessionId);

  if (!session) {
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
    } else if (event.type === 'tool_call_start' && onToolCallStart) {
      onToolCallStart(event.tool, event.server);
    }
  };

  await createAgentRuntime(
    {
      sessionId: resolvedSessionId,
      model: session.model || config.DEFAULT_MODEL,
      personality: session.personality || config.PERSONALITY,
      mode: session.mode,
      maxSteps: config.MAX_STEPS,
      autoExecute: true,
      approvalFn,
    },
    eventHandler,
  ).run(userMessage);

  return textParts.join('').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Discord batch-approval primitives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run ONE LLM turn in proposal mode (autoExecute: false).
 * The agent emits `proposal` events for each tool call it wants to make
 * but does NOT execute any of them.  Returns any prose text produced plus
 * the list of pending tool-call proposals.
 *
 * @param sessionId       Active session ID.
 * @param userMessage     User's message for this turn (omit for continuation turns).
 * @param recoveryFn      Optional session-recovery callback.
 * @param onToolCallStart Optional callback fired when the agent emits tool_call_start.
 * @returns { text, proposals, resolvedSessionId }
 */
export async function runAgentStepAsync(
  sessionId: string,
  userMessage?: string,
  recoveryFn?: SessionRecoveryFn,
  onToolCallStart?: (tool: string, server: string) => void,
): Promise<{ text: string; proposals: Proposal[]; resolvedSessionId: string }> {
  let resolvedSessionId = sessionId;
  let session = getSession(resolvedSessionId);

  if (!session) {
    if (recoveryFn) {
      console.warn(`[PipelineRunner] Session ${resolvedSessionId} missing — attempting recovery`);
      const newId = await recoveryFn();
      if (newId) {
        resolvedSessionId = newId;
        session = getSession(resolvedSessionId);
        console.log(`[PipelineRunner] Session recovered: ${resolvedSessionId}`);
      }
    }
    if (!session) throw new Error(`Pipeline session ${sessionId} not found`);
  }

  const config = getActiveSettings();
  const textParts: string[] = [];
  const proposals: Proposal[] = [];

  await createAgentRuntime(
    {
      sessionId: resolvedSessionId,
      model: session.model || config.DEFAULT_MODEL,
      personality: session.personality || config.PERSONALITY,
      mode: session.mode,
      maxSteps: config.MAX_STEPS,
      // ← Proposal mode: tools are NOT auto-executed; the runtime emits
      //   `proposal` events and halts the loop after the first tool call.
      autoExecute: false,
    },
    (event: AgentEvent) => {
      if (event.type === 'text_delta') {
        textParts.push(event.content);
      } else if (event.type === 'proposal') {
        proposals.push({ id: event.id, tool: event.tool, input: event.input });
      } else if (event.type === 'tool_call_start' && onToolCallStart) {
        onToolCallStart(event.tool, event.server);
      }
    },
  ).run(userMessage);

  return { text: textParts.join('').trim(), proposals, resolvedSessionId };
}

/**
 * Execute each approved proposal by calling the actual MCP tool and writing
 * a `tool` role message row to the database so the conversation history
 * remains internally consistent for the next LLM call.
 */
export async function executeApprovedProposalsAsync(
  sessionId: string,
  proposals: Proposal[],
  onToolCallStart?: (tool: string, server: string) => void,
): Promise<void> {
  const db = getDrizzleDb();

  for (const proposal of proposals) {
    const { serverId, toolName } = extractServerIdFromToolName(proposal.tool);
    onToolCallStart?.(toolName, serverId);

    const server = getMCPServer(serverId);
    if (!server || !server.client.isConnected()) {
      const failContent = `Tool execution failed: MCP server "${serverId}" is not connected`;
      await db.insert(schema.messages).values({
        id: nanoid(),
        sessionId,
        role: 'tool',
        content: failContent,
        toolCallId: proposal.id,
        createdAt: new Date(),
      }).catch((e) =>
        console.error('[PipelineRunner] Failed to save tool-error message:', e instanceof Error ? e.message : e),
      );
      continue;
    }

    try {
      const result = await server.client.callTool(toolName, proposal.input);
      await db.insert(schema.messages).values({
        id: nanoid(),
        sessionId,
        role: 'tool',
        content: `Tool result: ${JSON.stringify(result)}`,
        toolCallId: proposal.id,
        createdAt: new Date(),
      }).catch((e) =>
        console.error('[PipelineRunner] Failed to save tool-result message:', e instanceof Error ? e.message : e),
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await db.insert(schema.messages).values({
        id: nanoid(),
        sessionId,
        role: 'tool',
        content: `Tool execution failed: ${errMsg}`,
        toolCallId: proposal.id,
        createdAt: new Date(),
      }).catch((e) =>
        console.error('[PipelineRunner] Failed to save tool-error message:', e instanceof Error ? e.message : e),
      );
    }
  }
}

/**
 * Write denial `tool` role rows for all proposals so the conversation history
 * stays valid — every tool_use assistant message must have a matching
 * tool_result row or the Anthropic API rejects subsequent calls with 400.
 */
export async function denyProposalsAsync(
  sessionId: string,
  proposals: Proposal[],
): Promise<void> {
  const db = getDrizzleDb();
  for (const proposal of proposals) {
    await db.insert(schema.messages).values({
      id: nanoid(),
      sessionId,
      role: 'tool',
      content: 'Tool call denied by user.',
      toolCallId: proposal.id,
      createdAt: new Date(),
    }).catch((e) =>
      console.error('[PipelineRunner] Failed to save denial message:', e instanceof Error ? e.message : e),
    );
  }
}

/**
 * Per-turn batch approval loop for Discord regular messages.
 *
 * Flow for each round:
 *   1. `runAgentStepAsync` → gather proposals + any text.
 *   2. If no proposals, the agent produced a final text response → done.
 *   3. Register a pending approval entry, then call `sendFn` to show the embed.
 *   4. Await the user's button click (max 60 s; auto-denies on timeout).
 *   5a. Approved → `executeApprovedProposalsAsync` → loop.
 *   5b. Denied  → `denyProposalsAsync` → break.
 *
 * @param sendFn          Sends the batch-approval embed to Discord.
 * @param authorId        Discord user ID; only this user can click the buttons.
 * @param sessionId       Active session ID.
 * @param userMessage     The user's original message text.
 * @param pipelineName    Used in log messages.
 * @param pendingApprovals Shared map owned by `DiscordPipeline`.
 * @param recoveryFn      Optional session-recovery callback.
 * @param onToolCallStart Optional presence / indicator callback.
 * @returns The assembled final text response (may be empty if all rounds had tool calls).
 */
export async function runWithBatchApprovalAsync(
  sendFn: BatchApprovalSendFn,
  authorId: string,
  sessionId: string,
  userMessage: string,
  pipelineName: string,
  pendingApprovals: Map<string, PendingApproval>,
  recoveryFn?: SessionRecoveryFn,
  onToolCallStart?: (tool: string, server: string) => void,
): Promise<string> {
  const MAX_ROUNDS = 10;
  const APPROVAL_TIMEOUT_MS = 60_000;

  let resolvedSessionId = sessionId;
  const allTextParts: string[] = [];
  let currentMessage: string | undefined = userMessage;
  let sessionApproved = false; // Once user approves, auto-approve remaining rounds

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { text, proposals, resolvedSessionId: sid } = await runAgentStepAsync(
      resolvedSessionId,
      currentMessage,
      recoveryFn,
      onToolCallStart,
    );
    resolvedSessionId = sid;
    currentMessage = undefined; // only pass userMessage on the first round

    if (text) allTextParts.push(text);

    if (proposals.length === 0) {
      // No tool calls — agent produced its final text response.
      break;
    }

    // ── Session-level auto-approve ────────────────────────────────────────────
    // Once the user clicks "Approve All" in the first round, subsequent rounds
    // within the same message are auto-approved without prompting again.
    if (sessionApproved) {
      console.log(`[PipelineRunner:${pipelineName}] Auto-approving ${proposals.length} proposal(s) (session approved)`);
      await executeApprovedProposalsAsync(resolvedSessionId, proposals, onToolCallStart);
      continue;
    }

    // ── Register the pending approval BEFORE sending the embed ────────────────
    // The button handler will look up this entry by approvalId and resolve it.
    const approvalId = nanoid(12);
    const approvalPromise = new Promise<{ approved: boolean; checkpointStepIdx?: number }>(
      (resolve) => {
        pendingApprovals.set(approvalId, { resolve, authorId });
      },
    );

    const timeoutId = setTimeout(() => {
      const pending = pendingApprovals.get(approvalId);
      if (pending) {
        pendingApprovals.delete(approvalId);
        console.warn(`[PipelineRunner:${pipelineName}] Batch approval timed out (${approvalId})`);
        pending.resolve({ approved: false });
      }
    }, APPROVAL_TIMEOUT_MS);

    try {
      await sendFn(proposals, approvalId);
    } catch (err) {
      // Can't send the embed — deny all proposals and abort the loop.
      clearTimeout(timeoutId);
      pendingApprovals.delete(approvalId);
      await denyProposalsAsync(resolvedSessionId, proposals);
      console.error(`[PipelineRunner:${pipelineName}] sendFn threw:`, err);
      break;
    }

    const result = await approvalPromise;
    clearTimeout(timeoutId);

    if (result.approved) {
      sessionApproved = true; // Auto-approve all subsequent rounds
      await executeApprovedProposalsAsync(resolvedSessionId, proposals, onToolCallStart);
    } else {
      await denyProposalsAsync(resolvedSessionId, proposals);
      break; // User denied — stop asking for more approvals.
    }
  }

  return allTextParts.join('\n\n').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Agentic task runner — full plan / phase / checkpoint flow
// ─────────────────────────────────────────────────────────────────────────────

const PLAN_SYSTEM_PROMPT = 'You are a step-by-step planning assistant. Output only the plan, no extra text.';

function buildPlanPrompt(goal: string): string {
  return `You are a planning assistant. The user wants you to accomplish the following goal autonomously:

Goal: ${goal}

Break this goal into a clear, numbered list of concrete steps. For each step that requires a tool action, include the tool name in parentheses at the end. Keep descriptions brief (one line each).

CRITICAL requirements:
1. Output ONLY the numbered step list — no preamble, no markdown headers.
2. Format: "N. [description] (tool: toolName)" — omit the tool part if no tool is needed.
3. Maximum 10 steps.
4. Be specific about what you will do in each step.

Example:
1. List the contents of the current directory (tool: list_directory)
2. Read each file to understand its purpose (tool: read_file)
3. Summarize the findings in plain text

Now generate the plan:`;
}

function parsePlanText(text: string): AgenticPlanStep[] {
  const steps: AgenticPlanStep[] = [];
  const lines = text.split('\n').filter((l) => l.trim());

  for (const line of lines) {
    const match = line.match(/^\d+\.\s+(.+?)(?:\s+\(tool:\s*([^)]+)\))?$/);
    if (match) {
      const [, description, tool] = match;
      steps.push({
        id: nanoid(),
        description: description.trim(),
        tool: tool?.trim(),
      });
    }
  }

  // Fallback: loose numbered-line parser if the regex matched nothing.
  if (steps.length === 0) {
    const looseLines = lines.filter((l) => /^\d+\./.test(l.trim()));
    for (const line of looseLines) {
      steps.push({
        id: nanoid(),
        description: line.replace(/^\d+\.\s*/, '').trim(),
      });
    }
  }

  return steps;
}

function buildPhaseMessage(
  goal: string,
  steps: AgenticPlanStep[],
  stepOffset: number,
  isPhase2: boolean,
): string {
  const stepsText = steps
    .map((s, i) => `${stepOffset + i + 1}. ${s.description}${s.tool ? ` (tool: ${s.tool})` : ''}`)
    .join('\n');

  const intro = isPhase2
    ? `[AGENTIC MODE ACTIVE] You are continuing the execution of a multi-phase plan. The first phase has already been completed and approved by the user.\n\nGoal: ${goal}\n\nRemaining steps to execute now:\n${stepsText}`
    : `[AGENTIC MODE ACTIVE] You must now autonomously execute the following plan to accomplish this goal.\n\nGoal: ${goal}\n\nPlan:\n${stepsText}`;

  return `${intro}

CRITICAL RULES:
- Execute EVERY step in order using real tool calls. Do NOT skip steps.
- Do NOT ask for confirmation between steps — execute them back-to-back.
- Do NOT describe what you "would" do — actually DO it with tool calls.
- A single step may require MULTIPLE tool calls — complete all of them before moving on.
- After completing all steps, write a brief plain-text summary of what was accomplished.

Begin now.`;
}

/**
 * Full agentic task runner for the Discord `/agent` slash command.
 *
 * Flow:
 *   1. Generate a plan via the LLM.
 *   2. Call `approvalFn` → user reviews the plan, optionally selects a
 *      checkpoint step, then approves or denies.
 *   3. Run phase 1 (all steps, or only up to the checkpoint step if one
 *      was selected).
 *   4. If `requireFinalApproval` is true and `onCheckpoint` was provided,
 *      call `onCheckpoint` unconditionally after phase 1 resolves.
 *      (No MARKER tokens — the phase ends naturally because we sliced the plan.)
 *   5. If the checkpoint is confirmed and there are remaining steps,
 *      run phase 2.
 *   6. Return the agent's summary text.
 *
 * @param sessionId            Active session ID.
 * @param goal                 The high-level goal for the agent.
 * @param approvalFn           Shows the plan to the user and awaits decision.
 * @param recoveryFn           Optional session-recovery callback.
 * @param onProgress           Optional per-tool progress callback.
 * @param onToolCallStart      Optional presence / indicator callback.
 * @param requireFinalApproval When true, pause for checkpoint after phase 1.
 * @param onCheckpoint         Shows the checkpoint review UI to the user.
 * @returns Summary string from the agent (or a status message).
 */
export async function runAgenticTaskAsync(
  sessionId: string,
  goal: string,
  approvalFn: AgenticApprovalFn,
  recoveryFn?: SessionRecoveryFn,
  onProgress?: (step: number, total: number, description: string) => void,
  onToolCallStart?: (tool: string, server: string) => void,
  requireFinalApproval?: boolean,
  onCheckpoint?: AgenticCheckpointFn,
): Promise<string> {
  // ── Session recovery ──────────────────────────────────────────────────────
  let resolvedSessionId = sessionId;
  let session = getSession(resolvedSessionId);

  if (!session) {
    if (recoveryFn) {
      const newId = await recoveryFn();
      if (newId) {
        resolvedSessionId = newId;
        session = getSession(resolvedSessionId);
      }
    }
    if (!session) throw new Error(`Session ${sessionId} not found`);
  }

  const config = getActiveSettings();

  // ── Generate plan via LLM ─────────────────────────────────────────────────
  const run = createAgenticRun({
    sessionId: resolvedSessionId,
    goal,
    requireFinalApproval: requireFinalApproval ?? false,
  });

  let planText = '';
  try {
    const provider = getProviderForModel(session.model || config.DEFAULT_MODEL);
    await provider.chat(
      session.model || config.DEFAULT_MODEL,
      [
        { role: 'system', content: PLAN_SYSTEM_PROMPT },
        { role: 'user', content: buildPlanPrompt(goal) },
      ],
      [],
      (delta: StreamDelta) => {
        if (delta.type === 'text_delta' && delta.content) planText += delta.content;
      },
    );
  } catch (err) {
    updateAgenticRun(run.id, { status: 'cancelled' });
    throw new Error(
      `Plan generation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const plan = parsePlanText(planText);
  if (plan.length === 0) {
    updateAgenticRun(run.id, { status: 'cancelled' });
    throw new Error('LLM returned an empty plan — cannot proceed.');
  }

  updateAgenticRun(run.id, { plan, status: 'awaiting_approval' });

  // ── Show plan to user and wait for approval ───────────────────────────────
  const approval = await approvalFn(plan);
  if (!approval.approved) {
    updateAgenticRun(run.id, { status: 'cancelled' });
    return 'Task cancelled — plan was denied.';
  }

  // ── Resolve checkpoint configuration ─────────────────────────────────────
  const cpIdx = approval.checkpointStepIdx;
  const hasCheckpoint = (requireFinalApproval ?? false) && onCheckpoint !== undefined;
  // A mid-plan checkpoint: there are steps AFTER cpIdx that belong to phase 2.
  const isMidPlanCheckpoint =
    hasCheckpoint &&
    cpIdx !== undefined &&
    cpIdx < plan.length - 1;

  if (cpIdx !== undefined) {
    updateAgenticRun(run.id, { checkpointStepIdx: cpIdx });
  }

  updateAgenticRun(run.id, { status: 'running' });

  // ── Phase runner ──────────────────────────────────────────────────────────
  const summaryParts: string[] = [];
  let toolCallCount = 0;

  const runPhase = async (steps: AgenticPlanStep[], stepOffset: number): Promise<void> => {
    const phaseMessage = buildPhaseMessage(goal, steps, stepOffset, stepOffset > 0);

    await createAgentRuntime(
      {
        sessionId: resolvedSessionId,
        model: session!.model || config.DEFAULT_MODEL,
        personality: session!.personality || config.PERSONALITY,
        mode: session!.mode || 'build',
        maxSteps: config.MAX_STEPS,
        autoExecute: true,
        // Record every tool call so the checkpoint embed can list them.
        approvalFn: async (call) => {
          addPendingAction(run.id, {
            tool: call.toolName,
            server: call.serverId,
            input: call.input,
          });
          return true; // always allow — user already approved the plan
        },
      },
      (event: AgentEvent) => {
        if (event.type === 'text_delta') {
          summaryParts.push(event.content);
        } else if (event.type === 'tool_call_start') {
          onToolCallStart?.(event.tool, event.server);
          onProgress?.(toolCallCount++, plan.length, event.tool);
        }
      },
    ).run(phaseMessage);
  };

  // ── Phase 1 ───────────────────────────────────────────────────────────────
  const phase1Steps = isMidPlanCheckpoint ? plan.slice(0, cpIdx! + 1) : plan;
  await runPhase(phase1Steps, 0);

  // ── Checkpoint ────────────────────────────────────────────────────────────
  // Per the brief: always call onCheckpoint unconditionally when hasCheckpoint
  // is true — never rely on MARKER tokens emitted by the LLM.
  if (hasCheckpoint && onCheckpoint) {
    const latestRun = getAgenticRun(run.id);
    const pendingActions = (latestRun?.pendingActions ?? []).map((a) => ({
      tool: a.tool,
      server: a.server,
      input: a.input,
    }));

    const isEndOfPlan = !isMidPlanCheckpoint;
    updateAgenticRun(run.id, { status: 'awaiting_checkpoint' });

    const confirmed = await onCheckpoint(pendingActions, isEndOfPlan);

    if (!confirmed) {
      updateAgenticRun(run.id, { status: 'cancelled' });
      return 'Task cancelled at checkpoint by user.';
    }

    updateAgenticRun(run.id, { status: 'running' });

    // ── Phase 2 (remaining steps after the checkpoint) ────────────────────
    if (isMidPlanCheckpoint) {
      const phase2Steps = plan.slice(cpIdx! + 1);
      await runPhase(phase2Steps, cpIdx! + 1);
    }
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  updateAgenticRun(run.id, { status: 'done' });

  const summary = summaryParts.join('').trim();
  return summary || `Successfully completed: ${goal}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared utility
// ─────────────────────────────────────────────────────────────────────────────

/** Split a long string into chunks that respect a max byte/char limit. */
export function splitMessage(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.5) splitAt = remaining.lastIndexOf(' ', maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
