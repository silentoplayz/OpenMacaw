import { FastifyInstance } from 'fastify';
import { getDrizzleDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { nanoid } from 'nanoid';
import Database from 'better-sqlite3';

// ── Persistent login rate limiter (SQLite-backed) ─────────────────────────────
// Uses better-sqlite3 directly for atomic, synchronous read-modify-write.
// Falls back to allow-through if the DB connection is unavailable.

let _rateLimitDb: Database.Database | null = null;

function getRateLimitDb(): Database.Database {
  if (_rateLimitDb) return _rateLimitDb;
  const dbPath = process.env.DATABASE_URL || './data/app.db';
  _rateLimitDb = new Database(dbPath);
  _rateLimitDb.pragma('journal_mode = WAL');
  _rateLimitDb.exec(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      key   TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      reset_at INTEGER NOT NULL
    )
  `);
  return _rateLimitDb;
}

/**
 * Returns true and increments the counter if the request should be rate-limited.
 * The window is 60 seconds; limit is 5 attempts per (IP, email) pair.
 */
function checkAndIncrementLoginAttempts(key: string): boolean {
  const db = getRateLimitDb();
  const now = Date.now();
  const windowMs = 60 * 1000;
  const limit = 5;

  const row = db.prepare('SELECT count, reset_at FROM login_attempts WHERE key = ?').get(key) as
    | { count: number; reset_at: number }
    | undefined;

  if (!row || now > row.reset_at) {
    // First attempt in this window — upsert with count=1
    db.prepare(
      'INSERT INTO login_attempts (key, count, reset_at) VALUES (?, 1, ?)'
      + ' ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = excluded.reset_at'
    ).run(key, now + windowMs);
    return false; // not rate-limited
  }

  if (row.count >= limit) {
    return true; // rate-limited, do not increment further
  }

  db.prepare('UPDATE login_attempts SET count = count + 1 WHERE key = ?').run(key);
  return false; // allowed, counter incremented
}

export async function authRoutes(fastify: FastifyInstance) {
  fastify.get('/api/auth/status', async (_request, _reply) => {
    const db = getDrizzleDb();
    const existingUsers = await db.select().from(schema.users).limit(1);
    const settingsData = await db.select().from(schema.settings).where(eq(schema.settings.key, 'ENABLE_SIGNUP')).limit(1);
    const enableSignup = settingsData.length > 0 ? settingsData[0].value !== 'false' : true;
    return { needsSetup: existingUsers.length === 0, enableSignup };
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
    
    let role = 'user';
    
    if (isFirstUser) {
      role = 'admin';
    } else {
      const settingsData = await db.select().from(schema.settings);
      const config: Record<string, string> = {};
      for (const row of settingsData) {
        config[row.key] = row.value;
      }
      
      // True by default, but block if explicitly false in config/env
      if (config.ENABLE_SIGNUP === 'false') {
        return reply.code(403).send({ error: 'User registration is currently disabled' });
      }
      
      role = config.DEFAULT_NEW_USER_ROLE || 'pending';
    }

    const isSuperAdmin = isFirstUser ? 1 : 0;
    const passwordHash = await bcrypt.hash(password, 10);
    const id = nanoid();

    // (registration details intentionally not logged)

    await db.insert(schema.users).values({
      id,
      name,
      email,
      passwordHash,
      role,
      isSuperAdmin,
      createdAt: new Date(),
    });

    if (role === 'pending') {
      return reply.code(201).send({ message: "Registration successful. Pending admin approval." });
    }

    const token = (fastify as any).jwt.sign({ id, email, role, isSuperAdmin });
    return reply.code(201).send({ token, user: { id, name, email, role, isSuperAdmin, profileImageUrl: null } });
  });

  fastify.post('/api/auth/login', async (request, reply) => {
    const { email, password } = request.body as any;
    if (!email || !password) {
      return reply.code(400).send({ error: 'Email and password are required' });
    }

    const ip = request.ip || 'unknown';
    const rateLimitKey = `${ip}:${email.toLowerCase()}`;

    if (checkAndIncrementLoginAttempts(rateLimitKey)) {
      return reply.code(429).send({ error: 'Too many requests. Please wait a minute.' });
    }

    const db = getDrizzleDb();
    const users = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    const user = users[0];

    if (!user) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    // (auth attempt details intentionally not logged)

    if (user.role === 'pending') {
      return reply.code(403).send({ message: 'Account Activation Pending' });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    // Update last_active timestamp
    await db.update(schema.users).set({ lastActive: new Date() }).where(eq(schema.users.id, user.id));

    const token = (fastify as any).jwt.sign({ id: user.id, email: user.email, role: user.role, isSuperAdmin: user.isSuperAdmin });
    return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role, isSuperAdmin: user.isSuperAdmin, profileImageUrl: user.profileImageUrl } };
  });

  fastify.get('/api/auth/me', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const payload = (request as any).user;
    if (!payload?.id) {
      return reply.code(401).send({ error: 'Invalid token' });
    }

    const db = getDrizzleDb();
    const users = await db.select().from(schema.users).where(eq(schema.users.id, payload.id)).limit(1);
    const user = users[0];

    if (!user || user.role === 'pending') {
      return reply.code(401).send({ error: 'Unauthorized or account disabled.' });
    }

    // Phase 87: Self-Healing JWT. Issue a fresh token with current DB role.
    const token = (fastify as any).jwt.sign(
      { id: user.id, email: user.email, role: user.role, isSuperAdmin: user.isSuperAdmin },
      { expiresIn: '7d' }
    );

    return reply.send({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isSuperAdmin: user.isSuperAdmin,
        profileImageUrl: user.profileImageUrl
      }
    });
  });
}
