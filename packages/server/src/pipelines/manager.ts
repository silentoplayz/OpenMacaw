import { nanoid } from 'nanoid';
import { getDb, schema } from '../db/index.js';
import { createSession, getSession } from '../agent/session.js';
import type { PipelineRecord, PipelineType, PipelineConfig, PipelineStatus } from './types.js';
import { DiscordPipeline } from './discord.js';
import { TelegramPipeline } from './telegram.js';
import { LinePipeline } from './line.js';

type AnyAdapter = DiscordPipeline | TelegramPipeline | LinePipeline;

// ── In-memory registry of running adapters ────────────────────────────────────
const runningAdapters = new Map<string, AnyAdapter>();

// ── DB helpers ────────────────────────────────────────────────────────────────

function rowToRecord(row: Record<string, unknown>): PipelineRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as PipelineType,
    enabled: Boolean(row.enabled),
    sessionId: (row.sessionId as string | null) ?? null,
    config: typeof row.config === 'string'
      ? (JSON.parse(row.config) as PipelineConfig)
      : (row.config as PipelineConfig),
    status: (row.status as PipelineStatus) ?? 'stopped',
    errorMessage: (row.errorMessage as string | undefined) ?? undefined,
    createdAt: new Date(row.createdAt as number),
    updatedAt: new Date(row.updatedAt as number),
  };
}

export function listPipelines(): PipelineRecord[] {
  const db = getDb();
  const rows = db.select(schema.pipelines as 'pipelines').where().all() as Record<string, unknown>[];
  return rows.map(rowToRecord);
}

export function getPipeline(id: string): PipelineRecord | null {
  const db = getDb();
  const rows = db
    .select(schema.pipelines as 'pipelines')
    .where((col) => col('id') === id)
    .all() as Record<string, unknown>[];
  return rows.length ? rowToRecord(rows[0]) : null;
}

export function createPipeline(data: {
  name: string;
  type: PipelineType;
  sessionId?: string;
  config: PipelineConfig;
}): PipelineRecord {
  const db = getDb();
  const now = Date.now();
  const id = nanoid();

  const row = {
    id,
    name: data.name,
    type: data.type,
    enabled: 1,
    sessionId: data.sessionId ?? null,
    config: JSON.stringify(data.config),
    status: 'stopped',
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(schema.pipelines as 'pipelines').values(row);
  return getPipeline(id) as PipelineRecord;
}

export function updatePipeline(
  id: string,
  updates: Partial<{
    name: string;
    sessionId: string;
    config: PipelineConfig;
    enabled: boolean;
  }>
): PipelineRecord | null {
  const db = getDb();
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.sessionId !== undefined) patch.sessionId = updates.sessionId;
  if (updates.config !== undefined) patch.config = JSON.stringify(updates.config);
  if (updates.enabled !== undefined) patch.enabled = updates.enabled ? 1 : 0;

  db.update(schema.pipelines as 'pipelines')
    .set(patch)
    .where((col) => col('id') === id);

  return getPipeline(id);
}

export function deletePipeline(id: string): void {
  const db = getDb();
  db.delete(schema.pipelines as 'pipelines').where((col) => col('id') === id);
}

function setPipelineStatus(id: string, status: PipelineStatus, errorMessage?: string): void {
  const db = getDb();
  db.update(schema.pipelines as 'pipelines')
    .set({ status, errorMessage: errorMessage ?? null, updatedAt: Date.now() })
    .where((col) => col('id') === id);
}

// ── Adapter factory ───────────────────────────────────────────────────────────

function createAdapter(record: PipelineRecord): AnyAdapter {
  switch (record.type) {
    case 'discord': return new DiscordPipeline(record);
    case 'telegram': return new TelegramPipeline(record);
    case 'line': return new LinePipeline(record);
    default: {
      const exhaustive: never = record.type;
      throw new Error(`Unknown pipeline type: ${exhaustive}`);
    }
  }
}

// ── Public lifecycle API ──────────────────────────────────────────────────────

export async function startPipelineAsync(id: string): Promise<void> {
  let record = getPipeline(id);
  if (!record) throw new Error(`Pipeline ${id} not found`);
  if (runningAdapters.has(id)) {
    console.log(`[PipelineManager] ${id} already running`);
    return;
  }

  // Auto-provision a dedicated session for non-Discord pipelines if one doesn't
  // exist yet.  Discord pipelines manage their own per-context sessions internally.
  if (record.type !== 'discord') {
    if (!record.sessionId || !getSession(record.sessionId)) {
      const session = createSession({ title: `${record.name} Conversation` });
      updatePipeline(id, { sessionId: session.id });
      record = getPipeline(id)!;
      console.log(`[PipelineManager] Auto-created session ${session.id} for pipeline "${record.name}"`);
    }
  }

  const adapter = createAdapter(record);
  try {
    await adapter.startAsync();
    runningAdapters.set(id, adapter);
    setPipelineStatus(id, 'running');
    console.log(`[PipelineManager] Pipeline ${record.name} (${record.type}) started`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setPipelineStatus(id, 'error', msg);
    throw err;
  }
}

export async function stopPipelineAsync(id: string): Promise<void> {
  const adapter = runningAdapters.get(id);
  if (!adapter) return;
  await adapter.stopAsync();
  runningAdapters.delete(id);
  setPipelineStatus(id, 'stopped');
  console.log(`[PipelineManager] Pipeline ${id} stopped`);
}

export async function restartPipelineAsync(id: string): Promise<void> {
  await stopPipelineAsync(id);
  await startPipelineAsync(id);
}

/** Called at server startup — auto-start all enabled pipelines. */
export async function restorePipelinesAsync(): Promise<void> {
  const pipelines = listPipelines();
  for (const p of pipelines) {
    if (p.enabled && p.status === 'running') {
      try {
        await startPipelineAsync(p.id);
      } catch (err) {
        console.error(`[PipelineManager] Failed to restore pipeline ${p.name}:`, err);
      }
    }
  }
}

/** Retrieve a running LINE adapter by pipeline ID for webhook dispatch. */
export function getLinePipeline(id: string): LinePipeline | null {
  const adapter = runningAdapters.get(id);
  if (adapter instanceof LinePipeline) return adapter;
  return null;
}

/** Retrieve a running Discord adapter by pipeline ID. */
export function getDiscordPipeline(id: string): DiscordPipeline | null {
  const adapter = runningAdapters.get(id);
  if (adapter instanceof DiscordPipeline) return adapter;
  return null;
}

export function isRunning(id: string): boolean {
  return runningAdapters.has(id);
}
