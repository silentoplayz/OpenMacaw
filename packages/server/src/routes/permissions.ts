import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getPermissionForServer, updatePermission, getAllPermissions } from '../permissions/index.js';

export async function permissionsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/permissions/:serverId', async (request: FastifyRequest<{ Params: { serverId: string } }>, reply: FastifyReply) => {
    const { serverId } = request.params;
    const perm = getPermissionForServer(serverId);
    
    if (!perm) {
      return reply.code(404).send({ error: 'Permission not found' });
    }
    
    return reply.send(perm);
  });

  fastify.put('/api/permissions/:serverId', async (request: FastifyRequest<{ Params: { serverId: string } }>, reply: FastifyReply) => {
    const { serverId } = request.params;
    const body = request.body as Record<string, unknown>;
    
    const updates: Record<string, unknown> = {};
    
    if (Array.isArray(body.allowedPaths)) updates.allowedPaths = body.allowedPaths;
    if (Array.isArray(body.deniedPaths)) updates.deniedPaths = body.deniedPaths;
    if (typeof body.pathRead === 'boolean') updates.pathRead = body.pathRead;
    if (typeof body.pathWrite === 'boolean') updates.pathWrite = body.pathWrite;
    if (typeof body.pathCreate === 'boolean') updates.pathCreate = body.pathCreate;
    if (typeof body.pathDelete === 'boolean') updates.pathDelete = body.pathDelete;
    if (typeof body.pathListDir === 'boolean') updates.pathListDir = body.pathListDir;
    if (typeof body.bashAllowed === 'boolean') updates.bashAllowed = body.bashAllowed;
    if (Array.isArray(body.bashAllowedCommands)) updates.bashAllowedCommands = body.bashAllowedCommands;
    if (typeof (body as any).promptInjectionPrevention === 'boolean') updates.promptInjectionPrevention = (body as any).promptInjectionPrevention;
    if (typeof (body as any).toolPromptInjectionPrevention === 'object') updates.toolPromptInjectionPrevention = (body as any).toolPromptInjectionPrevention;
    if (typeof body.webfetchAllowed === 'boolean') updates.webfetchAllowed = body.webfetchAllowed;
    if (Array.isArray(body.webfetchAllowedDomains)) updates.webfetchAllowedDomains = body.webfetchAllowedDomains;
    if (typeof body.subprocessAllowed === 'boolean') updates.subprocessAllowed = body.subprocessAllowed;
    if (typeof body.networkAllowed === 'boolean') updates.networkAllowed = body.networkAllowed;
    if (typeof body.maxCallsPerMinute === 'number') updates.maxCallsPerMinute = body.maxCallsPerMinute;
    if (typeof body.maxTokensPerCall === 'number') updates.maxTokensPerCall = body.maxTokensPerCall;
    // ── Trust Policy: per-tool auto-approve ────────────────────────────────────
    if (typeof body.toolAutoApprove === 'object' && body.toolAutoApprove !== null && !Array.isArray(body.toolAutoApprove)) {
      updates.toolAutoApprove = body.toolAutoApprove;
    }
    
    const updated = await updatePermission(serverId, updates as any);
    return reply.send(updated);
  });

  fastify.patch('/api/permissions/:serverId/paths', async (request: FastifyRequest<{ Params: { serverId: string } }>, reply: FastifyReply) => {
    const { serverId } = request.params;
    const body = request.body as Record<string, unknown>;
    
    const updates: Record<string, unknown> = {};
    
    if (Array.isArray(body.allowedPaths)) updates.allowedPaths = body.allowedPaths;
    if (Array.isArray(body.deniedPaths)) updates.deniedPaths = body.deniedPaths;
    if (typeof body.pathRead === 'boolean') updates.pathRead = body.pathRead;
    if (typeof body.pathWrite === 'boolean') updates.pathWrite = body.pathWrite;
    if (typeof body.pathCreate === 'boolean') updates.pathCreate = body.pathCreate;
    if (typeof body.pathDelete === 'boolean') updates.pathDelete = body.pathDelete;
    if (typeof body.pathListDir === 'boolean') updates.pathListDir = body.pathListDir;
    
    const updated = await updatePermission(serverId, updates as any);
    return reply.send(updated);
  });

  fastify.patch('/api/permissions/:serverId/tools', async (request: FastifyRequest<{ Params: { serverId: string } }>, reply: FastifyReply) => {
    const { serverId } = request.params;
    const body = request.body as Record<string, unknown>;
    
    const updates: Record<string, unknown> = {};
    
    if (typeof body.bashAllowed === 'boolean') updates.bashAllowed = body.bashAllowed;
    if (Array.isArray(body.bashAllowedCommands)) updates.bashAllowedCommands = body.bashAllowedCommands;
    if (typeof body.webfetchAllowed === 'boolean') updates.webfetchAllowed = body.webfetchAllowed;
    if (Array.isArray(body.webfetchAllowedDomains)) updates.webfetchAllowedDomains = body.webfetchAllowedDomains;
    if (typeof body.subprocessAllowed === 'boolean') updates.subprocessAllowed = body.subprocessAllowed;
    if (typeof body.networkAllowed === 'boolean') updates.networkAllowed = body.networkAllowed;
    if (typeof (body as any).promptInjectionPrevention === 'boolean') updates.promptInjectionPrevention = (body as any).promptInjectionPrevention;
    if (typeof (body as any).toolPromptInjectionPrevention === 'object') updates.toolPromptInjectionPrevention = (body as any).toolPromptInjectionPrevention;
    
    const updated = await updatePermission(serverId, updates as any);
    return reply.send(updated);
  });

  fastify.patch('/api/permissions/:serverId/limits', async (request: FastifyRequest<{ Params: { serverId: string } }>, reply: FastifyReply) => {
    const { serverId } = request.params;
    const body = request.body as Record<string, unknown>;
    
    const updates: Record<string, unknown> = {};
    
    if (typeof body.maxCallsPerMinute === 'number') updates.maxCallsPerMinute = body.maxCallsPerMinute;
    if (typeof body.maxTokensPerCall === 'number') updates.maxTokensPerCall = body.maxTokensPerCall;
    
    const updated = await updatePermission(serverId, updates as any);
    return reply.send(updated);
  });

  fastify.patch('/api/permissions/:serverId/tool-pip/:toolName', async (request: FastifyRequest<{ Params: { serverId: string; toolName: string } }>, reply: FastifyReply) => {
    const { serverId, toolName } = request.params;
    const body = request.body as Record<string, unknown>;
    const override = body.override as 'inherit' | 'enable' | 'disable' | undefined;
    
    if (!override || !['inherit', 'enable', 'disable'].includes(override)) {
      return reply.code(400).send({ error: 'Override must be "inherit", "enable", or "disable"' });
    }
    
    const perm = getPermissionForServer(serverId);
    if (!perm) {
      return reply.code(404).send({ error: 'Permission not found' });
    }
    
    const toolOverrides = { ...perm.toolPromptInjectionPrevention, [toolName]: override };
    const updated = await updatePermission(serverId, { toolPromptInjectionPrevention: toolOverrides });
    return reply.send(updated);
  });

  fastify.get('/api/permissions', async (_request: FastifyRequest, reply: FastifyReply) => {
    const perms = getAllPermissions();
    return reply.send(perms);
  });
}
