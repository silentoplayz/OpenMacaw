export type PipelineType = 'discord' | 'telegram' | 'line';

export type PipelineStatus = 'running' | 'stopped' | 'error';

// ── Per-connector config shapes ───────────────────────────────────────────────

export type DiscordConfig = {
  botToken: string;
  /** If set, only respond in this specific channel */
  channelId?: string;
};

export type TelegramConfig = {
  botToken: string;
  /** Optional whitelist of chat IDs (as strings) that may message the bot */
  allowedChatIds?: string[];
};

export type LineConfig = {
  channelAccessToken: string;
  /** Used to validate inbound webhook HMAC-SHA256 signatures */
  channelSecret: string;
};

export type PipelineConfig = DiscordConfig | TelegramConfig | LineConfig;

// ── Persisted pipeline record ─────────────────────────────────────────────────

export interface PipelineRecord {
  id: string;
  name: string;
  type: PipelineType;
  enabled: boolean;
  /** ID of the shared session every message through this pipeline uses */
  sessionId: string | null;
  config: PipelineConfig;
  status: PipelineStatus;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}
