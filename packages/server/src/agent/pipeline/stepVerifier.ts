import { sanitizeString } from './sanitizer.js';
import type { PipelineStep, StepResult } from './index.js';

export interface StepVerificationResult {
    passed: boolean;
    anomalies: string[];
    containsInjectionSignals: boolean;
    canaryLeaked: boolean;
    confidence: number; // 0.0 – 1.0
}

/** Confidence threshold below which the pipeline pauses for human review. */
export const STEP_VERIFIER_THRESHOLD = 0.80;

/**
 * Verify that a single executor step result looks sane.
 * Uses deterministic heuristics — no additional LLM call — for speed.
 * Confidence degrades for each anomaly found.
 */
export function verifyStep(
    step: PipelineStep,
    result: StepResult,
    canaryToken: string
): StepVerificationResult {
    const anomalies: string[] = [];
    let confidence = 1.0;

    const rawOutput = result.rawOutput ?? '';

    // 1. Canary leak check
    const canaryLeaked = Boolean(canaryToken) && rawOutput.includes(canaryToken);
    if (canaryLeaked) {
        anomalies.push('Canary token detected in step output — system prompt leaked');
        confidence -= 0.5;
    }

    // 2. Injection signals in output
    const sanitized = sanitizeString(rawOutput);
    const containsInjectionSignals = sanitized.injectionSignalsFound;
    if (containsInjectionSignals) {
        anomalies.push(
            `Injection signals found in output: ${sanitized.strippedSegments.slice(0, 3).join(' | ')}`
        );
        confidence -= 0.3;
    }

    // 3. Unexpected tool calls — executor should only call the tool the step declared
    const expectedTool = step.toolRequired;
    if (expectedTool && result.toolCallsMade.length > 0) {
        const unexpected = result.toolCallsMade.filter(
            (t) => t !== expectedTool && t !== `${result.serverId}:${expectedTool}`
        );
        if (unexpected.length > 0) {
            anomalies.push(`Unexpected tool calls beyond step scope: ${unexpected.join(', ')}`);
            confidence -= 0.25 * unexpected.length;
        }
    }

    // 4. Step had no tool requirement but made tool calls
    if (!expectedTool && result.toolCallsMade.length > 0) {
        anomalies.push(`Step had no tool requirement but called: ${result.toolCallsMade.join(', ')}`);
        confidence -= 0.2;
    }

    // 5. Output instructs other agents
    const agentDirectivePatterns = [
        /\[SYSTEM\]/i,
        /\[INST\]/i,
        /as\s+the\s+(next|following)\s+agent/i,
        /tell\s+the\s+(planner|executor|verifier)/i,
    ];
    for (const pattern of agentDirectivePatterns) {
        if (pattern.test(rawOutput)) {
            anomalies.push(`Output contains agent-directive language: "${pattern.source}"`);
            confidence -= 0.15;
            break;
        }
    }

    // Clamp confidence to [0, 1]
    confidence = Math.max(0, Math.min(1, confidence));

    return {
        passed: anomalies.length === 0 || confidence >= STEP_VERIFIER_THRESHOLD,
        anomalies,
        containsInjectionSignals,
        canaryLeaked,
        confidence,
    };
}
