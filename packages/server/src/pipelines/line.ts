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
        const response = await runAgentForPipelineAsync(this.record.sessionId, textMsg.text, undefined, sessionRecoveryFn);

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
