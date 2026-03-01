import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import cors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './config.js';
import { initDatabase } from './db/index.js';
import { restoreConnections, migrateServerArguments } from './mcp/index.js';
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
} from './routes/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function buildApp() {
  loadConfig();

  const fastify = Fastify({ logger: false });

  await fastify.register(cors, { origin: true, credentials: true });
  await fastify.register(fastifyWebsocket);

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

  // Serve built frontend
  const frontendPath = join(__dirname, '../../web/dist');

  const indexPath = join(frontendPath, 'index.html');

  if (existsSync(frontendPath)) {
    console.log(`Serving frontend from: ${frontendPath}`);

    // Serve hashed assets (/assets/*) — these have content-hash filenames and never conflict with SPA routes
    const assetsPath = join(frontendPath, 'assets');
    if (existsSync(assetsPath)) {
      await fastify.register(fastifyStatic, {
        root: assetsPath,
        prefix: '/assets/',
        decorateReply: false,
      });
    }

    // SPA catch-all — serves index.html for every non-API route so deep links and refreshes work.
    // Reads from disk each time so a frontend rebuild is picked up without restarting the server.
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

    const config = loadConfig();
    const app = await buildApp();

    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    console.log(`\nOpenMacaw running at http://localhost:${config.PORT}\n`);

    // Async trigger MCP auto-reconnection in the background 
    // without blocking the main Fastify loop
    (async () => {
      try {
        await migrateServerArguments();
        await restoreConnections();
      } catch (err) {
        console.error('Fatal failure during background MCP restoration:', err);
      }
    })();
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();

