import { FastifyInstance } from 'fastify';
import { getDrizzleDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq, count } from 'drizzle-orm';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';

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
        isSuperAdmin: schema.users.isSuperAdmin,
        lastActive: schema.users.lastActive,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users);

    return users;
  });

  // ── POST /api/admin/users ─────────────────────────────────────────────────
  fastify.post('/api/admin/users', async (request, reply) => {
    const { name, email, password, role } = request.body as {
      name?: string; email?: string; password?: string; role?: string;
    };
    const currentUser = (request as any).user;

    // Validate required fields
    if (!name || !email || !password) {
      return reply.code(400).send({ error: 'Name, email, and password are required.' });
    }
    if (password.length < 8) {
      return reply.code(400).send({ error: 'Password must be at least 8 characters.' });
    }

    const db = getDrizzleDb();

    // Fetch requesting user from DB — the JWT may be stale
    const [requestingUserRecord] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, currentUser.id))
      .limit(1);

    // Only Super Admin can create admin-role accounts
    const desiredRole = role === 'admin' ? 'admin' : 'user';
    if (desiredRole === 'admin' && requestingUserRecord?.isSuperAdmin !== 1) {
      return reply.code(403).send({ error: 'Only the Super Admin can create Admin-role accounts.' });
    }

    // Check email uniqueness
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (existing) {
      return reply.code(409).send({ error: 'Email already registered.' });
    }

    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 10);
    const id = nanoid();

    await db.insert(schema.users).values({
      id,
      name,
      email,
      passwordHash,
      role: desiredRole,
      isSuperAdmin: 0,
      createdAt: new Date(),
    });

    return { success: true, user: { id, name, email, role: desiredRole } };
  });

  // ── PUT /api/admin/users/:id ──────────────────────────────────────────────
  fastify.put('/api/admin/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, email, role, password } = request.body as { name?: string; email?: string; role?: string; password?: string };
    const currentUser = (request as any).user;

    const db = getDrizzleDb();

    // ── Fetch both users from DB — immune to stale JWT claims ─────────────
    const [target] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    if (!target) {
      return reply.code(404).send({ error: 'User not found.' });
    }
    const [requestingUserRecord] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, currentUser.id))
      .limit(1);

    // ── GOD MODE: Super Admin short-circuits all hierarchy checks ──────────
    const isSuperAdmin = requestingUserRecord?.isSuperAdmin === 1;

    if (!isSuperAdmin) {
      // Block standard admins from editing ANY details of other admins
      if (target.role === 'admin' && currentUser.id !== id) {
        return reply.code(403).send({ error: 'Admins cannot modify other Admins. Only the Super Admin has this power.' });
      }
    }

    // Block self-demotion (even for Super Admin — prevents lockout)
    if (currentUser.id === id && role && role !== 'admin') {
      return reply.code(403).send({ error: 'You cannot demote your own admin account.' });
    }

    // Block self-password-change at API level (use Settings page instead)
    if (currentUser.id === id && password) {
      return reply.code(403).send({ error: 'Use the Settings page to change your own password.' });
    }

    // Validate role if provided
    if (role && role !== 'admin' && role !== 'user' && role !== 'pending') {
      return reply.code(400).send({ error: 'Role must be "admin", "user", or "pending".' });
    }

    // Validate new password if provided
    if (password !== undefined && password.length < 8) {
      return reply.code(400).send({ error: 'Password must be at least 8 characters.' });
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

    // Hash password if provided
    if (password) {
      const bcrypt = await import('bcryptjs');
      updates.passwordHash = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'No fields to update.' });
    }

    await db.update(schema.users).set(updates).where(eq(schema.users.id, id));

    let token;
    // Identity Sync (Phase 85): If updating yourself, issue a fresh JWT
    if (currentUser.id === id) {
      const newPayload = {
        id: target.id,
        name: updates.name ?? target.name,
        email: updates.email ?? target.email,
        role: updates.role ?? target.role,
        isSuperAdmin: target.isSuperAdmin
      };
      token = fastify.jwt.sign(newPayload, { expiresIn: '7d' });
    }

    return { success: true, updatedUserId: id, token };
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

    // ── Fetch both users from DB — immune to stale JWT claims ─────────────
    const [target] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    if (!target) {
      return reply.code(404).send({ error: 'User not found.' });
    }
    const [requestingUserRecord] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, currentUser.id))
      .limit(1);

    // ── GOD MODE: Super Admin short-circuits all hierarchy checks ──────────
    const isSuperAdmin = requestingUserRecord?.isSuperAdmin === 1;

    if (!isSuperAdmin) {
      // Block standard admins from deleting other admins
      if (target.role === 'admin') {
        return reply.code(403).send({ error: 'Admins cannot delete other Admins. Only the Super Admin has this power.' });
      }
    }

    // Delete (sessions cascade via schema)
    await db.delete(schema.users).where(eq(schema.users.id, id));

    return { success: true, deletedUserId: id };
  });
}
