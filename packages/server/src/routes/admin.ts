import { FastifyInstance } from 'fastify';
import { getDrizzleDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq, count } from 'drizzle-orm';
import { existsSync, statSync } from 'fs';
import { join } from 'path';

export async function adminRoutes(fastify: FastifyInstance) {
  // Admin-only guard
  fastify.addHook('onRequest', async (request, reply) => {
    // JWT is already verified by the global auth middleware.
    // Here we just need to check the role.
    try {
      const user = (request as any).user;
      if (!user || user.role !== 'admin') {
        return reply.code(403).send({ error: 'Forbidden. Admin access required.' });
      }
    } catch {
      return reply.code(403).send({ error: 'Forbidden. Admin access required.' });
    }
  });

  // ── GET /api/admin/stats ──────────────────────────────────────────────────
  fastify.get('/api/admin/stats', async (_request, _reply) => {
    const db = getDrizzleDb();

    const [userCount] = await db.select({ count: count() }).from(schema.users);
    const [sessionCount] = await db.select({ count: count() }).from(schema.sessions);
    const [messageCount] = await db.select({ count: count() }).from(schema.messages);

    // Approximate DB size
    let dbSizeBytes = 0;
    try {
      const dbPath = join(process.cwd(), 'data', 'app.db');
      if (existsSync(dbPath)) {
        dbSizeBytes = statSync(dbPath).size;
      }
    } catch { /* ignore */ }

    return {
      totalUsers: userCount.count,
      totalSessions: sessionCount.count,
      totalMessages: messageCount.count,
      dbSizeBytes,
    };
  });

  // ── GET /api/admin/users ──────────────────────────────────────────────────
  fastify.get('/api/admin/users', async (_request, _reply) => {
    const db = getDrizzleDb();
    const users = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        lastActive: schema.users.lastActive,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users);

    return users;
  });

  // ── PUT /api/admin/users/:id ──────────────────────────────────────────────
  fastify.put('/api/admin/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, email, role } = request.body as { name?: string; email?: string; role?: string };
    const currentUser = (request as any).user;

    const db = getDrizzleDb();

    // Check user exists
    const [target] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    if (!target) {
      return reply.code(404).send({ error: 'User not found.' });
    }

    // Block self-demotion
    if (currentUser.id === id && role && role !== 'admin') {
      return reply.code(403).send({ error: 'You cannot demote your own admin account.' });
    }

    // Validate role if provided
    if (role && role !== 'admin' && role !== 'user') {
      return reply.code(400).send({ error: 'Role must be "admin" or "user".' });
    }

    // Check email uniqueness if changed
    if (email && email !== target.email) {
      const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
      if (existing) {
        return reply.code(409).send({ error: 'Email already in use by another account.' });
      }
    }

    // Build update object
    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (role !== undefined) updates.role = role;

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'No fields to update.' });
    }

    await db.update(schema.users).set(updates).where(eq(schema.users.id, id));

    return { success: true, updatedUserId: id };
  });

  // ── DELETE /api/admin/users/:id ───────────────────────────────────────────
  fastify.delete('/api/admin/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const currentUser = (request as any).user;

    // Block self-deletion
    if (currentUser.id === id) {
      return reply.code(400).send({ error: 'You cannot delete your own account.' });
    }

    const db = getDrizzleDb();

    // Check user exists
    const [target] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    if (!target) {
      return reply.code(404).send({ error: 'User not found.' });
    }

    // Delete (sessions cascade via schema)
    await db.delete(schema.users).where(eq(schema.users.id, id));

    return { success: true, deletedUserId: id };
  });
}
