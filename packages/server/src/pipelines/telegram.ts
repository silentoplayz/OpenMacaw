import TelegramBot from 'node-telegram-bot-api';
import type { PipelineRecord, TelegramConfig } from './types.js';
import { runAgentForPipelineAsync, splitMessage } from './runner.js';

export class TelegramPipeline {
  private record: PipelineRecord;
  private bot: TelegramBot | null = null;

  constructor(record: PipelineRecord) {
    this.record = record;
  }

  async startAsync(): Promise<void> {
    const cfg = this.record.config as TelegramConfig;
    if (!cfg.botToken) throw new Error('Telegram pipeline requires a botToken');
    if (!this.record.sessionId) throw new Error('Telegram pipeline requires an assigned session');

    const sessionId = this.record.sessionId;
    const allowedChatIds = cfg.allowedChatIds ?? [];

    this.bot = new TelegramBot(cfg.botToken, { polling: true });

    this.bot.on('message', async (msg) => {
      if (!msg.text) return;

      const chatId = String(msg.chat.id);
      if (allowedChatIds.length > 0 && !allowedChatIds.includes(chatId)) return;

      try {
        const response = await runAgentForPipelineAsync(sessionId, msg.text);
        if (response) {
          // Telegram hard limit is 4096 characters per message
          for (const chunk of splitMessage(response, 4000)) {
            await this.bot!.sendMessage(msg.chat.id, chunk);
          }
        }
      } catch (err) {
        console.error(`[Telegram Pipeline: ${this.record.name}] Error processing message:`, err);
        await this.bot!.sendMessage(msg.chat.id, 'An error occurred while processing your message.')
          .catch(() => undefined);
      }
    });

    console.log(`[Telegram Pipeline: ${this.record.name}] Started with long-polling`);
  }

  async stopAsync(): Promise<void> {
    if (this.bot) {
      await this.bot.stopPolling({ cancel: true });
      this.bot = null;
      console.log(`[Telegram Pipeline: ${this.record.name}] Stopped`);
    }
  }

  getId(): string {
    return this.record.id;
  }
}
