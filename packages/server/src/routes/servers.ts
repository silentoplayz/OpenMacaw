import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { getDb, schema } from '../db/index.js';
import { registerServer, startServer, stopServer, getAllServers, removeServer, getServerTools, pauseAllServers, getMCPServer } from '../mcp/index.js';
import { createDefaultPermission } from '../permissions/index.js';
import { activeStreams } from '../agent/runtime.js';
import { parse as shellParse } from 'shell-quote';

const serverSchema = z.object({
  name: z.string().min(1),
  transport: z.enum(['stdio', 'http']).default('stdio'),
  command: z.string().optional(),
  args: z.string().optional(),
  envVars: z.string().optional(),
  url: z.string().optional(),
  enabled: z.boolean().optional(),
});

// ── Safe argument normalization ───────────────────────────────────────────────

// Known-dangerous command patterns:
// • Absolute paths to system executables (/bin/sh, /usr/bin/python, etc.)
// • Shell metacharacters that could chain or inject commands
// Reject:
// • Absolute paths to system binary directories (/bin/sh, /usr/bin/python, etc.)
// • Shell metacharacters that could chain or inject additional commands
const DANGEROUS_COMMAND_RE = /(?:\/(?:bin|sbin|usr\/bin|usr\/sbin|usr\/local\/bin)\/|[;&|`]|\$\()/;

/**
 * Validates that a command string is safe to spawn. Returns an error string if
 * the command is dangerous, or null if it looks safe.
 *
 * Exported for unit testing.
 */
export function validateCommand(cmd: string | undefined): string | null {
  if (!cmd) return null; // No command = HTTP transport; validated elsewhere
  if (DANGEROUS_COMMAND_RE.test(cmd)) {
    return `Command contains disallowed pattern: "${cmd}". ` +
      'Use npx, node, python3, uvx, or a relative/bare executable name.';
  }
  return null;
}

/** Exported for unit testing. */
export function normalizeArgs(argsStr?: string): string | undefined {
  if (!argsStr || argsStr.trim() === '') return undefined;
  try {
    const parsed = JSON.parse(argsStr);
    return Array.isArray(parsed) ? JSON.stringify(parsed) : JSON.stringify([String(parsed)]);
  } catch {
    // Fall back to shell-quote parsing for unquoted CLI-style strings.
    // shell-quote correctly handles quoted spaces and escape sequences, unlike split(' ').
    const parsed = shellParse(argsStr)
      .filter((token): token is string => typeof token === 'string');
    return JSON.stringify(parsed);
  }
}

function normalizeEnvVars(envStr?: string): string | undefined {
  if (!envStr || envStr.trim() === '') return undefined;
  try {
    const parsed = JSON.parse(envStr);
    return typeof parsed === 'object' && parsed !== null ? JSON.stringify(parsed) : undefined;
  } catch {
    return undefined; // Drop fundamentally broken env structs safely instead of string splitting 
  }
}

export async function serversRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/servers', async (_request: FastifyRequest, reply: FastifyReply) => {
    const db = getDb();
    const servers = db.select(schema.servers as any).where().all() as any[];
    
    const runningServers = getAllServers();
    const runningMap = new Map(runningServers.map(s => [s.id, s]));

    const result = servers.map(s => ({
      id: s.id,
      name: s.name,
      transport: s.transport,
      command: s.command,
      args: s.args,
      envVars: s.envVars,           // db.select() converts env_vars → envVars
      url: s.url,
      enabled: Boolean(s.enabled),
      status: runningMap.get(s.id as string)?.status || s.status,
      toolCount: runningMap.get(s.id as string)?.toolCount || 0,
      createdAt: s.createdAt,       // db.select() converts created_at → createdAt
      updatedAt: s.updatedAt,       // db.select() converts updated_at → updatedAt
    }));

    return reply.send(result);
  });

  fastify.post('/api/servers', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = serverSchema.parse(request.body);

    // Validate the command field before registering
    const cmdError = validateCommand(body.command);
    if (cmdError) {
      return reply.code(400).send({ error: cmdError });
    }

    const db = getDb();
    const now = Date.now();
    const id = nanoid();

    const normalizedArgs = normalizeArgs(body.args);
    const normalizedEnv = normalizeEnvVars(body.envVars);

    db.insert(schema.servers as any).values({
      id,
      name: body.name,
      transport: body.transport,
      command: body.command,
      args: normalizedArgs,
      env_vars: normalizedEnv,
      url: body.url,
      enabled: 1,
      status: 'stopped',
      created_at: now,
      updated_at: now,
    });

    await registerServer({
      id,
      name: body.name,
      transport: body.transport,
      command: body.command,
      args: normalizedArgs ? JSON.parse(normalizedArgs) : undefined,
      envVars: normalizedEnv ? JSON.parse(normalizedEnv) : undefined,
      url: body.url,
    });

    await createDefaultPermission(id);

    return reply.code(201).send({ id, name: body.name, status: 'stopped' });
  });

  fastify.get('/api/servers/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const db = getDb();
    const servers = db.select(schema.servers as any).where((getCol: (col: string) => any) => getCol('id') === id).all() as any[];

    if (servers.length === 0) {
      return reply.code(404).send({ error: 'Server not found' });
    }

    const s = servers[0];
    const runningServers = getAllServers();
    const running = runningServers.find(srv => srv.id === id);

    return reply.send({
      id: s.id,
      name: s.name,
      transport: s.transport,
      command: s.command,
      args: s.args,
      envVars: s.env_vars,
      url: s.url,
      enabled: Boolean(s.enabled),
      status: running?.status || s.status,
      toolCount: running?.toolCount || 0,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    });
  });

  fastify.put('/api/servers/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const body = serverSchema.partial().parse(request.body);
    const db = getDb();

    const updates: Record<string, unknown> = { updated_at: Date.now() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.command !== undefined) {
      const cmdError = validateCommand(body.command);
      if (cmdError) {
        return reply.code(400).send({ error: cmdError });
      }
      updates.command = body.command;
    }
    if (body.args !== undefined) updates.args = normalizeArgs(body.args);
    if (body.envVars !== undefined) updates.env_vars = normalizeEnvVars(body.envVars);
    if (body.url !== undefined) updates.url = body.url;
    if (body.transport !== undefined) updates.transport = body.transport;
    if (body.enabled !== undefined) updates.enabled = body.enabled ? 1 : 0;

    db.update(schema.servers as any).set(updates).where((getCol: (col: string) => unknown) => getCol('id') === id);

    // ── Auto-restart: stop the old process and re-register with new config ──
    // This makes the new config available immediately on next Start click.
    // We don't auto-start to avoid starting a server with potentially broken config.
    let wasRunning = false;
    try {
      const existing = getMCPServer(id);
      wasRunning = existing?.client.isConnected() ?? false;
      if (wasRunning || existing) {
        await stopServer(id).catch(() => {});
      }
    } catch { /* server may not have been registered yet */ }

    // Re-read the freshly persisted row and re-register with updated values
    const freshRows = db.select(schema.servers as any).where((getCol: (col: string) => any) => getCol('id') === id).all() as any[];
    if (freshRows.length > 0) {
      const s = freshRows[0];
      await registerServer({
        id,
        name: s.name,
        transport: s.transport,
        command: s.command,
        args: s.args ? JSON.parse(s.args) : undefined,
        envVars: s.env_vars ? JSON.parse(s.env_vars) : undefined,
        url: s.url,
      });
    }

    return reply.send({ success: true, wasRunning });
  });

  fastify.delete('/api/servers/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    
    await stopServer(id).catch(() => {});
    await removeServer(id);
    
    const db = getDb();
    const servers = db.select(schema.servers as any).where((getCol: (col: string) => any) => getCol('id') === id).all() as any[];
    if (servers.length > 0) {
      db.delete(schema.servers as any).where((getCol: (col: string) => unknown) => getCol('id') === id);
    }

    return reply.send({ success: true });
  });

  fastify.post('/api/servers/:id/start', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    
    try {
      const info = await startServer(id);
      return reply.send(info);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start server';
      return reply.code(500).send({ error: message });
    }
  });

  fastify.post('/api/servers/:id/stop', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    
    try {
      const info = await stopServer(id);
      return reply.send(info);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop server';
      return reply.code(500).send({ error: message });
    }
  });

  fastify.get('/api/servers/:id/tools', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const tools = getServerTools(id);
    return reply.send(tools);
  });

  fastify.post('/api/mcp/halt', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // 1. Terminate active LLM streams immediately
      activeStreams.forEach(controller => controller.abort());
      
      // 2. Disconnect and pause all running MCP servers
      await pauseAllServers();
      
      return reply.send({ success: true, message: 'System halted successfully' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to halt system';
      return reply.code(500).send({ error: message });
    }
  });
}
