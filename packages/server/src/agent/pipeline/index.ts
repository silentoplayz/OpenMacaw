import { intentStore } from './intentStore.js';
import { canaryManager } from '../canary.js';
import { planAsync } from '../planner.js';
import { executeStep } from './executor.js';
import { verifyStep, STEP_VERIFIER_THRESHOLD } from './stepVerifier.js';
import { sanitizeResults } from './sanitizer.js';
import { runFinalVerifier } from './finalVerifier.js';
import { evaluateAction } from './actionGate.js';
import { humanConfirmation } from './humanConfirmation.js';
import { getDb, schema } from '../../db/index.js';
import { nanoid } from 'nanoid';

// ─── Shared types (imported by other pipeline modules) ───────────────────────

export interface PipelineStep {
    id: string;
    description: string;
    toolRequired: string | null;
    isIrreversible: boolean;
    isFinalStep: boolean;
}

export interface StepResult {
    stepId: string;
    rawOutput: string;
    toolCallsMade: string[];
    serverId: string;
    error?: string;
}

export type PipelineStatus =
    | 'success'
    | 'planner_error'
    | 'executor_error'
    | 'verifier_abort'
    | 'security_abort'
    | 'user_cancelled';

export interface PipelineResult {
    status: PipelineStatus;
    results?: StepResult[];
    verifierSummary?: Record<string, unknown>;
    reason?: string;
    noTask?: boolean;
}

export const PIPELINE_DEFAULTS = {
    stepVerifierThreshold: STEP_VERIFIER_THRESHOLD,
    finalVerifierProceedThreshold: 0.85,
    finalVerifierAbortThreshold: 0.50,
    plannerMaxRetries: 2,
    maxPipelineSteps: 50,
    canaryEnabled: true,
    sanitizerEnabled: true,
    requireHumanOnFinalStep: true,        // hardcoded — not user-configurable
    requireHumanOnIrreversible: true,     // hardcoded — not user-configurable
} as const;

// ─── Activity logging helpers ────────────────────────────────────────────────

type PipelineLogSeverity = 'info' | 'medium' | 'high' | 'critical';

function logPipelineEvent(
    sessionId: string,
    event: string,
    severity: PipelineLogSeverity,
    details?: Record<string, unknown>
): void {
    try {
        const db = getDb();
        db.insert(schema.pipelineLog as any).values({
            id: nanoid(),
            sessionId,
            event,
            severity,
            details: details ? JSON.stringify(details) : undefined,
            timestamp: Date.now(),
        });
    } catch (e) {
        // Non-fatal: DB may not have pipelineLog table during first run
        console.warn('[Pipeline] Could not write to pipeline_log:', e);
    }
}

// ─── Main Pipeline Orchestrator ──────────────────────────────────────────────

/**
 * Run the full 9-stage prompt injection prevention pipeline.
 *
 * @param sessionId    Active session ID
 * @param userMessage  Raw user message (stored immutably, agents get intentId only)
 * @param model        LLM model to use for planning, execution, and verification
 * @param wsEmit       WebSocket event emitter for the session
 */
