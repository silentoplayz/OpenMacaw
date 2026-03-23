import OpenAI from 'openai';
import type { LLMProvider, Message, ToolDefinition, StreamDelta } from './provider.js';
import { getConfig } from '../config.js';
import { getDb, schema } from '../db/index.js';

// ── Models that support format:"json" and structured tool calls ────────────────
const JSON_FORMAT_MODELS = ['qwen', 'llama3', 'llama-3', 'mistral', 'gemma', 'deepseek', 'qwen2'];
function supportsJsonFormat(model: string): boolean {
  const lower = model.toLowerCase();
  return JSON_FORMAT_MODELS.some(m => lower.includes(m));
}

// ── Hallucination Fingerprints ────────────────────────────────────────────────
// Phrases that signal the model is ROLEPLAYING tool use instead of using the tool.
const HALLUCINATION_PHRASES = [
  'i have listed',
  'i have read',
  'i have executed',
  'i have run',
  'i have completed',
  'here are the files',
  'here is the content',
  'here is the output',
  'the directory contains',
  'the file contains',
  'i ran the command',
  'i checked the',
  'as requested, here',
  'i searched for',
  'i found the following',
];

export function looksLikeHallucinatedAction(text: string): boolean {
  const lower = text.toLowerCase();
  return HALLUCINATION_PHRASES.some(phrase => lower.includes(phrase));
}

