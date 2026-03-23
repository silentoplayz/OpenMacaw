import { getDb, schema } from '../db/index.js';
import { nanoid } from 'nanoid';

export interface ServerPermission {
  id: string;
  serverId: string;
  allowedPaths: string[];
  deniedPaths: string[];
  pathRead: boolean;
  pathWrite: boolean;
  pathCreate: boolean;
  pathDelete: boolean;
  pathListDir: boolean;
  bashAllowed: boolean;
  bashAllowedCommands: string[];
  webfetchAllowed: boolean;
  webfetchAllowedDomains: string[];
  subprocessAllowed: boolean;
  networkAllowed: boolean;
  maxCallsPerMinute: number;
  maxTokensPerCall: number;
  promptInjectionPrevention?: boolean;
  toolPromptInjectionPrevention: Record<string, 'inherit' | 'enable' | 'disable'>;
  // ── Trust Policy ──────────────────────────────────────────────────────────
  // Per-tool auto-approve: when true for a tool, it executes without user
  // confirmation (ALLOW_SILENT). When false/absent, REQUIRE_APPROVAL.
  toolAutoApprove: Record<string, boolean>;
  createdAt: Date;
  updatedAt: Date;
}

export function getPermissionForServer(serverId: string): ServerPermission | null {
  const db = getDb();
  const perms = db.select(schema.permissions as any).where((getCol: (col: string) => any) => getCol('serverId') === serverId).all() as any[];
  
  if (perms.length === 0) return null;
  
  const perm = perms[0];
  
  return {
    id: perm.id,
    serverId: perm.serverId,
    allowedPaths: JSON.parse(perm.allowedPaths || '[]'),
    deniedPaths: JSON.parse(perm.deniedPaths || '[]'),
    pathRead: Boolean(perm.pathRead),
    pathWrite: Boolean(perm.pathWrite),
    pathCreate: Boolean(perm.pathCreate),
    pathDelete: Boolean(perm.pathDelete),
    pathListDir: Boolean(perm.pathListDir),
    bashAllowed: Boolean(perm.bashAllowed),
    bashAllowedCommands: JSON.parse(perm.bashAllowedCommands || '[]'),
    webfetchAllowed: Boolean(perm.webfetchAllowed),
    webfetchAllowedDomains: JSON.parse(perm.webfetchAllowedDomains || '[]'),
    subprocessAllowed: Boolean(perm.subprocessAllowed),
    networkAllowed: Boolean(perm.networkAllowed),
    maxCallsPerMinute: perm.maxCallsPerMinute,
    maxTokensPerCall: perm.maxTokensPerCall,
    promptInjectionPrevention: Boolean((perm as any).prompt_injection_prevention ?? (perm as any).promptInjectionPrevention ?? false),
    toolPromptInjectionPrevention: JSON.parse((perm as any).toolPromptInjectionPrevention ?? (perm as any).tool_prompt_injection_prevention ?? '{}'),
    toolAutoApprove: JSON.parse((perm as any).toolAutoApprove ?? (perm as any).tool_auto_approve ?? '{}'),
    createdAt: new Date(perm.createdAt),
    updatedAt: new Date(perm.updatedAt),
  };
}

export async function createDefaultPermission(serverId: string): Promise<ServerPermission> {
  const db = getDb();
  const now = Date.now();
  const id = nanoid();
  
  const perm = {
    id,
    serverId,
    allowed_paths: JSON.stringify(['/']),
    denied_paths: JSON.stringify([]),
    path_read: 1,
    path_write: 1,
    path_create: 1,
    path_delete: 1,
    path_list_dir: 1,
    bash_allowed: 1,
    bash_allowed_commands: JSON.stringify(['*']),
    webfetch_allowed: 1,
    webfetch_allowed_domains: JSON.stringify(['*']),
    subprocess_allowed: 1,
    network_allowed: 1,
    max_calls_per_minute: 30,
    max_tokens_per_call: 100000,
    prompt_injection_prevention: 0,
    tool_prompt_injection_prevention: '{}',
    tool_auto_approve: '{}',
    created_at: now,
    updated_at: now,
  };

  db.insert(schema.permissions as any).values(perm);

  return {
    ...perm,
    allowedPaths: ['/'],
    deniedPaths: [],
    bashAllowedCommands: ['*'],
    webfetchAllowedDomains: ['*'],
    pathRead: true,
    pathWrite: true,
    pathCreate: true,
    pathDelete: true,
    pathListDir: true,
    bashAllowed: true,
    webfetchAllowed: true,
    subprocessAllowed: true,
    networkAllowed: true,
    maxCallsPerMinute: 30,
    maxTokensPerCall: 100000,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    promptInjectionPrevention: false,
    toolPromptInjectionPrevention: {},
    toolAutoApprove: {},
  } as ServerPermission;
}

