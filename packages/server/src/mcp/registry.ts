import { MCPClient } from './client.js';
import type { ToolDefinition } from '../llm/provider.js';
import { getDrizzleDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getPermissionForServer, createDefaultPermission } from '../permissions/index.js';

export type ServerStatus = 'stopped' | 'running' | 'error' | 'unhealthy' | 'paused';

export interface MCPServerInfo {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  envVars?: Record<string, string>;
  url?: string;
  status: ServerStatus;
  toolCount: number;
  lastError?: string;
}

const servers: Map<string, { client: MCPClient; info: MCPServerInfo }> = new Map();

export function getMCPServer(id: string): { client: MCPClient; info: MCPServerInfo } | undefined {
  return servers.get(id);
}

export async function registerServer(serverData: {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  envVars?: Record<string, string>;
  url?: string;
}): Promise<MCPServerInfo> {
  const existing = servers.get(serverData.id);
  if (existing) {
    await existing.client.disconnect();
    servers.delete(serverData.id);
  }

  const client = new MCPClient();
  const info: MCPServerInfo = {
    ...serverData,
    status: 'stopped',
    toolCount: 0,
  };

  servers.set(serverData.id, { client, info });
  return info;
}

export async function startServer(id: string): Promise<MCPServerInfo> {
  const server = servers.get(id);
  if (!server) {
    throw new Error(`Server ${id} not found`);
  }

  const db = getDrizzleDb();
  const serversData = await db.select().from(schema.servers).where(eq(schema.servers.id, id));

  if (serversData.length === 0) {
    throw new Error(`Server ${id} not in database`);
  }

  const serverData = serversData[0];

  try {
    if (serverData.transport === 'stdio' && serverData.command) {
      // db.select() converts snake_case keys to camelCase — use envVars not env_vars
      const envVars = serverData.envVars ? JSON.parse(serverData.envVars as string) : undefined;
      const args = serverData.args ? JSON.parse(serverData.args as string) : undefined;

      console.log(`[MCP] Spawning '${server.info.name}' | cmd: ${serverData.command} | args:`, args, '| env:', envVars);

      await server.client.connect({
        command: serverData.command as string,
        args,
        envVars,
      });
    } else {
      throw new Error('HTTP transport not yet implemented');
    }

    server.info.status = 'running';
    server.info.toolCount = server.client.getTools().length;

  } catch (error) {
    server.info.status = 'error';
    server.info.lastError = error instanceof Error ? error.message : 'Unknown error';
    throw error;
  }

  return server.info;
}

export async function stopServer(id: string): Promise<MCPServerInfo> {
  const server = servers.get(id);
  if (!server) {
    throw new Error(`Server ${id} not found`);
  }

  await server.client.disconnect();
  server.info.status = 'stopped';
  server.info.toolCount = 0;

  return server.info;
}

export function getAllServers(): MCPServerInfo[] {
  return Array.from(servers.values()).map(s => s.info);
}

export function getServerTools(id: string): ToolDefinition[] {
  const server = servers.get(id);
  if (!server || !server.client.isConnected()) {
    return [];
  }
  return server.client.getTools();
}

export function getAllTools(): ToolDefinition[] {
  const allTools: ToolDefinition[] = [];
  for (const [, server] of servers) {
    if (server.client.isConnected()) {
      for (const tool of server.client.getTools()) {
        // Encode server ID + tool name into a valid API name.
        // Claude's tool name pattern: ^[a-zA-Z0-9_-]{1,128}$ — no colons allowed.
        // We use double-underscore as separator: "SERVERID__toolname"
        allTools.push({
          ...tool,
          name: `${server.info.id}__${tool.name}`,
        });
      }
    }
  }
  return allTools;
}

/**
 * Given a bare tool name (e.g. "list_directory"), find the ID of the first
 * connected server that exposes that tool.  Also handles the already-encoded
 * "SERVERID__toolname" format by stripping the prefix first.
 */
export function findServerIdForTool(toolName: string): string | undefined {
  // Strip any existing SERVERID__ prefix so we always compare bare names
  const dunderIdx = toolName.indexOf('__');
  const bareName = dunderIdx !== -1 ? toolName.substring(dunderIdx + 2) : toolName;

  for (const [serverId, server] of servers) {
    if (!server.client.isConnected()) continue;
    const tools = server.client.getTools();
    if (tools.some(t => t.name === bareName)) {
      return serverId;
    }
  }
  return undefined;
}

