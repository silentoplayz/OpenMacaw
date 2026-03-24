import type { LLMProvider, ChatOptions, ProviderType, Message, ToolDefinition, StreamDelta, ToolCall } from './provider.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { OllamaProvider } from './ollama.js';
import { getConfig } from '../config.js';
import { getDb, schema } from '../db/index.js';

const providers: Map<ProviderType, LLMProvider> = new Map();

export function getProvider(type?: ProviderType): LLMProvider {
  const config = getConfig();
  let providerType = type;

  if (!providerType) {
    try {
      const db = getDb();
      const settings = db.select(schema.settings as any).where().all() as any[];
      const defaultProviderSetting = settings.find((s: any) => s.key === 'DEFAULT_PROVIDER');
      if (defaultProviderSetting?.value) {
        providerType = defaultProviderSetting.value as ProviderType;
      }
    } catch (e) {
      // Ignore if DB is not initialized yet
    }
  }

  providerType = providerType || (config.DEFAULT_PROVIDER as ProviderType);

  if (providers.has(providerType)) {
    return providers.get(providerType)!;
  }

  let provider: LLMProvider;

  switch (providerType) {
    case 'anthropic':
      provider = new AnthropicProvider();
      break;
    case 'openai':
      provider = new OpenAIProvider();
      break;
    case 'ollama':
      provider = new OllamaProvider();
      break;
    default:
      throw new Error(`Unknown provider: ${providerType}`);
  }

  providers.set(providerType, provider);
  return provider;
}

export function getAvailableProviders(): ProviderType[] {
  return ['anthropic', 'openai', 'ollama'];
}

export function getProviderForModel(modelName: string): LLMProvider {
  // First try naive string matching to properly route the model
  const lowerModel = modelName.toLowerCase();
  
  if (lowerModel.includes('claude')) {
    return getProvider('anthropic');
  }
  
  if (lowerModel.includes('gpt') || lowerModel.includes('o1') || lowerModel.includes('o3')) {
    return getProvider('openai');
  }
  
  const ollamaModels = ['llama', 'mistral', 'qwen', 'gemma', 'phi', 'deepseek'];
  if (ollamaModels.some(m => lowerModel.includes(m))) {
    return getProvider('ollama');
  }

  // If we can't guess from the model name, fallback to the user's DB default
  try {
    const db = getDb();
    const settings = db.select(schema.settings as any).where().all() as any[];
    const defaultProviderSetting = settings.find((s: any) => s.key === 'DEFAULT_PROVIDER');
    if (defaultProviderSetting?.value) {
      return getProvider(defaultProviderSetting.value as ProviderType);
    }
  } catch (e) {
    // Ignore if DB is not initialized yet
  }
  
  // Final fallback to process.env default
  return getProvider();
}

export { type LLMProvider, type ChatOptions, type Message, type ToolDefinition, type StreamDelta, type ToolCall };