function extractToolCall(responseText: string) {
  const attemptParse = (str: string) => {
    try {
      const parsed = JSON.parse(str);
      if (parsed && typeof parsed.name === 'string' && typeof parsed.arguments === 'object') {
        return parsed;
      }
    } catch {}
    return null;
  };

  // 1. Try markdown-fenced JSON blocks first (most structured)
  const mdMatch = responseText.match(/```json\s*(\{.*?\})\s*```/s) || responseText.match(/```\s*(\{.*?\})\s*```/s);
  if (mdMatch && mdMatch[1]) {
    const res = attemptParse(mdMatch[1]);
    if (res) return res;
  }

  // 2. Aggressive inline scan: find ANY JSON object with "name" and "arguments" keys
  const inlineRegex = /\{[\s\S]*?"name"\s*:\s*".*?"[\s\S]*?"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/g;
  let match;
  while ((match = inlineRegex.exec(responseText)) !== null) {
    const res = attemptParse(match[0]);
    if (res) return res;
  }
  
  // 3. Fallback: entire string if it looks like JSON
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
    onDelta: (delta: StreamDelta) => void,
    signal?: AbortSignal
  ): Promise<{ inputTokens: number; outputTokens: number }> {
    const openaiMessages = messages.map((msg): OpenAI.Chat.ChatCompletionMessageParam => {
      if (msg.role === 'tool') {
        // ── Task 2: Tool Role Shim ────────────────────────────────────────
        // Ollama's OpenAI compat layer handles 'tool' role poorly — the LLM
        // doesn't see the result and repeats the same call (Amnesia Loop).
        // Convert to 'user' role, which every local model supports natively.
        const toolId = msg.toolCallId || 'unknown';
        // ── Task 3: Error Prefix ───────────────────────────────────────────
        // If the tool result contains an error, prefix it explicitly so the
        // LLM understands it failed and should try a different approach.
        const rawContent = msg.content || '';
        const looksLikeError = /error|exception|failed|not found|invalid|cannot|unable/i.test(rawContent);
        const prefixedContent = looksLikeError
          ? `SYSTEM ERROR: Tool call failed. ${rawContent}`
          : rawContent;
        return {
          role: 'user',
          content: `Tool Output [ID: ${toolId}]: ${prefixedContent}`,
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
          // ── Task 1: Correct Assistant Tool Call History ──────────────────
          // content MUST be null when tool_calls are present.
          // Sending the "I proposed..." text alongside tool_calls confuses
          // Qwen / local models and causes the Amnesia Loop.
          return {
            role: 'assistant',
            content: null,
            tool_calls: toolCalls.map((tc, idx) => ({
              // ── Task 2: Stable, matching ID ──────────────────────────────
              // Use the stored toolCallId. If multiple calls, suffix with idx.
              id: (msg.toolCallId || `call_${Date.now()}`) + (idx > 0 ? `_${idx}` : ''),
              type: 'function' as const,
              function: {
                // Use bare tool name — never the SERVERID__toolName encoding
                name: tc.name.includes('__') ? tc.name.split('__')[1] : tc.name,
                arguments: JSON.stringify(tc.arguments ?? {}),
              },
            })),
          } as any;
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

    // ── JSON Format Mode ─────────────────────────────────────────────────────
    // Enable only when tools are requested AND the last message is NOT a tool
    // result (Tool Output shim). After a tool result, the model should respond
    // in natural language to summarize — not be forced into JSON output.
    const lastUserMsg = openaiMessages.filter((m: any) => m.role === 'user').at(-1) as any;
    const lastMsgIsToolOutput = typeof lastUserMsg?.content === 'string' &&
      lastUserMsg.content.startsWith('Tool Output [ID:');
    const useJsonFormat = tools.length > 0 && supportsJsonFormat(model) && !lastMsgIsToolOutput;
    if (useJsonFormat) {
      console.log(`[Ollama] Enabling format:"json" for model: ${model}`);
    } else if (lastMsgIsToolOutput) {
      console.log(`[Ollama] Disabling format:"json" — last message is a tool result (summary mode).`);
    }

    // ── Context Window Debug Log ──────────────────────────────────────────
    console.log('[Ollama] Reconstructed History:',
      JSON.stringify(
        openaiMessages.map((m: any) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content.slice(0, 80) : m.content,
          tool_call_id: m.tool_call_id,
          has_tool_calls: !!(m.tool_calls?.length),
          tool_call_ids: m.tool_calls?.map((tc: any) => tc.id),
        })),
        null, 2
      )
    );

    const createParams: any = {
      model,
      messages: openaiMessages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      stream: true,
      ...(useJsonFormat ? { response_format: { type: 'json_object' } } : {}),
    };
    // ── API Call ──────────────────────────────────────────────────────────────
    let stream: AsyncIterable<any>;
    try {
      stream = await this.getClient().chat.completions.create(createParams, { signal }) as unknown as AsyncIterable<any>;
    } catch (apiErr: any) {
      const msg: string = apiErr?.message ?? String(apiErr);
      if (/does not support tools/i.test(msg) || /tool.*not.*support/i.test(msg)) {
        // Throw a typed error so the agent runtime can emit MODEL_NO_TOOLS to the UI
        const typedErr = new Error(
          `Model "${model}" does not support tool use. Switch to a tool-capable model (e.g. qwen2.5-coder, llama3.2, mistral) in Settings.`
        );
        (typedErr as any).code = 'MODEL_NO_TOOLS';
        throw typedErr;
      }
      throw apiErr;
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let currentToolCall: { id: string; name: string; input: Record<string, unknown> } | null = null;
    let fullText = '';
    // ── Task 1: Response Sanitizer Buffer ────────────────────────────────────
    // We accumulate ALL text before sending to the runtime. If the buffer
    // contains a JSON tool call pattern, we suppress surrounding text and
    // only fire the tool_use event — never letting hallucinated prose through.
    let suppressTextUntilEnd = false;

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      if (choice.delta?.content) {
        fullText += choice.delta.content;

        // ── Muzzle Middleware: detect JSON tool pattern mid-stream ──────────
        // If we spot the start of a tool call JSON in the accumulating buffer,
        // set the suppress flag so no more text is forwarded to the runtime.
        if (!suppressTextUntilEnd && fullText.includes('"name"') && fullText.includes('"arguments"')) {
          console.log('[Ollama] Muzzle: Detected tool-call pattern in stream — suppressing prose text.');
          suppressTextUntilEnd = true;
          // Signal the runtime to clear any text already sent
          onDelta({ type: 'clear_text' } as any);
        }

        if (!suppressTextUntilEnd) {
          onDelta({
            type: 'text_delta',
            content: choice.delta.content,
          });
        }
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
        console.log('[Ollama] Raw Response Text:', fullText.substring(0, 200));

        if (currentToolCall) {
          onDelta({
            type: 'tool_use',
            toolCall: { ...currentToolCall },
          });
          currentToolCall = null;
        } else if (fullText.trim()) {
          // ── Safety Net: Regex Parser Shim ────────────────────────────────
          // Final scan: if the full accumulated buffer contains a tool call
          // JSON not captured by the OpenAI SDK, extract and fire it now.
          const extracted = extractToolCall(fullText);
          if (extracted) {
             console.log('[Ollama] Safety Net Intercept: Found tool call in raw text via Regex.');
             
             // Match against valid tool names to fix missing prefixes
             const validTool = tools.find(t => t.name === extracted.name || t.name.endsWith(':' + extracted.name));
             const correctName = validTool ? validTool.name : extracted.name;

             // Clear text buffer so nothing is sent to the UI as a standard message
             onDelta({ type: 'clear_text' } as any);

             // Fire the tool_use event using the corrected name
             onDelta({
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
