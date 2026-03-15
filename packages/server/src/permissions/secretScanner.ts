/**
 * Secret scanner for tool results and outbound tool call arguments.
 *
 * Defends against:
 * - Credential leakage via tool results (e.g. `printEnv` exposing API keys)
 * - RADE (Retrieval-Agent Deception) attacks where stolen credentials are
 *   exfiltrated via outbound tools (web fetch, Slack, email)
 *
 * References: MCP Safety Audit (arXiv:2504.03767)
 */

const REDACTION = '[REDACTED-SECRET]';

/**
 * Patterns matching known API key and token formats.
 * Each pattern is tested independently — order does not matter.
 */
const SECRET_PATTERNS: RegExp[] = [
  // Anthropic API keys
  /sk-ant-api03-[A-Za-z0-9_-]{80,}/g,

  // OpenAI API keys
  /sk-[A-Za-z0-9]{20,}/g,

  // GitHub tokens
  /ghp_[A-Za-z0-9]{36}/g,       // Personal access token
  /gho_[A-Za-z0-9]{36}/g,       // OAuth access token
  /ghs_[A-Za-z0-9]{36}/g,       // Server-to-server token
  /ghr_[A-Za-z0-9]{36}/g,       // Refresh token
  /github_pat_[A-Za-z0-9_]{22,}/g, // Fine-grained PAT

  // Slack tokens
  /xoxb-[0-9]+-[A-Za-z0-9-]+/g,  // Bot token
  /xoxp-[0-9]+-[A-Za-z0-9-]+/g,  // User token
  /xoxe-[0-9]+-[A-Za-z0-9-]+/g,  // Enterprise token
  /xoxa-[0-9]+-[A-Za-z0-9-]+/g,  // App token

  // HuggingFace tokens
  /hf_[A-Za-z0-9]{34}/g,

  // AWS access keys
  /AKIA[0-9A-Z]{16}/g,

  // Google Cloud / Firebase
  /AIza[0-9A-Za-z_-]{35}/g,

  // Stripe keys
  /sk_live_[A-Za-z0-9]{24,}/g,
  /pk_live_[A-Za-z0-9]{24,}/g,
  /rk_live_[A-Za-z0-9]{24,}/g,

  // Twilio
  /SK[0-9a-fA-F]{32}/g,

  // SendGrid
  /SG\.[A-Za-z0-9_-]{22,}\.[A-Za-z0-9_-]{22,}/g,

  // JWT tokens (three base64url segments separated by dots)
  /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,

  // Generic key=value patterns for common secret names
  /(?:api[_-]?key|api[_-]?secret|secret[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret)\s*[=:]\s*['"]?[A-Za-z0-9_\-/.+]{16,}['"]?/gi,

  // Database connection strings with credentials
  /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@[^\s'"]+/gi,
];

export interface ScanResult {
  redacted: string;
  found: boolean;
  count: number;
}

/**
 * Scan text for secret patterns and redact any matches.
 */
export function scanAndRedactSecrets(text: string): ScanResult {
  let redacted = text;
  let count = 0;

  for (const pattern of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    const matches = redacted.match(pattern);
    if (matches) {
      count += matches.length;
      pattern.lastIndex = 0;
      redacted = redacted.replace(pattern, REDACTION);
    }
  }

  return { redacted, found: count > 0, count };
}

/**
 * Quick check whether text contains any secret patterns (no redaction).
 */
export function containsSecrets(text: string): boolean {
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Scan all string values in a tool call's input arguments.
 * Returns true if any argument value contains a secret pattern.
 */
export function scanToolArgsForSecrets(
  args: Record<string, unknown>
): boolean {
  const serialized = JSON.stringify(args);
  return containsSecrets(serialized);
}