export async function removeServer(id: string): Promise<void> {
  const server = servers.get(id);
  if (server) {
    await server.client.disconnect();
    servers.delete(id);
  }
}

export async function pauseAllServers(): Promise<void> {
  const promises = [];
  for (const [id, server] of servers) {
    if (server.client.isConnected()) {
      promises.push(
        server.client.disconnect().then(() => {
          server.info.status = 'paused';
          server.info.toolCount = 0;
        }).catch(err => {
          console.error(`[MCP] Failed to pause server ${id}:`, err);
        })
      );
    }
  }
  await Promise.all(promises);
}

export async function restoreConnections(): Promise<void> {
  const db = getDrizzleDb();
  let savedServers: any[] = [];
  try {
    savedServers = await db.select().from(schema.servers);
  } catch (error) {
    console.error('[MCP] Failed to query databases for saved servers.', error);
    return;
  }

  if (savedServers.length === 0) return;

  console.log(`[MCP] Restoring connections for ${savedServers.length} servers...`);

  let validServersToStart: string[] = [];
  
  const configuredServers = await Promise.all(
    savedServers.map(s => {
      let parsedArgs: string[] | undefined;
      let parsedEnv: Record<string, string> | undefined;

      try {
        parsedArgs = s.args ? JSON.parse(s.args) : undefined;
      } catch (e) {
        console.error(`[MCP] FATAL: Could not parse args for server '${s.name}'. It may be corrupted. Skipping.`);
        // Mark as error locally without modifying DB immediately, migration script handles the rest
        s.status = 'error';
      }

      try {
        parsedEnv = s.env_vars ? JSON.parse(s.env_vars) : undefined;
      } catch (e) {
        console.error(`[MCP] FATAL: Could not parse envVars for server '${s.name}'. Skipping.`);
        s.status = 'error';
      }

      if (s.status !== 'error') {
        validServersToStart.push(s.id);
        
        // Ensure legacy servers have default permissions initialized
        const existingPerm = getPermissionForServer(s.id);
        if (!existingPerm) {
          console.log(`[MCP] Migrating legacy server '${s.name}': generating default permissions.`);
          createDefaultPermission(s.id).catch(err => {
            console.error(`[MCP] Failed to create default permissions for ${s.name}:`, err);
          });
        }
      }

      return registerServer({
        id: s.id,
        name: s.name,
        transport: s.transport,
        command: s.command,
        args: parsedArgs,
        envVars: parsedEnv,
        url: s.url,
      });
    })
  );

  const results = await Promise.allSettled(
    validServersToStart.map(id => startServer(id))
  );

  let successCount = 0;
  results.forEach((result, idx) => {
    if (result.status === 'fulfilled') {
      successCount++;
    } else {
      console.error(`[MCP] Failed to auto-reconnect server "${configuredServers[idx].name}":`, result.reason?.message || result.reason);
    }
  });

  console.log(`[MCP] Restoration complete. ${successCount}/${validServersToStart.length} valid servers online (${savedServers.length - validServersToStart.length} skipped due to corruption).`);
}

export async function migrateServerArguments(): Promise<void> {
  const db = getDrizzleDb();
  let savedServers: any[] = [];
  try {
    savedServers = await db.select().from(schema.servers);
  } catch (error) {
    return;
  }

  let migratedCount = 0;

  for (const s of savedServers) {
    if (!s.args || String(s.args).trim() === '') continue;

    let needsMigration = false;
    let newArgsStr = s.args;

    try {
      const parsed = JSON.parse(s.args);
      if (!Array.isArray(parsed)) {
        // Technically valid JSON, but not an array
        newArgsStr = JSON.stringify([String(parsed)]);
        needsMigration = true;
      }
    } catch {
      // It's a raw string, split by spaces
      const parts = s.args.split(' ').filter(Boolean);
      newArgsStr = JSON.stringify(parts);
      needsMigration = true;
    }

    if (needsMigration) {
      await db.update(schema.servers)
        .set({ args: newArgsStr })
        .where(eq(schema.servers.id, s.id));
      migratedCount++;
    }
  }

  if (migratedCount > 0) {
    console.log(`[MCP] Migrated ${migratedCount} legacy server(s) to secure JSON arguments formats.`);
  }
}
