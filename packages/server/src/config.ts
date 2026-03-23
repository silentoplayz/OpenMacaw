import { z } from 'zod';
import { getDb } from './db/index.js';



const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default('./data/app.db'),
  DATA_DIR: z.string().default('./data'),
  AUTH_TOKEN: z.string().optional(),
  
  ENABLE_SIGNUP: z.coerce.boolean().default(true),
  DEFAULT_NEW_USER_ROLE: z.enum(['pending', 'user']).default('pending'),

  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),

  DEFAULT_MODEL: z.string().default('claude-sonnet-4-5-20250929'),
  DEFAULT_PROVIDER: z.enum(['anthropic', 'openai', 'ollama']).default('anthropic'),

  MAX_STEPS: z.coerce.number().default(50),
  TEMPERATURE: z.coerce.number().default(1.0),

  /**
   * Optional personality/style instructions supplied by the operator.
   * These are appended to the immutable base system prompt (`FORCEFUL_SYSTEM_PROMPT`)
   * and never replace it.  Store via PUT /api/settings/PERSONALITY.
   */
  PERSONALITY: z.string().default(''),
});

export type Config = z.infer<typeof configSchema>;

let configInstance: Config | null = null;

export function loadConfig(): Config {
  if (configInstance) {
    return configInstance;
  }

  configInstance = configSchema.parse(process.env);
  return configInstance;
}

export function getConfig(): Config {
  if (!configInstance) {
    return loadConfig();
  }
  return configInstance;
}

export function getActiveSettings(): Config {
  const config = getConfig();
  try {
    const db = getDb();
    const rows = db.select('settings').where().all() as { key: string; value: string }[];

    // Build an override map from every row saved in the DB
    const overrides: Record<string, string> = {};
    for (const row of rows) {
      if (row.value !== undefined && row.value !== '') {
        overrides[row.key] = row.value;
      }
    }

    // Parse the merged env+DB object through the same schema so coercions
    // (e.g. MAX_STEPS string → number) are applied correctly.
    return configSchema.parse({ ...process.env, ...overrides });
  } catch (e) {
    return config;
  }
}

/**
 * Returns raw key/value pairs from user_settings for a given user.
 * Used by the user settings API.
 */
export function getUserSettingsRaw(userId: string): Record<string, string> {
  try {
    const db = getDb();
    const rows = db.select('user_settings' as any)
      .where((col: (k: string) => any) => col('userId') === userId)
      .all() as { key: string; value: string }[];

    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Resolution cascade: User Settings → Global DB Settings → Environment Variables.
 * Used when running the agent for a specific user so their personal API keys
 * (BYOK) take priority over workspace defaults.
 */
export function getActiveSettingsForUser(userId: string): Config {
  const globalConfig = getActiveSettings();
  try {
    const userOverrides = getUserSettingsRaw(userId);
    if (Object.keys(userOverrides).length === 0) return globalConfig;

    // Merge: env → global DB → user-level (user wins)
    const db = getDb();
    const globalRows = db.select('settings').where().all() as { key: string; value: string }[];
    const globalOverrides: Record<string, string> = {};
    for (const row of globalRows) {
      if (row.value !== undefined && row.value !== '') {
        globalOverrides[row.key] = row.value;
      }
    }

    return configSchema.parse({ ...process.env, ...globalOverrides, ...userOverrides });
  } catch {
    return globalConfig;
  }
}

