/**
 * Tool Interceptor — Security gate for every MCP tool call.
 *
 * Sits between the LLM's tool_use decision and actual MCP execution.
 * Every tool call MUST pass through here before being dispatched.
 *
 * Security checks (in order):
 *   1. PermissionGuard          — is this tool allowed for this server?
 *   2. ActionGate               — is this action irreversible?
 *   3. HumanConfirmation        — if irreversible, pause and ask the user
 *   4. MCP dispatch             — actually call the tool
 *   5. Injection prevention     — only when the server's "promptInjectionPrevention"
 *                                 flag is enabled:
 *        a. Canary leak check   — did the token appear in the result?
 *        b. Sanitizer           — strip known injection patterns from result
 *        c. Step verifier       — heuristic confidence check on output
 *        d. Final verifier      — LLM-vs-LLM intent-match check
 *        e. Human confirmation  — if verifier flags concern, ask user to approve
 */

import { evaluatePermission, extractServerIdFromToolName } from '../permissions/index.js';
import { getPermissionForServer } from '../permissions/store.js';
import { evaluateAction } from './pipeline/actionGate.js';
import { humanConfirmation } from './pipeline/humanConfirmation.js';
import { canaryManager } from './canary.js';
import { sanitizeResults } from './pipeline/sanitizer.js';
import { verifyStep, STEP_VERIFIER_THRESHOLD } from './pipeline/stepVerifier.js';
import { runFinalVerifier } from './pipeline/finalVerifier.js';
import { intentStore } from './pipeline/intentStore.js';
import { getMCPServer } from '../mcp/registry.js';
import { getDb, schema } from '../db/index.js';
import { nanoid } from 'nanoid';
import type { ToolCall } from '../llm/provider.js';
import type { AgentEvent } from './runtime.js';
import type { PipelineStep, StepResult } from './pipeline/index.js';

export type ToolInterceptResult =
  | { outcome: 'executed'; result: string; toolCallId: string }
  | { outcome: 'denied'; reason: string; toolCallId: string }
  | { outcome: 'user_cancelled'; toolCallId: string };

/**
 * Intercept a single tool call from the LLM.
 *
 * @param toolCall        The raw tool_use block from the LLM
 * @param sessionId       Current session (for confirmation routing + activity log)
 * @param wsEmit          WebSocket emitter (for streaming security events to the UI)
 * @param model           LLM model string (needed for final verifier LLM call)
 * @param userMessage     The original user message (for intent store — injection prevention)
 * @returns               What happened: executed with result, denied, or user cancelled
 */
