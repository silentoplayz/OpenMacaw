/**
 * Tool description sanitization and schema validation for MCP tools.
 *
 * Defends against:
 * - Tool poisoning attacks (Invariant Labs TPA, Apr 2025) where malicious
 *   instructions are hidden in tool descriptions.
 * - Hidden parameter exfiltration where undeclared parameters are used to
 *   leak data from the LLM context.
 */

const MAX_DESCRIPTION_LENGTH = 2000;

/**
 * Patterns that indicate prompt injection attempts inside tool descriptions.
 * These are invisible to users but fully visible to the LLM.
 */
const TOOL_INJECTION_PATTERNS: RegExp[] = [
  // XML/HTML-style injection markers
  /<IMPORTANT>/gi,
  /<\/IMPORTANT>/gi,
  /<SYSTEM>/gi,
  /<\/SYSTEM>/gi,
  /<INSTRUCTIONS?>/gi,
  /<\/INSTRUCTIONS?>/gi,

  // LLM prompt format markers
  /\[SYSTEM\]/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<<SYS>>/gi,
  /<\/s>/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /<\|endoftext\|>/gi,

  // Directive language commonly used in tool poisoning
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /forget\s+everything/gi,
  /you\s+are\s+now\s+/gi,
  /new\s+(system\s+)?prompt/gi,
  /disregard\s+your\s+(instructions?|rules?|guidelines?)/gi,
  /override\s+(your\s+)?(instructions?|rules?|behavior)/gi,
  /do\s+not\s+follow\s+your\s+(rules?|guidelines?|instructions?)/gi,

  // Cross-server instruction injection
  /when\s+(the\s+)?(user|human)\s+(calls?|uses?|invokes?)\s+/gi,
  /before\s+(calling|using|invoking)\s+(any\s+)?(other\s+)?tool/gi,
  /instead\s+of\s+(calling|using|invoking)\s+/gi,
  /always\s+(first|also)\s+(read|send|fetch|call|include)/gi,

  // Exfiltration instructions
  /send\s+(the\s+)?(data|content|result|file|secret|key|token|password)\s+to/gi,
  /include\s+(the\s+)?(content|data|secret|key|token)\s+(in|as)\s+(a\s+)?(parameter|argument|field|header)/gi,
  /exfiltrate/gi,

  // Base64-encoded injection markers
  /SWdub3Jl/g,        // "Ignore"
  /aWdub3Jl/gi,       // "ignore"
  /c3lzdGVtIHByb21wdA==/gi, // "system prompt"
];

/**
 * Sanitize a tool description: strip injection markers and enforce length cap.
 */
export function sanitizeToolDescription(description: string): string {
  let clean = description;

  for (const pattern of TOOL_INJECTION_PATTERNS) {
    clean = clean.replace(pattern, '[BLOCKED]');
  }

  if (clean.length > MAX_DESCRIPTION_LENGTH) {
    clean = clean.slice(0, MAX_DESCRIPTION_LENGTH) + '... [truncated]';
  }

  return clean;
}

/**
 * Recursively sanitize string values in a tool's input schema,
 * stripping injection markers from property descriptions.
 */
export function sanitizeToolSchema(
  schema: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === 'description' && typeof value === 'string') {
      result[key] = sanitizeToolDescription(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizeToolSchema(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map(item =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? sanitizeToolSchema(item as Record<string, unknown>)
          : item
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Validate that a tool call's arguments only contain parameters declared
 * in the tool's input schema. Rejects calls with unexpected/hidden parameters
 * that could be used for data exfiltration.
 */
export function validateToolCallArgs(
  input: Record<string, unknown>,
  schema: Record<string, unknown>
): { valid: boolean; unexpectedKeys: string[] } {
  const properties = (schema.properties as Record<string, unknown>) || {};
  const declaredKeys = new Set(Object.keys(properties));

  // Also allow keys declared in additionalProperties or patternProperties
  const allowsAdditional = schema.additionalProperties !== false &&
    schema.additionalProperties !== undefined;

  if (allowsAdditional) {
    return { valid: true, unexpectedKeys: [] };
  }

  const unexpectedKeys = Object.keys(input).filter(k => !declaredKeys.has(k));

  return {
    valid: unexpectedKeys.length === 0,
    unexpectedKeys,
  };
}
