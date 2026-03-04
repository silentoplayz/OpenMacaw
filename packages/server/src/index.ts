import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import cors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import fastifyJwt from '@fastify/jwt';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getDrizzleDb, initDatabase } from './db/index.js';
import { loadConfig } from './config.js';
import * as schema from './db/schema.js';
import { eq } from 'drizzle-orm';
import { restoreConnections, migrateServerArguments } from './mcp/index.js';
import { restorePipelinesAsync } from './pipelines/index.js';
import { ensureDefaultSession } from './agent/index.js';
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
} from './routes/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function buildApp() {
  loadConfig();

  const fastify = Fastify({ logger: false });

  await fastify.register(cors, { 
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://localhost:4000'], 
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  });
  await fastify.register(fastifyWebsocket);
  await fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || 'super-secret-openmacaw-key-change-me'
  });

  // Global Auth Middleware
  fastify.addHook('onRequest', async (request, reply) => {
    const url = request.url;
    // Bypass websockets and public auth routes (setup, login, status)
    if (url.startsWith('/ws') || url.startsWith('/api/auth')) return;
    
    // Protect all other /api/ routes
    if (url.startsWith('/api/')) {
      try {
        await request.jwtVerify();
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

  // Serve built frontend
  const frontendPath = join(__dirname, '../../web/dist');

  const indexPath = join(frontendPath, 'index.html');

  if (existsSync(frontendPath)) {
    console.log(`Serving frontend from: ${frontendPath}`);

    // Serve ALL static files from dist/ — icons, sw.js, workbox, manifest, assets, etc.
    // wildcard: false means it only intercepts paths that map to a real file; anything
    // else falls through to the SPA catch-all below.
    await fastify.register(fastifyStatic, {
      root: frontendPath,
      prefix: '/',
      decorateReply: true,
      wildcard: false,
      serve: true,
      index: false, // don't auto-serve index.html here — SPA handler does it
    });

    // SPA catch-all — serves index.html for every non-API, non-asset route so that
    // deep links and page refreshes work correctly.
    fastify.get('/*', async (_request, reply) => {
      if (existsSync(indexPath)) {
        const indexHtml = readFileSync(indexPath, 'utf-8');
        return reply
          .header('Cache-Control', 'no-cache, no-store, must-revalidate')
          .type('text/html')
          .send(indexHtml);
      }
      return reply.code(404).send({ error: 'Not Found' });
    });
  } else {
    console.warn(`Frontend dist not found at ${frontendPath}. Run: cd packages/web && npm run build`);
  }

  return fastify;
}

async function start() {
  try {
    initDatabase();
    console.log('Database initialized');

    // Ensure there is always at least one session so the chat UI works out of the box
    const db = getDrizzleDb();
    const existingUsers = await db.select().from(schema.users).where(eq(schema.users.role, 'admin')).limit(1);
    const firstAdmin = existingUsers[0];
    if (firstAdmin?.id) {
      ensureDefaultSession(firstAdmin.id);
    }

    const app = await buildApp();

    await app.listen({ port: parseInt(process.env.PORT || '3000'), host: '0.0.0.0' });
    console.log(`\nOpenMacaw running at http://0.0.0.0:${process.env.PORT || '3000'}\n`);

    // Async trigger MCP auto-reconnection in the background 
    // without blocking the main Fastify loop
    (async () => {
      try {
        await migrateServerArguments();
        await restoreConnections();
        await restorePipelinesAsync();
      } catch (err) {
        console.error('Fatal failure during background MCP/pipeline restoration:', err);
      }
    })();
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();

