import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDrizzleDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq, and, or, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const createSkillSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(''),
  instructions: z.string().max(50000).optional().default(''),
  toolHints: z.array(z.string()).optional().default([]),
  triggers: z.array(z.string().regex(/^\/[a-z0-9_-]+$/i, 'Triggers must start with / and contain only alphanumeric, hyphens, or underscores')).optional().default([]),
  isGlobal: z.boolean().optional().default(false),
  enabled: z.boolean().optional().default(true),
});

const updateSkillSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  instructions: z.string().max(50000).optional(),
  toolHints: z.array(z.string()).optional(),
  triggers: z.array(z.string().regex(/^\/[a-z0-9_-]+$/i)).optional(),
  isGlobal: z.boolean().optional(),
  enabled: z.boolean().optional(),
  changeNote: z.string().max(500).optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function serializeSkill(skill: schema.Skill) {
  return {
    ...skill,
    toolHints: JSON.parse(skill.toolHints || '[]'),
    triggers: JSON.parse(skill.triggers || '[]'),
    isGlobal: Boolean(skill.isGlobal),
    enabled: Boolean(skill.enabled),
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────

export async function skillsRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /api/skills — list skills visible to the authenticated user
  fastify.get('/api/skills', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).user.id;
    const userRole = (request as any).user.role;
    const query = (request.query as any) || {};

    const db = getDrizzleDb();

    // Admins see everything; regular users see their own + enabled globals
    let rows: schema.Skill[];
    if (userRole === 'admin') {
      rows = await db.select().from(schema.skills).orderBy(desc(schema.skills.updatedAt));
    } else {
      rows = await db.select().from(schema.skills)
        .where(
          or(
            eq(schema.skills.userId, userId),
            and(eq(schema.skills.isGlobal, 1), eq(schema.skills.enabled, 1))
          )
        )
        .orderBy(desc(schema.skills.updatedAt));
    }

    // Apply search filter
    if (query.search) {
      const search = (query.search as string).toLowerCase();
      rows = rows.filter(s =>
        s.name.toLowerCase().includes(search) ||
        s.description.toLowerCase().includes(search)
      );
    }

    // Apply global filter
    if (query.global === 'true') {
      rows = rows.filter(s => s.isGlobal === 1);
    } else if (query.global === 'false') {
      rows = rows.filter(s => s.isGlobal === 0);
    }

    // Apply enabled filter
    if (query.enabled === 'true') {
      rows = rows.filter(s => s.enabled === 1);
    } else if (query.enabled === 'false') {
      rows = rows.filter(s => s.enabled === 0);
    }

    return reply.send(rows.map(serializeSkill));
  });

  // POST /api/skills — create a skill
  fastify.post('/api/skills', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).user.id;
    const userRole = (request as any).user.role;
    const body = createSkillSchema.parse(request.body);

    // Non-admins cannot create global skills
    if (body.isGlobal && userRole !== 'admin') {
      return reply.code(403).send({ error: 'Only admins can create global skills' });
    }

    const db = getDrizzleDb();
    const now = new Date();
    const id = nanoid();

    const skill = {
      id,
      name: body.name,
      description: body.description,
      instructions: body.instructions,
      toolHints: JSON.stringify(body.toolHints),
      triggers: JSON.stringify(body.triggers),
      userId: body.isGlobal ? null : userId,
      isGlobal: body.isGlobal ? 1 : 0,
      enabled: body.enabled ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(schema.skills).values(skill);

    // Create initial version (v1)
    await db.insert(schema.skillVersions).values({
      id: nanoid(),
      skillId: id,
      version: 1,
      instructions: body.instructions,
      changedBy: userId,
      changeNote: 'Initial version',
      createdAt: now,
    });

    const created = await db.select().from(schema.skills).where(eq(schema.skills.id, id));
    return reply.code(201).send(serializeSkill(created[0]));
  });

  // GET /api/skills/:id — get a single skill
  fastify.get('/api/skills/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const userId = (request as any).user.id;
    const userRole = (request as any).user.role;

    const db = getDrizzleDb();
    const rows = await db.select().from(schema.skills).where(eq(schema.skills.id, id));

    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Skill not found' });
    }

    const skill = rows[0];

    // Access control: owner, admin, or enabled global
    if (skill.userId !== userId && userRole !== 'admin' && !(skill.isGlobal === 1 && skill.enabled === 1)) {
      return reply.code(404).send({ error: 'Skill not found' });
    }

    return reply.send(serializeSkill(skill));
  });

  // PUT /api/skills/:id — update a skill
  fastify.put('/api/skills/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const userId = (request as any).user.id;
    const userRole = (request as any).user.role;
    const body = updateSkillSchema.parse(request.body);

    const db = getDrizzleDb();
    const rows = await db.select().from(schema.skills).where(eq(schema.skills.id, id));

    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Skill not found' });
    }

    const skill = rows[0];

    // Only owner or admin can update
    if (skill.userId !== userId && userRole !== 'admin') {
      return reply.code(403).send({ error: 'Permission denied' });
    }

    // Non-admins cannot promote to global
    if (body.isGlobal && userRole !== 'admin') {
      return reply.code(403).send({ error: 'Only admins can create global skills' });
    }

    // If instructions changed, create a version snapshot
    if (body.instructions !== undefined && body.instructions !== skill.instructions) {
      // Get next version number
      const versions = await db.select().from(schema.skillVersions)
        .where(eq(schema.skillVersions.skillId, id))
        .orderBy(desc(schema.skillVersions.version));
      const nextVersion = (versions.length > 0 ? versions[0].version : 0) + 1;

      await db.insert(schema.skillVersions).values({
        id: nanoid(),
        skillId: id,
        version: nextVersion,
        instructions: body.instructions,
        changedBy: userId,
        changeNote: body.changeNote || null,
        createdAt: new Date(),
      });
    }

    // Build update object
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.instructions !== undefined) updates.instructions = body.instructions;
    if (body.toolHints !== undefined) updates.toolHints = JSON.stringify(body.toolHints);
    if (body.triggers !== undefined) updates.triggers = JSON.stringify(body.triggers);
    if (body.enabled !== undefined) updates.enabled = body.enabled ? 1 : 0;
    if (body.isGlobal !== undefined) {
      updates.isGlobal = body.isGlobal ? 1 : 0;
      updates.userId = body.isGlobal ? null : skill.userId;
    }

    await db.update(schema.skills).set(updates).where(eq(schema.skills.id, id));

    const updated = await db.select().from(schema.skills).where(eq(schema.skills.id, id));
    return reply.send(serializeSkill(updated[0]));
  });

  // DELETE /api/skills/:id — delete a skill
  fastify.delete('/api/skills/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const userId = (request as any).user.id;
    const userRole = (request as any).user.role;

    const db = getDrizzleDb();
    const rows = await db.select().from(schema.skills).where(eq(schema.skills.id, id));

    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Skill not found' });
    }

    const skill = rows[0];

    // Only owner or admin can delete
    if (skill.userId !== userId && userRole !== 'admin') {
      return reply.code(403).send({ error: 'Permission denied' });
    }

    // CASCADE handles skill_versions deletion
    await db.delete(schema.skills).where(eq(schema.skills.id, id));
    return reply.code(204).send();
  });

  // GET /api/skills/:id/versions — list version history
  fastify.get('/api/skills/:id/versions', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const userId = (request as any).user.id;
    const userRole = (request as any).user.role;

    const db = getDrizzleDb();
    const skill = await db.select().from(schema.skills).where(eq(schema.skills.id, id));

    if (skill.length === 0) {
      return reply.code(404).send({ error: 'Skill not found' });
    }

    // Access control
    if (skill[0].userId !== userId && userRole !== 'admin' && !(skill[0].isGlobal === 1 && skill[0].enabled === 1)) {
      return reply.code(404).send({ error: 'Skill not found' });
    }

    const versions = await db.select().from(schema.skillVersions)
      .where(eq(schema.skillVersions.skillId, id))
      .orderBy(desc(schema.skillVersions.version));

    return reply.send(versions);
  });

  // POST /api/skills/:id/revert/:versionId — revert to a previous version
  fastify.post('/api/skills/:id/revert/:versionId', async (
    request: FastifyRequest<{ Params: { id: string; versionId: string } }>,
    reply: FastifyReply
  ) => {
    const { id, versionId } = request.params;
    const userId = (request as any).user.id;
    const userRole = (request as any).user.role;

    const db = getDrizzleDb();
    const skill = await db.select().from(schema.skills).where(eq(schema.skills.id, id));

    if (skill.length === 0) {
      return reply.code(404).send({ error: 'Skill not found' });
    }

    // Only owner or admin can revert
    if (skill[0].userId !== userId && userRole !== 'admin') {
      return reply.code(403).send({ error: 'Permission denied' });
    }

    const targetVersion = await db.select().from(schema.skillVersions)
      .where(and(
        eq(schema.skillVersions.skillId, id),
        eq(schema.skillVersions.id, versionId)
      ));

    if (targetVersion.length === 0) {
      return reply.code(404).send({ error: 'Version not found' });
    }

    // Get next version number
    const allVersions = await db.select().from(schema.skillVersions)
      .where(eq(schema.skillVersions.skillId, id))
      .orderBy(desc(schema.skillVersions.version));
    const nextVersion = (allVersions.length > 0 ? allVersions[0].version : 0) + 1;

    const now = new Date();

    // Create a new version entry that records this revert
    await db.insert(schema.skillVersions).values({
      id: nanoid(),
      skillId: id,
      version: nextVersion,
      instructions: targetVersion[0].instructions,
      changedBy: userId,
      changeNote: `Reverted to version ${targetVersion[0].version}`,
      createdAt: now,
    });

    // Update the skill's instructions
    await db.update(schema.skills).set({
      instructions: targetVersion[0].instructions,
      updatedAt: now,
    }).where(eq(schema.skills.id, id));

    const updated = await db.select().from(schema.skills).where(eq(schema.skills.id, id));
    return reply.send(serializeSkill(updated[0]));
  });

  // POST /api/skills/import — import a SKILL.md file
  fastify.post('/api/skills/import', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).user.id;
    const body = request.body as { content?: string; filename?: string };

    if (!body || !body.content) {
      return reply.code(400).send({ error: 'Missing content field' });
    }

    const parsed = parseSkillMarkdown(body.content);
    if (!parsed) {
      return reply.code(400).send({ error: 'Invalid SKILL.md format. Expected YAML frontmatter (---) with name field.' });
    }

    const db = getDrizzleDb();
    const now = new Date();
    const id = nanoid();

    await db.insert(schema.skills).values({
      id,
      name: parsed.name,
      description: parsed.description || '',
      instructions: parsed.instructions,
      toolHints: JSON.stringify(parsed.toolHints || []),
      triggers: JSON.stringify(parsed.triggers || []),
      userId,
      isGlobal: 0,
      enabled: 1,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.skillVersions).values({
      id: nanoid(),
      skillId: id,
      version: 1,
      instructions: parsed.instructions,
      changedBy: userId,
      changeNote: `Imported from ${body.filename || 'SKILL.md'}`,
      createdAt: now,
    });

    const created = await db.select().from(schema.skills).where(eq(schema.skills.id, id));
    return reply.code(201).send(serializeSkill(created[0]));
  });

  // GET /api/skills/:id/export — export a skill as SKILL.md
  fastify.get('/api/skills/:id/export', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const userId = (request as any).user.id;
    const userRole = (request as any).user.role;

    const db = getDrizzleDb();
    const rows = await db.select().from(schema.skills).where(eq(schema.skills.id, id));

    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Skill not found' });
    }

    const skill = rows[0];

    // Access control
    if (skill.userId !== userId && userRole !== 'admin' && !(skill.isGlobal === 1 && skill.enabled === 1)) {
      return reply.code(404).send({ error: 'Skill not found' });
    }

    const markdown = exportSkillMarkdown(skill);

    reply.header('Content-Type', 'text/markdown; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(skill.name)}.skill.md"`);
    return reply.send(markdown);
  });
}

