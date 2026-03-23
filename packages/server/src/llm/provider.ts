export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  id?: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface StreamDelta {
  type: 'text_delta' | 'tool_use' | 'message_end' | 'error';
  content?: string;
  toolCall?: ToolCall;
  usage?: { inputTokens: number; outputTokens: number };
  error?: string;
}

export interface LLMProvider {
  name: string;
  models: string[];

  chat(
    model: string,
    messages: Message[],
    tools: ToolDefinition[],
    // Returning a Promise allows callers to await tool_use handling so that
    // approval gates (e.g. Discord reactions) complete before the provider
    // processes the next content block. For text_delta / message_end the
    // return value is ignored and void is fine.
    onDelta: (delta: StreamDelta) => void | Promise<void>,
    signal?: AbortSignal
  ): Promise<{ inputTokens: number; outputTokens: number }>;
}

export type ProviderType = 'anthropic' | 'openai' | 'ollama';
