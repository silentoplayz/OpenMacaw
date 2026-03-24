/**
 * app.ts — Fastify application factory.
 *
 * Exported separately from index.ts so that test suites can import
 * `buildApp()` without triggering the `start()` side-effect (DB init,
 * listen, MCP restoration).  index.ts remains the production entry point.
 */

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import cors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import fastifyJwt from '@fastify/jwt';
import fastifyMultipart from '@fastify/multipart';
import { existsSync, readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getDrizzleDb } from './db/index.js';
import { loadConfig } from './config.js';
import * as schema from './db/schema.js';
import { eq } from 'drizzle-orm';
import {
  serversRoutes,
  permissionsRoutes,
  sessionsRoutes,
  settingsRoutes,
  activityRoutes,
  chatRoutes,
  executeRoutes,
  ollamaRoutes,
  registryRoutes,
  pipelinesRoutes,
  modelCheckRoutes,
  agenticRoutes,
  authRoutes,
  adminRoutes,
  skillsRoutes,
} from './routes/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve the JWT signing secret.
 * - Production: requires an explicit JWT_SECRET env var; refuses to start without one.
 * - Development: falls back to a random per-run secret (sessions won't survive restarts).
 */
function getJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET environment variable is required in production.');
    console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }
  const devSecret = randomBytes(32).toString('hex');
  console.warn('WARNING: No JWT_SECRET set — using random ephemeral secret (sessions will not survive restarts).');
  return devSecret;
}

export async function buildApp() {
  loadConfig();

  const fastify = Fastify({ logger: false });

  await fastify.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no Origin (same-origin, non-browser clients)
      if (!origin) return cb(null, true);
      // Dev origins
      const devOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://localhost:4000'];
      if (devOrigins.includes(origin)) return cb(null, true);
      // In production, allow same-origin (any host serving the app)
      cb(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  });
  await fastify.register(fastifyWebsocket, {
    options: { maxPayload: 1_048_576 }, // 1MB — prevent memory exhaustion from oversized messages
  });
  await fastify.register(fastifyJwt, {
    secret: getJwtSecret(),
  });
  await fastify.register(fastifyMultipart, {
    limits: {
      fileSize: 5 * 1024 * 1024 // 5MB max file size
    }
  });

  // ── HTTP Security Headers (à la OWASP ASVS A14) ─────────────────────────────
  // Applied to every HTML response (the Vite SPA). API JSON responses are
  // also covered, which is fine — standard browser headers on JSON are harmless.
  fastify.addHook('onSend', async (_req: any, reply: any, payload: any) => {
    const ct = reply.getHeader('content-type');
    const isHtml = typeof ct === 'string' && ct.includes('text/html');
    if (isHtml) {
      // 'unsafe-inline' is required because Vite's production build inlines
      // bootstrap scripts. If the CSP is tightened further (nonce/hash), remove it.
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "img-src 'self' data: blob:; " +
        "connect-src 'self' ws: wss:; " +
        "font-src 'self' data: https://fonts.gstatic.com"
      );
    }
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    return payload;
  });

  // Global Auth Middleware
  fastify.addHook('onRequest', async (request: any, reply: any) => {
    const url = request.url;
    // Bypass websockets and public auth routes (setup, login, status)
    if (url.startsWith('/ws') || url.startsWith('/api/auth')) return;

    // Protect all other /api/ routes
    if (url.startsWith('/api/')) {
      try {
        await request.jwtVerify();
        const payload = (request as any).user;
        if (payload?.id) {
          const db = getDrizzleDb();
          const users = await db.select().from(schema.users).where(eq(schema.users.id, payload.id)).limit(1);
          const currentUser = users[0];
          if (!currentUser || currentUser.role === 'pending') {
            return reply.code(401).send({ error: 'Unauthorized or account disabled.' });
          }
        } else {
          return reply.code(401).send({ error: 'Unauthorized. Invalid token.' });
        }
      } catch (err) {
        return reply.code(401).send({ error: 'Unauthorized. Please log in.' });
      }
    }
  });

  // API routes first
  await fastify.register(serversRoutes);
  await fastify.register(permissionsRoutes);
  await fastify.register(sessionsRoutes);
  await fastify.register(settingsRoutes);
  await fastify.register(activityRoutes);
  await fastify.register(chatRoutes);
  await fastify.register(executeRoutes);
  await fastify.register(ollamaRoutes);
  await fastify.register(registryRoutes);
  await fastify.register(pipelinesRoutes);
  await fastify.register(modelCheckRoutes);
  await fastify.register(agenticRoutes);
  await fastify.register(authRoutes);
  await fastify.register(adminRoutes);
  await fastify.register(skillsRoutes);

  // Serve built frontend
  const frontendPath = join(__dirname, '../../web/dist');
  const indexPath = join(frontendPath, 'index.html');

  if (existsSync(frontendPath)) {
    // Serve ALL static files from dist/ — icons, sw.js, workbox, manifest, assets, etc.
    await fastify.register(fastifyStatic, {
      root: frontendPath,
      prefix: '/',
      decorateReply: true,
      wildcard: false,
      serve: true,
      index: false,
    });

    // SPA catch-all — serves index.html for every non-API, non-asset route
    fastify.get('/*', async (_request: any, reply: any) => {
      if (existsSync(indexPath)) {
        const indexHtml = readFileSync(indexPath, 'utf-8');
        return reply
          .header('Cache-Control', 'no-cache, no-store, must-revalidate')
          .type('text/html')
          .send(indexHtml);
      }
      return reply.code(404).send({ error: 'Not Found' });
    });
  }

  return fastify;
}
