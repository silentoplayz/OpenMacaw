import {
  ActivityType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Partials,
  type Message,
} from 'discord.js';
import type { PipelineRecord, DiscordConfig } from './types.js';
import { runAgentForPipelineAsync, splitMessage, type ApprovalFn } from './runner.js';
import { createSession } from '../agent/session.js';
import { updatePipeline } from './manager.js';

/** How long (ms) to wait for a reaction before denying automatically. */
const APPROVAL_TIMEOUT_MS = 60_000;

/**
 * Returns true when a string looks like a raw JSON dump (object or array).
 * Used to suppress accidental JSON walls in Discord chat.
 */
function looksLikeJson(text: string): boolean {
  const t = text.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

/** Emoji used for approve / deny reactions. */
const APPROVE_EMOJI = '✅';
const DENY_EMOJI = '❌';

export class DiscordPipeline {
  private record: PipelineRecord;
  private client: Client | null = null;

  constructor(record: PipelineRecord) {
    this.record = record;
  }

  async startAsync(): Promise<void> {
    const cfg = this.record.config as DiscordConfig;
    if (!cfg.botToken) throw new Error('Discord pipeline requires a botToken');
    if (!this.record.sessionId) throw new Error('Discord pipeline requires an assigned session');

    const sessionId = this.record.sessionId;
    const channelId = cfg.channelId;
    const pipelineName = this.record.name;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions, // needed for awaitReactions
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
      ],
      // Required for DM support and reaction collection in Discord.js v14
      partials: [Partials.Channel, Partials.Message, Partials.Reaction],
    });

    const pipelineId = this.record.id;

    this.client.on('messageCreate', (message: Message) => {
      if (message.author.bot) return;
      if (channelId && message.channelId !== channelId) return;

      const content = message.content.trim();
      if (!content) {
        console.warn(
          `[Discord Pipeline: ${pipelineName}] Empty message.content — ` +
          `enable the "Message Content Intent" privileged gateway intent in the Discord Developer Portal.`
        );
        message.reply(
          'I received your message but could not read its content. ' +
          'Please ask the bot owner to enable the **Message Content Intent** in the Discord Developer Portal.'
        ).catch((err) => console.error(`[Discord Pipeline: ${pipelineName}] Failed to send intent warning:`, err));
        return;
      }

      this.handleMessageAsync(message, content, sessionId, pipelineName, pipelineId).catch((err) => {
        console.error(`[Discord Pipeline: ${pipelineName}] Unhandled error in message handler:`, err);
      });
    });

    this.client.once('ready', (c) => {
      console.log(`[Discord Pipeline: ${pipelineName}] Logged in as ${c.user.tag}`);
    });

    this.client.on('error', (err) => {
      console.error(`[Discord Pipeline: ${pipelineName}] Client error:`, err);
    });

    await this.client.login(cfg.botToken);
  }

  // ── Per-message approval gate ─────────────────────────────────────────────

  /**
   * Returns an ApprovalFn bound to a specific Discord message.
   * Each tool call in the agent run for that message gets its own embed with
   * ✅ / ❌ reactions. Only the original message author can react.
   */
  private makeApprovalFn(originalMessage: Message, pipelineName: string): ApprovalFn {
    return async ({ serverId, toolName, input }) => {
      const inputStr = JSON.stringify(input, null, 2);
      // Keep input preview under Discord's embed field limit (1024 chars)
      const inputPreview = inputStr.length > 900
        ? inputStr.slice(0, 900) + '\n…(truncated)'
        : inputStr;

      const embed = new EmbedBuilder()
        .setColor(0xf59e0b) // amber
        .setTitle('Tool approval required')
        .addFields(
          { name: 'Tool', value: `\`${toolName}\``, inline: true },
          { name: 'Server', value: `\`${serverId}\``, inline: true },
          { name: 'Input', value: `\`\`\`json\n${inputPreview}\`\`\`` }
        )
        .setFooter({ text: `React ${APPROVE_EMOJI} to approve or ${DENY_EMOJI} to deny — expires in ${APPROVAL_TIMEOUT_MS / 1000}s` });

      let approvalMsg: Message;
      try {
        approvalMsg = await originalMessage.reply({ embeds: [embed] });
        await approvalMsg.react(APPROVE_EMOJI);
        await approvalMsg.react(DENY_EMOJI);
      } catch (err) {
        console.error(`[Discord Pipeline: ${pipelineName}] Failed to send approval embed:`, err);
        // Can't ask — deny by default
        return false;
      }

      try {
        const collected = await approvalMsg.awaitReactions({
          filter: (reaction, user) =>
            [APPROVE_EMOJI, DENY_EMOJI].includes(reaction.emoji.name ?? '') &&
            user.id === originalMessage.author.id &&
            !user.bot,
          max: 1,
          time: APPROVAL_TIMEOUT_MS,
          errors: ['time'],
        });

        const approved = collected.first()?.emoji.name === APPROVE_EMOJI;

        await approvalMsg.edit({
          content: approved ? `${APPROVE_EMOJI} Approved — executing \`${toolName}\`…` : `${DENY_EMOJI} Denied.`,
          embeds: [],
        }).catch(() => undefined);

        return approved;
      } catch {
        // awaitReactions throws on timeout
        await approvalMsg.edit({
          content: `⏰ No response in ${APPROVAL_TIMEOUT_MS / 1000}s — tool call denied.`,
          embeds: [],
        }).catch(() => undefined);
        return false;
      }
    };
  }

  // ── Message handler ───────────────────────────────────────────────────────

  private async handleMessageAsync(
    message: Message,
    content: string,
    sessionId: string,
    pipelineName: string,
    pipelineId: string,
  ): Promise<void> {
    console.log(`[Discord Pipeline: ${pipelineName}] Message from ${message.author.tag}: ${content.substring(0, 80)}`);

    // ── Task 3: Thinking status ───────────────────────────────────────────────
    this.client?.user?.setPresence({
      activities: [{ name: 'Thinking…', type: ActivityType.Watching }],
      status: 'online',
    });

    const approvalFn = this.makeApprovalFn(message, pipelineName);

    // Session recovery: if the conversation was deleted from the web UI while
    // the bot was waiting for a reaction, recreate it so the chat can continue.
    const sessionRecoveryFn = async (): Promise<string | null> => {
      try {
        const newSession = createSession({ title: `${pipelineName} Conversation` });
        updatePipeline(pipelineId, { sessionId: newSession.id });
        console.log(`[Discord Pipeline: ${pipelineName}] Recreated session ${newSession.id}`);
        return newSession.id;
      } catch (err) {
        console.error(`[Discord Pipeline: ${pipelineName}] Session recovery failed:`, err);
        return null;
      }
    };

    let response: string;
    try {
      response = await runAgentForPipelineAsync(sessionId, content, approvalFn, sessionRecoveryFn);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Discord Pipeline: ${pipelineName}] Agent error:`, errMsg);
      await message.reply(`An error occurred: ${errMsg}`).catch((replyErr) =>
        console.error(`[Discord Pipeline: ${pipelineName}] Failed to send error reply:`, replyErr)
      );
      return;
    } finally {
      // ── Task 3: Restore idle presence when done (success or error) ───────────
      this.client?.user?.setPresence({ activities: [], status: 'idle' });
    }

    if (!response) {
      console.warn(`[Discord Pipeline: ${pipelineName}] Agent returned empty response for: "${content.substring(0, 80)}"`);
      await message.reply('I processed your message but have no response to send.')
        .catch((err) => console.error(`[Discord Pipeline: ${pipelineName}] Failed to send empty-response notice:`, err));
      return;
    }

    // ── Task 2: Iron Curtain — suppress raw JSON walls ────────────────────────
    // If the entire agent response is a raw JSON object/array, do NOT post it
    // as plain text. Show a tidy suppression embed instead.
    if (looksLikeJson(response)) {
      console.warn(`[Discord Pipeline: ${pipelineName}] Iron Curtain: suppressing raw JSON response (${response.length} chars)`);
      const suppressEmbed = new EmbedBuilder()
        .setColor(0x6b7280) // slate-grey
        .setTitle('ℹ️ Structured response suppressed')
        .setDescription('The agent returned a structured data payload that is not suitable for display in chat.');
      await message.reply({ embeds: [suppressEmbed] }).catch((err) =>
        console.error(`[Discord Pipeline: ${pipelineName}] Failed to send suppression embed:`, err)
      );
      return;
    }

    console.log(`[Discord Pipeline: ${pipelineName}] Sending ${response.length} char response`);
    for (const chunk of splitMessage(response, 1990)) {
      await message.reply(chunk).catch((err) =>
        console.error(`[Discord Pipeline: ${pipelineName}] Failed to send reply chunk:`, err)
      );
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async stopAsync(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      console.log(`[Discord Pipeline: ${this.record.name}] Disconnected`);
    }
  }

  getId(): string {
    return this.record.id;
  }
}