export async function updatePermission(serverId: string, updates: Partial<ServerPermission>): Promise<ServerPermission> {
  const db = getDb();
  const dbUpdates: Record<string, unknown> = { updated_at: Date.now() };
  
  if (updates.allowedPaths !== undefined) dbUpdates.allowed_paths = JSON.stringify(updates.allowedPaths);
  if (updates.deniedPaths !== undefined) dbUpdates.denied_paths = JSON.stringify(updates.deniedPaths);
  if (updates.pathRead !== undefined) dbUpdates.path_read = updates.pathRead ? 1 : 0;
  if (updates.pathWrite !== undefined) dbUpdates.path_write = updates.pathWrite ? 1 : 0;
  if (updates.pathCreate !== undefined) dbUpdates.path_create = updates.pathCreate ? 1 : 0;
  if (updates.pathDelete !== undefined) dbUpdates.path_delete = updates.pathDelete ? 1 : 0;
  if (updates.pathListDir !== undefined) dbUpdates.path_list_dir = updates.pathListDir ? 1 : 0;
  if (updates.bashAllowed !== undefined) dbUpdates.bash_allowed = updates.bashAllowed ? 1 : 0;
  if (updates.bashAllowedCommands !== undefined) dbUpdates.bash_allowed_commands = JSON.stringify(updates.bashAllowedCommands);
  if (updates.webfetchAllowed !== undefined) dbUpdates.webfetch_allowed = updates.webfetchAllowed ? 1 : 0;
  if (updates.webfetchAllowedDomains !== undefined) dbUpdates.webfetch_allowed_domains = JSON.stringify(updates.webfetchAllowedDomains);
  if (updates.subprocessAllowed !== undefined) dbUpdates.subprocess_allowed = updates.subprocessAllowed ? 1 : 0;
  if (updates.networkAllowed !== undefined) dbUpdates.network_allowed = updates.networkAllowed ? 1 : 0;
  if (updates.maxCallsPerMinute !== undefined) dbUpdates.max_calls_per_minute = updates.maxCallsPerMinute;
  if (updates.maxTokensPerCall !== undefined) dbUpdates.max_tokens_per_call = updates.maxTokensPerCall;
  if ((updates as any).promptInjectionPrevention !== undefined) {
    dbUpdates.prompt_injection_prevention = (updates as any).promptInjectionPrevention ? 1 : 0;
  }
  if ((updates as any).toolPromptInjectionPrevention !== undefined) {
    dbUpdates.tool_prompt_injection_prevention = JSON.stringify((updates as any).toolPromptInjectionPrevention);
  }
  if (updates.toolAutoApprove !== undefined) dbUpdates.tool_auto_approve = JSON.stringify(updates.toolAutoApprove);

  db.update(schema.permissions as any).set(dbUpdates).where((getCol: (col: string) => unknown) => getCol('serverId') === serverId);
  
  const perm = getPermissionForServer(serverId);
  if (!perm) throw new Error('Permission not found after update');
  return perm;
}

export async function deletePermission(serverId: string): Promise<void> {
  const db = getDb();
  db.delete(schema.permissions as any).where((getCol: (col: string) => unknown) => getCol('serverId') === serverId);
}

export function getAllPermissions(): ServerPermission[] {
  const db = getDb();
  const perms = db.select(schema.permissions as any).where().all() as any[];
  
  return perms.map(perm => ({
    id: perm.id,
    serverId: perm.serverId,
    allowedPaths: JSON.parse(perm.allowedPaths || '[]'),
    deniedPaths: JSON.parse(perm.deniedPaths || '[]'),
    pathRead: Boolean(perm.pathRead),
    pathWrite: Boolean(perm.pathWrite),
    pathCreate: Boolean(perm.pathCreate),
    pathDelete: Boolean(perm.pathDelete),
    pathListDir: Boolean(perm.pathListDir),
    bashAllowed: Boolean(perm.bashAllowed),
    bashAllowedCommands: JSON.parse(perm.bashAllowedCommands || '[]'),
    webfetchAllowed: Boolean(perm.webfetchAllowed),
    webfetchAllowedDomains: JSON.parse(perm.webfetchAllowedDomains || '[]'),
    subprocessAllowed: Boolean(perm.subprocessAllowed),
    networkAllowed: Boolean(perm.networkAllowed),
    maxCallsPerMinute: perm.maxCallsPerMinute,
    maxTokensPerCall: perm.maxTokensPerCall,
    promptInjectionPrevention: Boolean((perm as any).prompt_injection_prevention ?? (perm as any).promptInjectionPrevention ?? false),
    toolPromptInjectionPrevention: JSON.parse((perm as any).toolPromptInjectionPrevention ?? (perm as any).tool_prompt_injection_prevention ?? '{}'),
    toolAutoApprove: JSON.parse((perm as any).toolAutoApprove ?? (perm as any).tool_auto_approve ?? '{}'),
    createdAt: new Date(perm.createdAt),
    updatedAt: new Date(perm.updatedAt),
  }));
}