export async function runPipelineAsync(
    sessionId: string,
    userMessage: string,
    model: string,
    wsEmit: (event: object) => void
): Promise<PipelineResult> {

    // ── Stage 1: Store intent immutably ────────────────────────────────────────
    const intent = intentStore.storeIntent(sessionId, userMessage);
    const canaryToken = canaryManager.generate(sessionId);

    logPipelineEvent(sessionId, 'pipeline_started', 'info', { intentId: intent.intentId });
    wsEmit({ type: 'pipeline_stage', stage: 'planning' });

    // ── Stage 2: Planner (zero tools, structured JSON, canary injected) ─────────
    const planResult = await planAsync(intent.intentId, canaryToken, model);

    if (!planResult.success) {
        if (planResult.noTask) {
            // Conversational message — no loggable error, just signal caller to use direct chat
            canaryManager.clearToken(sessionId);
            intentStore.clearIntent(intent.intentId);
            return { status: 'planner_error', reason: planResult.error, noTask: true };
        }
        logPipelineEvent(sessionId, 'planner_error', 'high', { error: planResult.error });
        canaryManager.clearToken(sessionId);
        return { status: 'planner_error', reason: planResult.error };
    }

    const plan = planResult.data;
    const results: StepResult[] = [];

    wsEmit({ type: 'pipeline_stage', stage: 'executing' });

    // ── Stages 3 + 4 + 7 + 8: Execute → verify each step ───────────────────────
    for (const step of plan.steps) {

        // Stage 7: Irreversible action gate — check BEFORE execution
        const gateResult = evaluateAction(
            step.toolRequired?.split(':')[0] ?? '',
            step.toolRequired?.split(':')[1] ?? step.toolRequired ?? '',
            {},
            step.isIrreversible
        );

        // Stage 8a: Human confirmation for irreversible actions (hardcoded, non-configurable)
        if (gateResult.isIrreversible) {
            logPipelineEvent(sessionId, 'irreversible_action_gated', 'medium', {
                stepId: step.id,
                reason: gateResult.reason,
            });

            wsEmit({ type: 'pipeline_stage', stage: 'confirming' });

            const confirmed = await humanConfirmation.request(sessionId, step, wsEmit);
            if (!confirmed) {
                logPipelineEvent(sessionId, 'user_rejected', 'info', { stepId: step.id });
                canaryManager.clearToken(sessionId);
                intentStore.clearIntent(intent.intentId);
                return { status: 'user_cancelled' };
            }
            logPipelineEvent(sessionId, 'user_confirmed', 'info', { stepId: step.id });
            wsEmit({ type: 'pipeline_stage', stage: 'executing' });
        }

        // Stage 3: Executor
        const execResult = await executeStep(step, intent.intentId, canaryToken, model, wsEmit);

        // Stage 9: Canary leak check
        if (canaryManager.checkOutput(sessionId, execResult.rawOutput)) {
            logPipelineEvent(sessionId, 'canary_leak', 'critical', { stepId: step.id });
            wsEmit({ type: 'canary_leak_detected', step: step.id });
            canaryManager.clearToken(sessionId);
            intentStore.clearIntent(intent.intentId);
            // Do NOT tell the LLM why it was halted
            return { status: 'security_abort', reason: 'canary_leak' };
        }

        wsEmit({ type: 'pipeline_stage', stage: 'verifying' });

        // Stage 4: Step verifier
        const stepCheck = verifyStep(step, execResult, canaryToken);

        if (stepCheck.containsInjectionSignals) {
            logPipelineEvent(sessionId, 'injection_signal_detected', 'high', {
                stepId: step.id,
                signals: stepCheck.anomalies,
            });
            wsEmit({ type: 'sanitizer_flagged', strippedSegments: stepCheck.anomalies });
        }

        wsEmit({
            type: 'step_verified',
            stepId: step.id,
            confidence: stepCheck.confidence,
            passed: stepCheck.passed,
            anomalies: stepCheck.anomalies,
        });

        if (!stepCheck.passed || stepCheck.confidence < STEP_VERIFIER_THRESHOLD) {
            logPipelineEvent(sessionId, 'step_verifier_failed', 'high', {
                stepId: step.id,
                anomalies: stepCheck.anomalies,
                confidence: stepCheck.confidence,
            });
            wsEmit({
                type: 'pipeline_halted',
                reason: 'step_verifier_failed',
                anomalies: stepCheck.anomalies,
            });

            // Stage 8b: Human confirmation for verifier pause
            const confirmed = await humanConfirmation.request(
                sessionId,
                step,
                wsEmit,
                { confidence: stepCheck.confidence, anomalies: stepCheck.anomalies }
            );
            if (!confirmed) {
                logPipelineEvent(sessionId, 'user_rejected', 'info', { stepId: step.id });
                canaryManager.clearToken(sessionId);
                intentStore.clearIntent(intent.intentId);
                return { status: 'user_cancelled' };
            }
            logPipelineEvent(sessionId, 'user_confirmed', 'info', { stepId: step.id });
        }

        results.push(execResult);
        wsEmit({ type: 'pipeline_stage', stage: 'executing' });
    }

    // ── Stage 5: Sanitizer ──────────────────────────────────────────────────────
    wsEmit({ type: 'pipeline_stage', stage: 'sanitizing' });
    const sanitized = sanitizeResults(results.map((r) => r.rawOutput));

    if (sanitized.injectionSignalsFound) {
        logPipelineEvent(sessionId, 'injection_signal_detected', 'high', {
            strippedSegments: sanitized.strippedSegments,
        });
        wsEmit({ type: 'sanitizer_flagged', strippedSegments: sanitized.strippedSegments });
    }

    // ── Stage 6: Final verifier (pause-only — never abort) ──────────────────────
    // The verifier may suggest pausing for human review but never hard-aborts —
    // false positives from LLM-vs-LLM judgement cause too many legitimate failures.
    wsEmit({ type: 'pipeline_stage', stage: 'final_verify' });
    const finalCheck = await runFinalVerifier(sanitized, plan, intent.intentId, model);

    if (finalCheck.recommendation === 'pause') {
        logPipelineEvent(sessionId, 'final_verifier_pause', 'medium', {
            confidence: finalCheck.confidence,
            anomalies: finalCheck.anomalies,
        });
        const confirmed = await humanConfirmation.request(
            sessionId,
            null,
            wsEmit,
            {
                confidence: finalCheck.confidence,
                matchesIntent: finalCheck.matchesIntent,
                anomalies: finalCheck.anomalies,
            }
        );
        if (!confirmed) {
            logPipelineEvent(sessionId, 'user_rejected', 'info', { phase: 'final_verifier' });
            canaryManager.clearToken(sessionId);
            intentStore.clearIntent(intent.intentId);
            return { status: 'user_cancelled' };
        }
    }

    // ── Stage 8c: Final step always requires human confirmation (hardcoded) ─────
    const finalStep = plan.steps.find((s: PipelineStep) => s.isFinalStep) ?? null;
    if (finalStep) {
        const confirmed = await humanConfirmation.request(
            sessionId,
            finalStep,
            wsEmit,
            {
                confidence: finalCheck.confidence,
                matchesIntent: finalCheck.matchesIntent,
                checklistComplete: finalCheck.checklistComplete,
                anomalies: finalCheck.anomalies,
            }
        );
        if (!confirmed) {
            logPipelineEvent(sessionId, 'user_rejected', 'info', { phase: 'final_step' });
            canaryManager.clearToken(sessionId);
            intentStore.clearIntent(intent.intentId);
            return { status: 'user_cancelled' };
        }
        logPipelineEvent(sessionId, 'user_confirmed', 'info', { phase: 'final_step' });
    }

    // ── Complete ────────────────────────────────────────────────────────────────
    canaryManager.clearToken(sessionId);
    intentStore.clearIntent(intent.intentId);

    return {
        status: 'success',
        results,
        verifierSummary: {
            confidence: finalCheck.confidence,
            matchesIntent: finalCheck.matchesIntent,
            checklistComplete: finalCheck.checklistComplete,
            anomalies: finalCheck.anomalies,
        },
    };
}
