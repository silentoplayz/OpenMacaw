import OpenAI from 'openai';
import type { LLMProvider, Message, ToolDefinition, StreamDelta } from './provider.js';
import { getConfig } from '../config.js';
import { getDb, schema } from '../db/index.js';

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  models = [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4',
    'gpt-3.5-turbo',
  ];

  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.client) {
      const config = getConfig();
      const db = getDb();
      const settings = db.select(schema.settings as any).where().all() as any[];
      const apiKeySetting = settings.find((s: any) => s.key === 'OPENAI_API_KEY');
      const apiKey = apiKeySetting?.value || config.OPENAI_API_KEY;

      if (!apiKey) {
        throw new Error('OPENAI_API_KEY not configured');
      }
      this.client = new OpenAI({ apiKey });
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
                name: tc.name, // Correct name should already be prefixed in toolCalls string
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          };
        } catch (e) {
          console.error('[OpenAI] Failed to parse historical toolCalls:', e);
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

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      if (choice.delta.content) {
        onDelta({
          type: 'text_delta',
          content: choice.delta.content,
        });
      }

      if (choice.delta.tool_calls) {
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
        if (currentToolCall) {
          await onDelta({
            type: 'tool_use',
            toolCall: { ...currentToolCall },
          });
          currentToolCall = null;
        }

        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens || 0;
          outputTokens = chunk.usage.completion_tokens || 0;
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
