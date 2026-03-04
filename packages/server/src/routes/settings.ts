import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb, schema } from '../db/index.js';
import { getUserSettingsRaw } from '../config.js';
import { nanoid } from 'nanoid';

export async function settingsRoutes(fastify: FastifyInstance): Promise<void> {
  // ── Global Settings (read by everyone, write by admins only) ────────────────

  fastify.get('/api/settings', async (_request: FastifyRequest, reply: FastifyReply) => {
    const db = getDb();
    const settings = db.select(schema.settings as any).where().all() as any[];
    
    const result: Record<string, string> = {};
    for (const s of settings) {
      result[s.key] = s.value;
    }
    
    return reply.send(result);
  });

  fastify.get('/api/settings/:key', async (request: FastifyRequest<{ Params: { key: string } }>, reply: FastifyReply) => {
    const { key } = request.params;
    const db = getDb();
    const settings = db.select(schema.settings as any).where((getCol: (col: string) => any) => getCol('key') === key).all() as any[];
    
    if (settings.length === 0) {
      return reply.code(404).send({ error: 'Setting not found' });
    }
    
    const setting = settings[0];
    return reply.send({ key: setting.key, value: setting.value });
  });

  // Admin-only: Write global settings
  fastify.put('/api/settings/:key', async (request: FastifyRequest<{ Params: { key: string } }>, reply: FastifyReply) => {
    // Admin guard
    const user = (request as any).user;
    if (!user || user.role !== 'admin') {
      return reply.code(403).send({ error: 'Only admins can modify workspace settings.' });
    }

    const { key } = request.params;
    const body = request.body as { value: string };
    const db = getDb();

    db.insert(schema.settings as any).onConflictDoUpdate({
      target: 'key',
      set: { key, value: body.value, updatedAt: Date.now() },
    });

    return reply.send({ key, value: body.value });
  });

  // Admin-only: Delete global settings
  fastify.delete('/api/settings/:key', async (request: FastifyRequest<{ Params: { key: string } }>, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user || user.role !== 'admin') {
      return reply.code(403).send({ error: 'Only admins can modify workspace settings.' });
    }

    const { key } = request.params;
    const db = getDb();
    db.delete(schema.settings as any).where((getCol: (col: string) => any) => getCol('key') === key);
    return reply.send({ success: true });
  });

  // ── User Settings (personal, per-user) ──────────────────────────────────────

  fastify.get('/api/user/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user?.id) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const settings = getUserSettingsRaw(user.id);
    return reply.send(settings);
  });

  fastify.put('/api/user/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user?.id) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const body = request.body as { key: string; value: string };
    if (!body.key) {
      return reply.code(400).send({ error: 'key is required' });
    }

    const db = getDb();
    const id = nanoid();

    // Upsert: try update first, insert if no rows changed
    const existing = db.select('user_settings' as any)
      .where((col: (k: string) => any) => col('userId') === user.id && col('key') === body.key)
      .all() as any[];

    if (existing.length > 0) {
      db.update('user_settings' as any).set({
        value: body.value,
        updatedAt: Date.now(),
      }).where((col: (k: string) => any) => col('userId') === user.id && col('key') === body.key);
    } else {
      db.insert('user_settings' as any).values({
        id,
        userId: user.id,
        key: body.key,
        value: body.value,
        updatedAt: Date.now(),
      });
    }

    return reply.send({ key: body.key, value: body.value });
  });

  // Bulk save for user settings (saves multiple key/value pairs at once)
  fastify.put('/api/user/settings/bulk', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user?.id) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const body = request.body as Record<string, string>;
    const db = getDb();

    for (const [key, value] of Object.entries(body)) {
      const existing = db.select('user_settings' as any)
        .where((col: (k: string) => any) => col('userId') === user.id && col('key') === key)
        .all() as any[];

      if (existing.length > 0) {
        db.update('user_settings' as any).set({
          value,
          updatedAt: Date.now(),
        }).where((col: (k: string) => any) => col('userId') === user.id && col('key') === key);
      } else {
        db.insert('user_settings' as any).values({
          id: nanoid(),
          userId: user.id,
          key,
          value,
          updatedAt: Date.now(),
        });
      }
    }

    return reply.send({ success: true });
  });
}
