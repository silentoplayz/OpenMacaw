import { createHmac } from 'crypto';
import type { PipelineRecord, LineConfig } from './types.js';
import { runAgentForPipelineAsync, splitMessage } from './runner.js';
import { createSession } from '../agent/session.js';
import { updatePipeline } from './manager.js';

// ── LINE Webhook event types (subset used here) ───────────────────────────────

type LineTextMessage = {
  type: 'text';
  id: string;
  text: string;
};

type LineMessageEvent = {
  type: 'message';
  replyToken: string;
  source: { userId?: string; roomId?: string; groupId?: string; type: string };
  message: LineTextMessage | { type: string };
};

type LineWebhookBody = {
  destination: string;
  events: LineMessageEvent[];
};

// ── LINE API helpers ──────────────────────────────────────────────────────────

async function lineReplyAsync(
  channelAccessToken: string,
  replyToken: string,
  messages: { type: 'text'; text: string }[]
): Promise<void> {
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE reply failed (${res.status}): ${body}`);
  }
}

/**
 * Show LINE's built-in loading animation in a 1-on-1 DM chat.
 * Only works when chatId is a userId (not a groupId / roomId).
 * The animation lasts `loadingSeconds` (5–60) and auto-clears when the bot
 * sends a reply. Silently ignored on failure (e.g. group chats).
 */
async function lineShowLoadingAsync(
  channelAccessToken: string,
  chatId: string,
  loadingSeconds = 20,
): Promise<void> {
  await fetch('https://api.line.me/v2/bot/chat/loading/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({ chatId, loadingSeconds }),
  }).catch(() => undefined); // silently ignore — loading animation is best-effort
}

// ── LinePipeline ──────────────────────────────────────────────────────────────

export class LinePipeline {
  private record: PipelineRecord;

  constructor(record: PipelineRecord) {
    this.record = record;
  }

  /** Validates the X-Line-Signature header against the raw request body. */
  validateSignature(rawBody: string, signature: string): boolean {
    const cfg = this.record.config as LineConfig;
    const hash = createHmac('sha256', cfg.channelSecret)
      .update(rawBody)
      .digest('base64');
    return hash === signature;
  }

  /**
   * Handle an inbound webhook payload. Called by the Fastify route handler
   * after signature validation. Returns the number of events processed.
   */
  async handleWebhookAsync(rawBody: string, signature: string): Promise<{ processed: number; error?: string }> {
    if (!this.validateSignature(rawBody, signature)) {
      return { processed: 0, error: 'Invalid signature' };
    }

    if (!this.record.sessionId) {
      return { processed: 0, error: 'No session assigned to this pipeline' };
    }

    const cfg = this.record.config as LineConfig;
    const body = JSON.parse(rawBody) as LineWebhookBody;
    let processed = 0;

    for (const event of body.events) {
      if (event.type !== 'message') continue;
      if (event.message.type !== 'text') continue;

      const textMsg = event.message as LineTextMessage;

      try {
        const sessionRecoveryFn = async (): Promise<string | null> => {
          try {
            const newSession = createSession({ title: `${this.record.name} Conversation` });
            updatePipeline(this.record.id, { sessionId: newSession.id });
            return newSession.id;
          } catch { return null; }
        };

        // ── Loading animation (1-on-1 DMs only) ────────────────────────────
        // LINE's loading animation API requires a userId as chatId.
        // It is not supported in group or room contexts.
        const userId = event.source.type === 'user' ? event.source.userId : undefined;
        if (userId) {
          await lineShowLoadingAsync(cfg.channelAccessToken, userId);
        }

        // Refresh the loading animation on each tool call so long-running
        // agent runs keep showing the indicator throughout.
        const onToolCallStart = userId
          ? (): void => { lineShowLoadingAsync(cfg.channelAccessToken, userId); }
          : undefined;

        const response = await runAgentForPipelineAsync(
          this.record.sessionId,
          textMsg.text,
          undefined,
          sessionRecoveryFn,
          onToolCallStart,
        );

        if (response) {
          // LINE allows up to 5 reply messages per replyToken, each max 5000 chars
          const chunks = splitMessage(response, 4999).slice(0, 5);
          const messages = chunks.map((text) => ({ type: 'text' as const, text }));
          await lineReplyAsync(cfg.channelAccessToken, event.replyToken, messages);
        }

        processed++;
      } catch (err) {
        console.error(`[LINE Pipeline: ${this.record.name}] Error processing event:`, err);
        await lineReplyAsync(cfg.channelAccessToken, event.replyToken, [
          { type: 'text', text: 'An error occurred while processing your message.' },
        ]).catch(() => undefined);
      }
    }

    return { processed };
  }

  /** LINE uses push-model webhooks — no persistent connection needed. */
  async startAsync(): Promise<void> {
    const cfg = this.record.config as LineConfig;
    if (!cfg.channelAccessToken) throw new Error('LINE pipeline requires a channelAccessToken');
    if (!cfg.channelSecret) throw new Error('LINE pipeline requires a channelSecret');
    if (!this.record.sessionId) throw new Error('LINE pipeline requires an assigned session');
    console.log(`[LINE Pipeline: ${this.record.name}] Ready — webhook endpoint active`);
  }

  async stopAsync(): Promise<void> {
    console.log(`[LINE Pipeline: ${this.record.name}] Stopped`);
  }

  getId(): string {
    return this.record.id;
  }
}
