import OpenAI from 'openai';
import type { LLMProvider, Message, ToolDefinition, StreamDelta } from './provider.js';
import { getConfig } from '../config.js';
import { getDb, schema } from '../db/index.js';

function extractToolCall(responseText: string) {
  const match = responseText.match(/```json\s*(\{.*?\})\s*```/s) || responseText.match(/```\s*(\{.*?\})\s*```/s);

  const attemptParse = (str: string) => {
    try {
      const parsed = JSON.parse(str);
      if (parsed && typeof parsed.name === 'string' && typeof parsed.arguments === 'object') {
        return parsed;
      }
    } catch { }
    return null;
  };

  if (match && match[1]) {
    const res = attemptParse(match[1]);
    if (res) return res;
  }

  // Fallback: parse entire string if it resembles JSON
  const trimmed = responseText.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const res = attemptParse(trimmed);
    if (res) return res;
  }

  return null;
}

export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  models: string[] = []; // Models will be populated dynamically or via user input

  private client: OpenAI | null = null;
  private baseUrl: string;

  constructor() {
    const config = getConfig();
    try {
      const db = getDb();
      const settings = db.select(schema.settings as any).where().all() as any[];
      const urlSetting = settings.find((s: any) => s.key === 'OLLAMA_BASE_URL');
      this.baseUrl = urlSetting?.value || config.OLLAMA_BASE_URL;
    } catch {
      this.baseUrl = config.OLLAMA_BASE_URL;
    }
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        baseURL: `${this.baseUrl}/v1`,
        apiKey: 'ollama', // Ollama doesn't require an API key, but the SDK expects one.
      });
    }
    return this.client;
  }

  async chat(
    model: string,
    messages: Message[],
    tools: ToolDefinition[],
    onDelta: (delta: StreamDelta) => void | Promise<void>,
    signal?: AbortSignal
  ): Promise<{ inputTokens: number; outputTokens: number }> {
    const openaiMessages = messages.map((msg): OpenAI.Chat.ChatCompletionMessageParam => {
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.toolCallId || 'unknown',
        };
      }
      if (msg.role === 'system') {
        return {
          role: 'system',
          content: msg.content,
        };
      }
      if (msg.role === 'assistant' && msg.toolCalls) {
        try {
          const parsed = JSON.parse(msg.toolCalls);
          const toolCalls = Array.isArray(parsed) ? parsed : [parsed];
          return {
            role: 'assistant',
            content: msg.content,
            tool_calls: toolCalls.map(tc => ({
              id: tc.id || msg.toolCallId || 'call_unknown',
              type: 'function',
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          };
        } catch (e) {
          console.error('[Ollama] Failed to parse historical toolCalls:', e);
        }
      }
      return {
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      };
    });

    const openaiTools = tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));

    const stream = await this.getClient().chat.completions.create({
      model,
      messages: openaiMessages,
      tools: openaiTools.length > 0 ? openaiTools as any[] : undefined,
      stream: true,
    }, { signal });

    let inputTokens = 0;
    let outputTokens = 0;
    let currentToolCall: { id: string; name: string; input: Record<string, unknown> } | null = null;
    let fullText = '';

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      if (choice.delta?.content) {
        fullText += choice.delta.content;
        onDelta({
          type: 'text_delta',
          content: choice.delta.content,
        });
      }

      if (choice.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          if (!currentToolCall && tc.id && tc.function?.name) {
            currentToolCall = {
              id: tc.id,
              name: tc.function.name,
              input: {},
            };
          }
          if (currentToolCall && tc.function?.arguments) {
            try {
              const parsed = JSON.parse(tc.function.arguments);
              currentToolCall.input = { ...currentToolCall.input, ...parsed };
            } catch {
              // Accumulate partial JSON
            }
          }
        }
      }

      if (choice.finish_reason) {
        console.log('[Ollama] Raw Response Text:', fullText);

        if (currentToolCall) {
          await onDelta({
            type: 'tool_use',
            toolCall: { ...currentToolCall },
          });
          currentToolCall = null;
        } else if (fullText.trim()) {
          // Safety Net: The Regex Parser Shim
          const extracted = extractToolCall(fullText);
          if (extracted) {
            console.log('[Ollama] Safety Net Intercept: Found tool call in raw text via Regex.');

            // Match against valid tool names to fix missing prefixes (e.g. "list_directory" -> "server-filesystem:list_directory")
            const validTool = tools.find(t => t.name === extracted.name || t.name.endsWith(':' + extracted.name));
            const correctName = validTool ? validTool.name : extracted.name;

            // 1. Immediately clear the text buffer so nothing is sent to the UI as a standard message
            onDelta({ type: 'clear_text' } as any);

            // 2. Fire the tool_use event using the corrected name (awaited for sequential approval)
            await onDelta({
              type: 'tool_use',
              toolCall: {
                id: extracted.id || `call_${Date.now()}`,
                name: correctName,
                input: extracted.arguments || {}
              }
            });
          }
        }

        if ((chunk as any).usage) {
          inputTokens = Math.max(inputTokens, (chunk as any).usage.prompt_tokens || 0);
          outputTokens = Math.max(outputTokens, (chunk as any).usage.completion_tokens || 0);
        }

        onDelta({
          type: 'message_end',
          usage: { inputTokens, outputTokens },
        });
      }
    }

    return { inputTokens, outputTokens };
  }
}
