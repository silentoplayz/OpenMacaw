import { FastifyInstance } from 'fastify';
import { getDrizzleDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { nanoid } from 'nanoid';
import { getActiveSettings } from '../config.js';

export async function authRoutes(fastify: FastifyInstance) {
  fastify.get('/api/auth/status', async (_request, _reply) => {
    const db = getDrizzleDb();
    const existingUsers = await db.select().from(schema.users).limit(1);
    return { needsSetup: existingUsers.length === 0 };
  });

  fastify.post('/api/auth/register', async (request, reply) => {
    const { name, email, password } = request.body as any;
    if (!name || !email || !password) {
      return reply.code(400).send({ error: 'Name, email, and password are required' });
    }

    const db = getDrizzleDb();
    
    // Check if email already exists
    const existingEmail = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (existingEmail.length > 0) {
      return reply.code(409).send({ error: 'Email already registered' });
    }

    // Determine role and permissions
    const allUsers = await db.select().from(schema.users).limit(1);
    const isFirstUser = allUsers.length === 0;
    
    if (!isFirstUser) {
      const config = getActiveSettings();
      // True by default, but block if explicitly false in config/env
      if (config.ENABLE_SIGNUP === false) {
        return reply.code(403).send({ error: 'User registration is currently disabled' });
      }
    }

    const role = isFirstUser ? 'admin' : 'user';
    const isSuperAdmin = isFirstUser ? 1 : 0;
    const passwordHash = await bcrypt.hash(password, 10);
    const id = nanoid();

    await db.insert(schema.users).values({
      id,
      name,
      email,
      passwordHash,
      role,
      isSuperAdmin,
      createdAt: new Date(),
    });

    const token = (fastify as any).jwt.sign({ id, email, role, isSuperAdmin });
    return { token, user: { id, name, email, role, isSuperAdmin } };
  });

  fastify.post('/api/auth/login', async (request, reply) => {
    const { email, password } = request.body as any;
    if (!email || !password) {
      return reply.code(400).send({ error: 'Email and password are required' });
    }

    const db = getDrizzleDb();
    const users = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    const user = users[0];

    if (!user) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    // Update last_active timestamp
    await db.update(schema.users).set({ lastActive: new Date() }).where(eq(schema.users.id, user.id));

    const token = (fastify as any).jwt.sign({ id: user.id, email: user.email, role: user.role, isSuperAdmin: user.isSuperAdmin });
    return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role, isSuperAdmin: user.isSuperAdmin } };
  });
}
