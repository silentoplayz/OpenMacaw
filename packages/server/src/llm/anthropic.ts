import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, Message, ToolDefinition, StreamDelta } from './provider.js';
import { getConfig } from '../config.js';
import { getDb, schema } from '../db/index.js';

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  models = [
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-haiku-20240307',
  ];

  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (!this.client) {
      const config = getConfig();
      const db = getDb();
      const settings = db.select(schema.settings as any).where().all() as any[];
      const apiKeySetting = settings.find((s: any) => s.key === 'ANTHROPIC_API_KEY');
      const apiKey = apiKeySetting?.value || config.ANTHROPIC_API_KEY;
      
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY not configured');
      }
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  async chat(
    model: string,
    messages: Message[],
    tools: ToolDefinition[],
    onDelta: (delta: StreamDelta) => void
  ): Promise<{ inputTokens: number; outputTokens: number }> {
    const systemMessage = messages.find(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    const anthropicMessages = nonSystemMessages.map((msg): Anthropic.MessageParam => {
      if (msg.role === 'tool') {
        return {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId || 'unknown',
              content: msg.content,
            }
          ]
        };
      }
      if (msg.role === 'assistant' && msg.toolCalls) {
        try {
          const parsed = JSON.parse(msg.toolCalls);
          const toolCalls = Array.isArray(parsed) ? parsed : [parsed];
          const content: any[] = [];
          
          if (msg.content) {
            content.push({ type: 'text', text: msg.content });
          }

          for (const tc of toolCalls) {
            content.push({
              type: 'tool_use',
              id: msg.toolCallId || `call_${Date.now()}`,
              name: tc.name,
              input: tc.arguments as any,
            });
          }

          return { role: 'assistant', content };
        } catch (e) {
          console.error('[Anthropic] Failed to parse historical toolCalls:', e);
        }
      }
      return {
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      };
    });

    const toolUse: Anthropic.Tool[] = tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties: (tool.inputSchema as any)?.properties || {},
      },
    }));

    let inputTokens = 0;
    let outputTokens = 0;

    const stream = this.getClient().messages.stream({
      model,
      max_tokens: 4096,
      system: systemMessage?.content,
      messages: anthropicMessages,
      tools: toolUse.length > 0 ? toolUse : undefined,
    });

    let currentToolCall: { id: string; name: string; input: Record<string, unknown> } | null = null;
    let currentToolInputBuffer = '';

    for await (const chunk of stream) {
      if (chunk.type === 'message_start') {
        inputTokens = chunk.message.usage.input_tokens;
      } else if (chunk.type === 'content_block_start') {
        if (chunk.content_block.type === 'tool_use') {
          currentToolCall = {
            id: chunk.content_block.id,
            name: chunk.content_block.name,
            input: {},
          };
          currentToolInputBuffer = '';
        }
      } else if (chunk.type === 'content_block_delta') {
        if (chunk.delta.type === 'text_delta') {
          onDelta({
            type: 'text_delta',
            content: chunk.delta.text,
          });
        } else if (chunk.delta.type === 'input_json_delta') {
          if (currentToolCall) {
            // Accumulate partial JSON — do NOT parse each chunk individually
            currentToolInputBuffer += chunk.delta.partial_json;
          }
        }
      } else if (chunk.type === 'content_block_stop') {
        if (currentToolCall) {
          // Parse the fully accumulated JSON input
          try {
            if (currentToolInputBuffer.trim()) {
              currentToolCall.input = JSON.parse(currentToolInputBuffer);
            }
          } catch (e) {
            console.error('[Anthropic] Failed to parse tool input JSON:', currentToolInputBuffer, e);
          }
          onDelta({
            type: 'tool_use',
            toolCall: { ...currentToolCall },
          });
          currentToolCall = null;
          currentToolInputBuffer = '';
        }
      } else if (chunk.type === 'message_delta') {
        outputTokens = chunk.usage.output_tokens;
        if (chunk.delta.stop_reason) {
          onDelta({
            type: 'message_end',
            usage: { inputTokens, outputTokens },
          });
        }
      }
    }

    return { inputTokens, outputTokens };
  }
}
