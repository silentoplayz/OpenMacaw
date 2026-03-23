/**
 * Shared test helpers for integration tests.
 *
 * Each integration test file should call buildTestApp() in beforeAll() and
 * app.close() in afterAll().  The DATABASE_URL=:memory: env var ensures every
 * Vitest worker (which runs one test file) gets a completely isolated SQLite
 * database — no cross-test contamination.
 */

import { initDatabase, getDrizzleDb } from '../../db/index.js';
import { buildApp } from '../../app.js';
import * as schema from '../../db/schema.js';
import bcrypt from 'bcrypt';
import { nanoid } from 'nanoid';

// Make sure the in-memory DB is used before any module touches DATABASE_URL
process.env.DATABASE_URL = ':memory:';
process.env.JWT_SECRET = 'test-secret-for-vitest-only';

export async function buildTestApp() {
  initDatabase();
  const app = await buildApp();
  await app.ready();
  return app;
}

/**
 * Create a test user in the in-memory DB and return the signed JWT.
 * Must be called AFTER buildTestApp() (i.e. after initDatabase()).
 */
export async function createTestUser(
  app: Awaited<ReturnType<typeof buildTestApp>>,
  opts: {
    email?: string;
    password?: string;
    role?: 'admin' | 'user' | 'pending';
  } = {}
): Promise<{ token: string; userId: string; email: string }> {
  const email = opts.email ?? `test-${nanoid(6)}@example.com`;
  const password = opts.password ?? 'TestPassword123!';
  const role = opts.role ?? 'admin';

  const passwordHash = await bcrypt.hash(password, 1); // cost=1 for test speed
  const userId = nanoid();

  const db = getDrizzleDb();
  await db.insert(schema.users).values({
    id: userId,
    name: 'Test User',
    email,
    passwordHash,
    role,
    isSuperAdmin: role === 'admin' ? 1 : 0,
    createdAt: new Date(),
  });

  // Sign a token using the same Fastify JWT instance that buildApp() set up
  const token = (app as any).jwt.sign({ id: userId, email, role, isSuperAdmin: role === 'admin' ? 1 : 0 });

  return { token, userId, email };
}
