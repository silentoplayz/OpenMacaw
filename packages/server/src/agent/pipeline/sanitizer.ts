export interface SanitizedOutput {
    clean: string;
    strippedSegments: string[];
    injectionSignalsFound: boolean;
}

/**
 * Regex patterns that indicate a prompt injection attempt.
 * Each pattern is replaced with [REDACTED] and logged in strippedSegments.
 */
const INJECTION_PATTERNS: RegExp[] = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
    /forget\s+everything/gi,
    /you\s+are\s+now\s+/gi,
    /new\s+(system\s+)?prompt/gi,
    /disregard\s+your\s+(instructions?|rules?|guidelines?)/gi,
    /\[SYSTEM\]/gi,
    /\[INST\]/gi,
    /override\s+(your\s+)?(instructions?|rules?|behavior)/gi,
    /act\s+as\s+if\s+you\s+(have\s+no\s+)?rules?/gi,
    /pretend\s+(you\s+are|to\s+be)\s+(a\s+)?(different|uncensored|unrestricted)/gi,
    /do\s+not\s+follow\s+your\s+(rules?|guidelines?|instructions?)/gi,
    // Base64-encoded "Ignore"
    /SWdub3Jl/g,
    /aWdub3Jl/gi,
    // Base64-encoded "system prompt"
    /c3lzdGVtIHByb21wdA==/gi,
];

/**
 * Sanitize a string value, returning the cleaned text along with
 * everything that was removed.
 */
function sanitizeText(text: string): { clean: string; stripped: string[] } {
    const stripped: string[] = [];
    let clean = text;

    for (const pattern of INJECTION_PATTERNS) {
        const matches = clean.match(pattern);
        if (matches) {
            for (const match of matches) {
                stripped.push(match);
            }
            clean = clean.replace(pattern, '[REDACTED]');
        }
    }

    return { clean, stripped };
}

/**
 * Sanitize a full array of step results (each may have string output fields).
 * Original values are never modified — a new sanitized copy is returned.
 */
export function sanitizeResults(results: unknown[]): SanitizedOutput {
    const allStripped: string[] = [];
    const cleanedParts: string[] = [];

    for (const result of results) {
        const raw = typeof result === 'string'
            ? result
            : JSON.stringify(result ?? '');

        const { clean, stripped } = sanitizeText(raw);
        cleanedParts.push(clean);
        allStripped.push(...stripped);
    }

    return {
        clean: cleanedParts.join('\n\n---\n\n'),
        strippedSegments: allStripped,
        injectionSignalsFound: allStripped.length > 0,
    };
}

/**
 * Sanitize a single string (used for step-level checks in stepVerifier).
 */
export function sanitizeString(text: string): SanitizedOutput {
    const { clean, stripped } = sanitizeText(text);
    return {
        clean,
        strippedSegments: stripped,
        injectionSignalsFound: stripped.length > 0,
    };
}
