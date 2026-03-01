import { z } from 'zod';
import { FORCEFUL_SYSTEM_PROMPT } from './agent/prompts.js';

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default('./data/app.db'),
  DATA_DIR: z.string().default('./data'),
  AUTH_TOKEN: z.string().optional(),
  
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  
  DEFAULT_MODEL: z.string().default('claude-3-5-sonnet-20241022'),
  DEFAULT_PROVIDER: z.enum(['anthropic', 'openai', 'ollama']).default('anthropic'),
  
  MAX_STEPS: z.coerce.number().default(50),
  TEMPERATURE: z.coerce.number().default(1.0),
  
  SYSTEM_PROMPT: z.string().default(FORCEFUL_SYSTEM_PROMPT),
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
