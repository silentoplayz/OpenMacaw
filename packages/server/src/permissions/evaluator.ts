import { getPermissionForServer, type ServerPermission } from './store.js';
import { getMCPServer } from '../mcp/registry.js';
import { resolve as resolvePath, relative as relativePath, isAbsolute } from 'node:path';

export interface PermissionContext {
  serverId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

// ── Verdict system ────────────────────────────────────────────────────────────
// DENY           = blocked by policy, halt immediately
// REQUIRE_APPROVAL = pause and wait for human click (default)
// ALLOW_SILENT   = auto-execute without prompt (opt-in via Trust Policy)
export type PermissionVerdict = 'ALLOW_SILENT' | 'REQUIRE_APPROVAL' | 'DENY';

export interface PermissionResult {
  verdict: PermissionVerdict;
  reason?: string;
}

// ── Tool classification ───────────────────────────────────────────────────────
// Safe reads: may be silenced when path is trusted
const SAFE_READ_TOOLS = new Set([
  'read_file', 'read_directory', 'list_directory', 'read_text_file',
  'read_multiple_files', 'get_file_info',
]);

// Destructive: MUST ALWAYS require approval — never silenced
const DESTRUCTIVE_TOOLS = new Set([
  'write_file', 'create_file', 'delete_file', 'delete_directory',
  'create_directory', 'move_file', 'rename_file',
]);

const toolNameToType: Record<string, string> = {
  // Filesystem tools
  read_file: 'filesystem',
  write_file: 'filesystem',
  create_file: 'filesystem',
  delete_file: 'filesystem',
  list_directory: 'filesystem',
  read_directory: 'filesystem',
  // Bash / shell tools
  bash: 'bash',
  execute_command: 'bash',
  run_command: 'bash',
  // Shell MCP server (@modelcontextprotocol/server-shell)
  shell_run: 'bash',
  shell_exec: 'bash',
  run_shell: 'bash',
  run_script: 'bash',
  exec_command: 'bash',
  // Web / network tools
  webfetch: 'webfetch',
  fetch_url: 'webfetch',
  open_url: 'webfetch',
  // Web Search MCP server (@modelcontextprotocol/server-search)
  search: 'webfetch',
  web_search: 'webfetch',
  search_web: 'webfetch',
  google_search: 'webfetch',
  serpapi_search: 'webfetch',
  // SearXNG MCP server (mcp-server-searxng)
  searxng_search: 'webfetch',
  searxng: 'webfetch',
  // Subprocess / network meta
  subprocess: 'subprocess',
  spawn: 'subprocess',
  network: 'network',
  http_request: 'network',
};

export function evaluatePermission(context: PermissionContext): PermissionResult {
  const { serverId, toolName, toolInput } = context;

  const server = getMCPServer(serverId);
  if (!server) {
    return { verdict: 'DENY', reason: 'Server not connected or not found' };
  }

  if (server.info.status !== 'running') {
    return { verdict: 'DENY', reason: 'Server is not running' };
  }

  const permission = getPermissionForServer(serverId);
  if (!permission) {
    return { verdict: 'DENY', reason: 'No permissions configured for this server' };
  }

  const toolType = toolNameToType[toolName] || 'unknown';

  if (toolType === 'filesystem') {
    return evaluateFilesystemPermission(permission, toolName, toolInput);
  }

  if (toolType === 'bash') {
    return evaluateBashPermission(permission, toolInput);
  }

  if (toolType === 'webfetch') {
    return evaluateWebfetchPermission(permission, toolInput);
  }

  if (toolType === 'subprocess') {
    return evaluateSubprocessPermission(permission);
  }

  if (toolType === 'network') {
    return evaluateNetworkPermission(permission);
  }

  if ('env' in toolInput || 'environment' in toolInput) {
    return { verdict: 'DENY', reason: 'Environment variable access is permanently disabled' };
  }

  return { verdict: 'REQUIRE_APPROVAL' };
}

// ── Path utilities ────────────────────────────────────────────────────────────

/**
 * Resolve a path (possibly relative) to an absolute path using process.cwd().
 * Handles `.`, `./foo`, `../foo`, and plain absolute paths.
 */
function resolveIncomingPath(p: string): string {
  // Normalise back-slashes first (Windows paths from LLM outputs)
  const forward = p.replace(/\\/g, '/');
  if (isAbsolute(forward)) return resolvePath(forward);
  // Relative → resolve against the server process CWD
  return resolvePath(process.cwd(), forward);
}

/**
 * Returns true if `child` is inside (or equal to) `parent`.
 * Uses path.relative(), which correctly handles edge-cases like:
 *   parent=/home/user/project, child=/home/user/project-other → FALSE
 *   parent=/home/user/project, child=/home/user/project/src   → TRUE
 *   parent=/home/user/project, child=/home/user/project       → TRUE
 */
function isPathUnder(child: string, parent: string): boolean {
  // Wildcard: '/' trusts everything
  if (parent === '/') return true;
  const rel = relativePath(parent, child);
  // rel starts with '..' → child is outside parent
  return !rel.startsWith('..');
}

function evaluateFilesystemPermission(
  perm: ServerPermission,
  toolName: string,
  input: Record<string, unknown>
): PermissionResult {
  const rawPath = (input.path as string) || (input.file_path as string);
  if (!rawPath) {
    return { verdict: 'DENY', reason: 'No path provided in tool input' };
  }

  // Resolve everything to absolute so string comparisons are accurate
  const absPath = resolveIncomingPath(rawPath);

  // ── Denied paths check ──────────────────────────────────────────────────
  const isDenied = perm.deniedPaths.some(dp => isPathUnder(absPath, resolveIncomingPath(dp)));
  if (isDenied) {
    return { verdict: 'DENY', reason: `Path ${rawPath} is explicitly denied` };
  }

  // ── Allowed paths check ─────────────────────────────────────────────────
  const isGloballyAllowed = perm.allowedPaths.some(ap => ap === '/');
  if (perm.allowedPaths.length === 0) {
    return { verdict: 'DENY', reason: 'No filesystem paths allowed for this server' };
  }
  if (!isGloballyAllowed) {
    const inAllowed = perm.allowedPaths.some(ap => isPathUnder(absPath, resolveIncomingPath(ap)));
    if (!inAllowed) {
      return { verdict: 'DENY', reason: `Path ${rawPath} is not in allowed paths` };
    }
  }

  // ── Per-operation permission flags ──────────────────────────────────────
  if ((toolName === 'read_file' || toolName === 'read_directory' || toolName === 'list_directory') && !perm.pathRead) {
    return { verdict: 'DENY', reason: 'Read permission not granted' };
  }
  if (toolName === 'write_file' && !perm.pathWrite) {
    return { verdict: 'DENY', reason: 'Write permission not granted' };
  }
  if ((toolName === 'create_file' || toolName === 'create_directory') && !perm.pathCreate) {
    return { verdict: 'DENY', reason: 'Create permission not granted' };
  }
  if ((toolName === 'delete_file' || toolName === 'delete_directory') && !perm.pathDelete) {
    return { verdict: 'DENY', reason: 'Delete permission not granted' };
  }

  // ── Trust Policy: ALLOW_SILENT check ────────────────────────────────────
  // Destructive tools can NEVER be silenced, regardless of trust policy
  if (DESTRUCTIVE_TOOLS.has(toolName)) {
    return { verdict: 'REQUIRE_APPROVAL' };
  }

  // Safe reads in a trusted path → execute without prompting.
  // Trusted path '.' expands to process.cwd(), so LLM requests like '.'
  // or './src' match automatically once the user adds '.' to trusted dirs.
  if (
    perm.autoApproveReads &&
    SAFE_READ_TOOLS.has(toolName) &&
    perm.trustedPaths.length > 0
  ) {
    const isTrusted = perm.trustedPaths.some(tp => {
      const absTrusted = resolveIncomingPath(tp); // resolves '.' → process.cwd()
      return isPathUnder(absPath, absTrusted);
    });
    if (isTrusted) {
      return { verdict: 'ALLOW_SILENT' };
    }
  }

  return { verdict: 'REQUIRE_APPROVAL' };
}

function evaluateBashPermission(perm: ServerPermission, input: Record<string, unknown>): PermissionResult {
  if (!perm.bashAllowed) {
    return { verdict: 'DENY', reason: 'Bash execution is disabled for this server' };
  }

  const command = (input.command as string) || (input.cmd as string);
  if (!command) {
    return { verdict: 'DENY', reason: 'No command provided' };
  }

  if (perm.bashAllowedCommands.length > 0) {
    const matches = perm.bashAllowedCommands.some(pattern => matchesGlob(command, pattern));
    if (!matches) {
      return { verdict: 'DENY', reason: `Command "${command}" does not match allowed patterns` };
    }
  }

  return { verdict: 'REQUIRE_APPROVAL' };
}

function evaluateWebfetchPermission(perm: ServerPermission, input: Record<string, unknown>): PermissionResult {
  if (!perm.webfetchAllowed) {
    return { verdict: 'DENY', reason: 'Web fetch is disabled for this server' };
  }

  const url = (input.url as string) || (input.uri as string);
  if (!url) {
    return { verdict: 'DENY', reason: 'No URL provided' };
  }

  if (perm.webfetchAllowedDomains.length > 0) {
    try {
      const urlObj = new URL(url);
      const matches = perm.webfetchAllowedDomains.some(domain => 
        urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
      );
      if (!matches) {
        return { verdict: 'DENY', reason: `Domain ${urlObj.hostname} is not in allowed domains` };
      }
    } catch {
      return { verdict: 'DENY', reason: 'Invalid URL format' };
    }
  }

  return { verdict: 'REQUIRE_APPROVAL' };
}

function evaluateSubprocessPermission(perm: ServerPermission): PermissionResult {
  if (!perm.subprocessAllowed) {
    return { verdict: 'DENY', reason: 'Subprocess spawning is disabled for this server' };
  }
  return { verdict: 'REQUIRE_APPROVAL' };
}

function evaluateNetworkPermission(perm: ServerPermission): PermissionResult {
  if (!perm.networkAllowed) {
    return { verdict: 'DENY', reason: 'Network access is disabled for this server' };
  }
  return { verdict: 'REQUIRE_APPROVAL' };
}

function matchesGlob(str: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(str);
}

export function extractServerIdFromToolName(fullToolName: string): { serverId: string; toolName: string } {
  // Support both legacy colon separator and the double-underscore encoding
  // used when sending tools to the LLM API (which forbids colons).
  const dunderIndex = fullToolName.indexOf('__');
  if (dunderIndex !== -1) {
    return {
      serverId: fullToolName.substring(0, dunderIndex),
      toolName: fullToolName.substring(dunderIndex + 2),
    };
  }
  // Fallback: legacy colon format
  const colonIndex = fullToolName.indexOf(':');
  if (colonIndex === -1) {
    return { serverId: '', toolName: fullToolName };
  }
  return {
    serverId: fullToolName.substring(0, colonIndex),
    toolName: fullToolName.substring(colonIndex + 1),
  };
}
