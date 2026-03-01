import { getPermissionForServer, type ServerPermission } from './store.js';
import { getMCPServer } from '../mcp/registry.js';

export interface PermissionContext {
  serverId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

const toolNameToType: Record<string, string> = {
  read_file: 'filesystem',
  write_file: 'filesystem',
  create_file: 'filesystem',
  delete_file: 'filesystem',
  list_directory: 'filesystem',
  read_directory: 'filesystem',
  bash: 'bash',
  execute_command: 'bash',
  run_command: 'bash',
  webfetch: 'webfetch',
  fetch_url: 'webfetch',
  open_url: 'webfetch',
  subprocess: 'subprocess',
  spawn: 'subprocess',
  network: 'network',
  http_request: 'network',
};

export function evaluatePermission(context: PermissionContext): PermissionResult {
  const { serverId, toolName, toolInput } = context;

  const server = getMCPServer(serverId);
  if (!server) {
    return { allowed: false, reason: 'Server not connected or not found' };
  }

  if (server.info.status !== 'running') {
    return { allowed: false, reason: 'Server is not running' };
  }

  const permission = getPermissionForServer(serverId);
  if (!permission) {
    return { allowed: false, reason: 'No permissions configured for this server' };
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
    return { allowed: false, reason: 'Environment variable access is permanently disabled' };
  }

  return { allowed: true };
}

function evaluateFilesystemPermission(
  perm: ServerPermission,
  toolName: string,
  input: Record<string, unknown>
): PermissionResult {
  const path = (input.path as string) || (input.file_path as string);
  if (!path) {
    return { allowed: false, reason: 'No path provided in tool input' };
  }

  const normalizedPath = path.replace(/\\/g, '/');

  if (perm.deniedPaths.some(dp => normalizedPath.startsWith(dp.replace(/\\/g, '/')))) {
    return { allowed: false, reason: `Path ${path} is explicitly denied` };
  }

  // If '/' is in allowedPaths, consider everything explicitly allowed globally
  const isGloballyAllowed = perm.allowedPaths.some(ap => ap === '/');
  
  if (!isGloballyAllowed && !perm.allowedPaths.some(ap => normalizedPath.startsWith(ap.replace(/\\/g, '/'))) && perm.allowedPaths.length > 0) {
    return { allowed: false, reason: `Path ${path} is not in allowed paths` };
  }

  if (perm.allowedPaths.length === 0) {
    return { allowed: false, reason: 'No filesystem paths allowed for this server' };
  }

  if (toolName === 'read_file' || toolName === 'read_directory' || toolName === 'list_directory') {
    if (!perm.pathRead) {
      return { allowed: false, reason: 'Read permission not granted' };
    }
  }

  if (toolName === 'write_file') {
    if (!perm.pathWrite) {
      return { allowed: false, reason: 'Write permission not granted' };
    }
  }

  if (toolName === 'create_file' || toolName === 'create_directory') {
    if (!perm.pathCreate) {
      return { allowed: false, reason: 'Create permission not granted' };
    }
  }

  if (toolName === 'delete_file' || toolName === 'delete_directory') {
    if (!perm.pathDelete) {
      return { allowed: false, reason: 'Delete permission not granted' };
    }
  }

  return { allowed: true };
}

function evaluateBashPermission(perm: ServerPermission, input: Record<string, unknown>): PermissionResult {
  if (!perm.bashAllowed) {
    return { allowed: false, reason: 'Bash execution is disabled for this server' };
  }

  const command = (input.command as string) || (input.cmd as string);
  if (!command) {
    return { allowed: false, reason: 'No command provided' };
  }

  if (perm.bashAllowedCommands.length > 0) {
    const matches = perm.bashAllowedCommands.some(pattern => matchesGlob(command, pattern));
    if (!matches) {
      return { allowed: false, reason: `Command "${command}" does not match allowed patterns` };
    }
  }

  return { allowed: true };
}

function evaluateWebfetchPermission(perm: ServerPermission, input: Record<string, unknown>): PermissionResult {
  if (!perm.webfetchAllowed) {
    return { allowed: false, reason: 'Web fetch is disabled for this server' };
  }

  const url = (input.url as string) || (input.uri as string);
  if (!url) {
    return { allowed: false, reason: 'No URL provided' };
  }

  if (perm.webfetchAllowedDomains.length > 0) {
    try {
      const urlObj = new URL(url);
      const matches = perm.webfetchAllowedDomains.some(domain => 
        urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
      );
      if (!matches) {
        return { allowed: false, reason: `Domain ${urlObj.hostname} is not in allowed domains` };
      }
    } catch {
      return { allowed: false, reason: 'Invalid URL format' };
    }
  }

  return { allowed: true };
}

function evaluateSubprocessPermission(perm: ServerPermission): PermissionResult {
  if (!perm.subprocessAllowed) {
    return { allowed: false, reason: 'Subprocess spawning is disabled for this server' };
  }
  return { allowed: true };
}

function evaluateNetworkPermission(perm: ServerPermission): PermissionResult {
  if (!perm.networkAllowed) {
    return { allowed: false, reason: 'Network access is disabled for this server' };
  }
  return { allowed: true };
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
  const colonIndex = fullToolName.indexOf(':');
  if (colonIndex === -1) {
    return { serverId: '', toolName: fullToolName };
  }
  return {
    serverId: fullToolName.substring(0, colonIndex),
    toolName: fullToolName.substring(colonIndex + 1),
  };
}
