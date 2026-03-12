import { getDrizzleDb, initDatabase } from './db/index.js';
import * as schema from './db/schema.js';
import { eq } from 'drizzle-orm';
import { restoreConnections, migrateServerArguments } from './mcp/index.js';
import { restorePipelinesAsync } from './pipelines/index.js';
import { ensureDefaultSession } from './agent/index.js';
import { buildApp } from './app.js';

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