export async function interceptToolCallAsync(
  toolCall: ToolCall,
  sessionId: string,
  wsEmit: (event: AgentEvent) => void,
  model?: string,
  userMessage?: string,
): Promise<ToolInterceptResult> {
  const { serverId, toolName } = extractServerIdFromToolName(toolCall.name);

  if (!serverId) {
    const reason = `Tool name must include server ID (format: "server:tool"), got: "${toolCall.name}"`;
    wsEmit({ type: 'tool_call_result', outcome: 'denied', reason });
    return { outcome: 'denied', reason, toolCallId: toolCall.id };
  }

  // ── 1. PermissionGuard ─────────────────────────────────────────────────────
  const permResult = await evaluatePermission({
    serverId,
    toolName,
    toolInput: toolCall.input,
  });

  if (permResult.verdict === 'DENY') {
    const reason = permResult.reason ?? 'Permission denied';
    console.warn(`[ToolInterceptor] DENIED by PermissionGuard: ${reason}`);
    wsEmit({ type: 'tool_call_start', tool: toolName, server: serverId, input: toolCall.input });
    wsEmit({ type: 'tool_call_result', outcome: 'denied', reason });
    await logActivity(sessionId, serverId, toolName, toolCall.input, 'denied', reason);
    return { outcome: 'denied', reason, toolCallId: toolCall.id };
  }

  // ── 2. ActionGate — is this irreversible? ──────────────────────────────────
  const gateResult = evaluateAction(serverId, toolName, toolCall.input, false);

  wsEmit({
    type: 'tool_call_start',
    tool: toolName,
    server: serverId,
    input: toolCall.input,
    ...(gateResult.isIrreversible ? { irreversible: true, gateReason: gateResult.reason } : {}),
  });

  // ── 3. Human confirmation for irreversible actions ─────────────────────────
  if (gateResult.isIrreversible) {
    console.log(`[ToolInterceptor] Irreversible action — requesting human confirmation`);

    const syntheticStep: PipelineStep = {
      id: nanoid(),
      description: `${toolName} on server "${serverId}"`,
      toolRequired: toolCall.name,
      isIrreversible: true,
      isFinalStep: true,
    };

    const confirmed = await humanConfirmation.request(sessionId, syntheticStep, wsEmit as any);
    if (!confirmed) {
      console.log(`[ToolInterceptor] User denied irreversible action: ${toolCall.name}`);
      wsEmit({ type: 'tool_call_result', outcome: 'denied', reason: 'Denied by user' });
      await logActivity(sessionId, serverId, toolName, toolCall.input, 'denied', 'Denied by user');
      return { outcome: 'user_cancelled', toolCallId: toolCall.id };
    }

    console.log(`[ToolInterceptor] User approved irreversible action: ${toolCall.name}`);
  }

  // ── 4. MCP dispatch ────────────────────────────────────────────────────────
  const server = getMCPServer(serverId);
  if (!server || !server.client.isConnected()) {
    const reason = `MCP server "${serverId}" is not connected`;
    console.error(`[ToolInterceptor] ${reason}`);
    wsEmit({ type: 'tool_call_result', outcome: 'denied', reason });
    await logActivity(sessionId, serverId, toolName, toolCall.input, 'denied', reason);
    return { outcome: 'denied', reason, toolCallId: toolCall.id };
  }

  const start = Date.now();
  let rawResult: unknown;

  try {
    rawResult = await server.client.callTool(toolName, toolCall.input);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[ToolInterceptor] Tool execution failed: ${reason}`);
    wsEmit({ type: 'tool_call_result', outcome: 'denied', reason: `Tool error: ${reason}` });
    await logActivity(sessionId, serverId, toolName, toolCall.input, 'denied', reason, Date.now() - start);
    return { outcome: 'denied', reason, toolCallId: toolCall.id };
  }

  const latency = Date.now() - start;
  const resultText = extractResultText(rawResult);

  // ── 5. Prompt injection prevention (only when flag is enabled) ──────────────
  const serverPerm = getPermissionForServer(serverId);
  // Determine per-tool flag when available
  let perToolFlag = false;
  try {
    const toolDefs = getMCPServer(serverId)?.client?.getTools?.() ?? [];
    // toolDefs entries may expose a per-tool flag as `promptInjectionPrevention` or `pip`
    const match = toolDefs.find((td: any) => {
      const fullName = `${serverId}:${td.name}`;
      return fullName === toolCall.name || td.name === toolName;
    });
    if (match && typeof (match as any).promptInjectionPrevention === 'boolean') {
      perToolFlag = !!(match as any).promptInjectionPrevention;
    }
  } catch {
    // ignore
  }
  const shouldRunPip = serverPerm?.promptInjectionPrevention ?? perToolFlag;
  if (shouldRunPip && model) {
    console.log(`[ToolInterceptor] Running injection prevention checks for ${serverId}:${toolName}`);
    wsEmit({ type: 'pipeline_stage', stage: 'injection_check' });

    const injectionResult = await runInjectionChecksAsync(
      resultText,
      serverId,
      toolName,
      sessionId,
      model,
      userMessage,
      wsEmit,
    );

    if (injectionResult === 'abort') {
      const reason = 'Injection prevention: result flagged and denied by user';
      wsEmit({ type: 'tool_call_result', outcome: 'denied', reason });
      await logActivity(sessionId, serverId, toolName, toolCall.input, 'denied', reason, latency);
      return { outcome: 'user_cancelled', toolCallId: toolCall.id };
    }

    // injectionResult === 'proceed' — checks passed or user approved
  }

  wsEmit({ type: 'tool_call_result', outcome: 'allowed', result: resultText });
  await logActivity(sessionId, serverId, toolName, toolCall.input, 'allowed', undefined, latency);

  return { outcome: 'executed', result: resultText, toolCallId: toolCall.id };
}

// ─── Injection Prevention Checks ─────────────────────────────────────────────

/**
 * Run the prompt injection prevention pipeline on a tool result.
 * Called only when the server's `promptInjectionPrevention` flag is enabled.
 *
 * Checks (deterministic first, then LLM-based):
 *   a. Canary leak — immediate abort if our internal token leaked
 *   b. Sanitizer  — strip and flag known injection patterns
 *   c. Step verifier — heuristic confidence score on the result
 *   d. Final verifier — LLM checks result against user intent
 *   e. Human confirmation if verifier recommends pause
 *
 * Returns 'proceed' if result is clean or user approved, 'abort' if denied.
 */
async function runInjectionChecksAsync(
  resultText: string,
  serverId: string,
  toolName: string,
  sessionId: string,
  model: string,
  userMessage: string | undefined,
  wsEmit: (event: AgentEvent) => void,
): Promise<'proceed' | 'abort'> {

  // a. Canary leak check
  const canaryToken = canaryManager.getToken(sessionId) ?? '';
  if (canaryToken && resultText.includes(canaryToken)) {
    console.warn(`[ToolInterceptor] CANARY LEAK detected in result of ${serverId}:${toolName}`);
    wsEmit({ type: 'canary_leak_detected', step: `${serverId}:${toolName}` });
    // Silent abort — don't tell LLM why
    return 'abort';
  }

  // b. Sanitizer
  const sanitized = sanitizeResults([resultText]);
  if (sanitized.injectionSignalsFound) {
    console.warn(`[ToolInterceptor] Injection signals found in result: ${sanitized.strippedSegments.join(', ')}`);
    wsEmit({ type: 'sanitizer_flagged', strippedSegments: sanitized.strippedSegments });
  }

  // c. Step verifier (heuristic, no LLM call)
  const syntheticStep: PipelineStep = {
    id: nanoid(),
    description: `${toolName} result verification`,
    toolRequired: `${serverId}:${toolName}`,
    isIrreversible: false,
    isFinalStep: true,
  };

  const syntheticStepResult: StepResult = {
    stepId: syntheticStep.id,
    rawOutput: resultText,
    toolCallsMade: [`${serverId}:${toolName}`],
    serverId,
  };

  const stepCheck = verifyStep(syntheticStep, syntheticStepResult, canaryToken);

  wsEmit({
    type: 'step_verified',
    stepId: syntheticStep.id,
    confidence: stepCheck.confidence,
    passed: stepCheck.passed,
    anomalies: stepCheck.anomalies,
  });

  const needsHumanReview = !stepCheck.passed || stepCheck.confidence < STEP_VERIFIER_THRESHOLD || sanitized.injectionSignalsFound;

  // d. Final verifier (LLM-based, only if step check flagged issues or there's an intent to check against)
  let finalVerifierSummary: { confidence: number; matchesIntent: boolean; anomalies: string[] } | undefined;

  if (needsHumanReview || userMessage) {
    // Store intent temporarily for the verifier
    const intentId = userMessage
      ? intentStore.storeIntent(sessionId, userMessage).intentId
      : null;

    // Build a minimal plan shape the verifier expects
    const minimalPlan = {
      goal: userMessage ?? `Execute ${toolName}`,
      steps: [syntheticStep],
      estimatedStepCount: 1,
    };

    const finalCheck = await runFinalVerifier(sanitized, minimalPlan as any, intentId ?? '', model);

    if (intentId) intentStore.clearIntent(intentId);

    finalVerifierSummary = {
      confidence: finalCheck.confidence,
      matchesIntent: finalCheck.matchesIntent,
      anomalies: finalCheck.anomalies,
    };

    // If verifier recommends pausing, ask the user
    if (finalCheck.recommendation === 'pause' || needsHumanReview) {
      console.log(`[ToolInterceptor] Injection verifier flagged result — requesting human review`);
      wsEmit({ type: 'pipeline_halted', reason: 'injection_check_flagged', anomalies: stepCheck.anomalies });

      const reviewStep: PipelineStep = {
        id: nanoid(),
        description: `Review result from ${toolName} on server "${serverId}" — security checks raised concerns`,
        toolRequired: `${serverId}:${toolName}`,
        isIrreversible: false,
        isFinalStep: true,
      };

      const confirmed = await humanConfirmation.request(
        sessionId,
        reviewStep,
        wsEmit as any,
        finalVerifierSummary,
      );

      if (!confirmed) {
        console.log(`[ToolInterceptor] User rejected flagged result from ${serverId}:${toolName}`);
        return 'abort';
      }

      console.log(`[ToolInterceptor] User approved flagged result from ${serverId}:${toolName}`);
    }
  }

  return 'proceed';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractResultText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw === null || raw === undefined) return '';

  // MCP CallToolResult shape: { content: Array<{ type: 'text'; text: string }> }
  if (
    typeof raw === 'object' &&
    'content' in (raw as object) &&
    Array.isArray((raw as any).content)
  ) {
    return (raw as any).content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text as string)
      .join('\n');
  }

  return JSON.stringify(raw);
}

async function logActivity(
  sessionId: string,
  serverId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  outcome: 'allowed' | 'denied' | 'auto_approved',
  reason?: string,
  latency?: number
): Promise<void> {
  try {
    const db = getDb();
    db.insert(schema.activityLog as any).values({
      id: nanoid(),
      sessionId,
      serverId,
      toolName,
      toolInput: JSON.stringify(toolInput),
      outcome,
      reason,
      latency,
      timestamp: new Date(),
    });
  } catch (e) {
    console.warn('[ToolInterceptor] Failed to write activity log:', e);
  }
}
