export interface ActionGateResult {
    isIrreversible: boolean;
    reason?: string;
}

/**
 * Bash command patterns that are considered destructive.
 * Any command matching one of these is flagged as irreversible.
 */
const DESTRUCTIVE_BASH_PATTERNS: RegExp[] = [
    /\brm\b/,
    /\bmv\b/,
    /\btruncate\b/,
    /\bdd\b/,
    /\bchmod\b/,
    /\bchown\b/,
    /\bkill\b/,
    /\bpkill\b/,
    /\bshutdown\b/,
    /\breboot\b/,
    /\bformat\b/,
    /\bfdisk\b/,
    /\bwipe\b/,
    /DROP\s+TABLE/i,
    /DELETE\s+FROM/i,
    /TRUNCATE\s+TABLE/i,
    /DROP\s+DATABASE/i,
    /ALTER\s+TABLE.+DROP/i,
];

/** HTTP methods that mutate state and should be treated as irreversible. */
const MUTATING_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Tool + server combinations always considered irreversible. */
const ALWAYS_IRREVERSIBLE_TOOLS = new Set([
    'delete_file',
    'delete_directory',
    'overwrite_file',
]);

/**
 * Evaluate whether a proposed tool call is irreversible.
 *
 * @param serverId    MCP server ID (e.g. "filesystem", "bash")
 * @param toolName    Tool name (e.g. "write_file", "execute_command")
 * @param toolInput   Tool input parameters
 * @param planFlagged Whether the planner already flagged this step as isIrreversible
 */
export function evaluateAction(
    serverId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    planFlagged: boolean
): ActionGateResult {
    // Respect planner flag
    if (planFlagged) {
        return { isIrreversible: true, reason: 'Flagged as irreversible by planner' };
    }

    // Always-irreversible tools
    if (ALWAYS_IRREVERSIBLE_TOOLS.has(toolName)) {
        return { isIrreversible: true, reason: `Tool "${toolName}" always requires confirmation` };
    }

    // Bash command check
    if (serverId === 'bash' || toolName === 'execute_command' || toolName === 'bash') {
        const command = (toolInput.command as string) || (toolInput.cmd as string) || '';
        for (const pattern of DESTRUCTIVE_BASH_PATTERNS) {
            if (pattern.test(command)) {
                return {
                    isIrreversible: true,
                    reason: `Bash command matches destructive pattern: ${pattern.source}`,
                };
            }
        }
    }

    // HTTP method check
    if (toolName === 'fetch_url' || toolName === 'http_request' || toolName === 'webfetch') {
        const method = ((toolInput.method as string) || 'GET').toUpperCase();
        if (MUTATING_HTTP_METHODS.has(method)) {
            return {
                isIrreversible: true,
                reason: `HTTP ${method} request mutates state`,
            };
        }
    }

    // write_file to non-temp paths is irreversible
    if (toolName === 'write_file' || toolName === 'create_file') {
        const path = (toolInput.path as string) || (toolInput.file_path as string) || '';
        const isTempPath = path.startsWith('/tmp/') || path.startsWith('C:\\Windows\\Temp');
        if (!isTempPath) {
            return {
                isIrreversible: true,
                reason: `Writing to "${path}" is an irreversible file operation`,
            };
        }
    }

    // Database operations
    if (toolName === 'execute_sql' || toolName === 'run_query') {
        const sql = ((toolInput.sql as string) || (toolInput.query as string) || '').toUpperCase();
        if (/\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\b/.test(sql)) {
            return {
                isIrreversible: true,
                reason: 'SQL statement mutates database state',
            };
        }
    }

    return { isIrreversible: false };
}