// ── SKILL.md Parser ──────────────────────────────────────────────────────────

interface ParsedSkill {
  name: string;
  description?: string;
  instructions: string;
  toolHints?: string[];
  triggers?: string[];
}

function parseSkillMarkdown(content: string): ParsedSkill | null {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!frontmatterMatch) return null;

  const frontmatter = frontmatterMatch[1];
  const body = frontmatterMatch[2].trim();

  // Simple YAML parser for flat key-value + arrays
  const meta: Record<string, any> = {};
  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^(\w+)\s*:\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      // Handle YAML arrays: ["/summarize", "/tldr"]
      if (value.startsWith('[') && value.endsWith(']')) {
        try {
          meta[key] = JSON.parse(value.replace(/'/g, '"'));
        } catch {
          meta[key] = value;
        }
      } else {
        // Strip quotes
        meta[key] = value.replace(/^["']|["']$/g, '');
      }
    }
  }

  if (!meta.name) return null;

  return {
    name: meta.name,
    description: meta.description,
    instructions: body,
    toolHints: Array.isArray(meta.toolHints) ? meta.toolHints : undefined,
    triggers: Array.isArray(meta.triggers) ? meta.triggers : undefined,
  };
}

function exportSkillMarkdown(skill: schema.Skill): string {
  const toolHints = JSON.parse(skill.toolHints || '[]');
  const triggers = JSON.parse(skill.triggers || '[]');

  let frontmatter = `---\nname: "${skill.name}"`;
  if (skill.description) frontmatter += `\ndescription: "${skill.description}"`;
  if (triggers.length > 0) frontmatter += `\ntriggers: ${JSON.stringify(triggers)}`;
  if (toolHints.length > 0) frontmatter += `\ntoolHints: ${JSON.stringify(toolHints)}`;
  frontmatter += `\n---\n\n`;

  return frontmatter + skill.instructions;
}
