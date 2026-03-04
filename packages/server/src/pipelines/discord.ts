import {
  ActivityType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ApplicationIntegrationType,
  InteractionContextType,
  type Message,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { nanoid } from 'nanoid';
import type { PipelineRecord, DiscordConfig } from './types.js';
import {
  runWithBatchApprovalAsync,
  runAgenticTaskAsync,
  splitMessage,
  type PendingApproval,
  type BatchApprovalSendFn,
  type AgenticApprovalFn,
  type AgenticCheckpointFn,
  type Proposal,
} from './runner.js';
import { createSession } from '../agent/session.js';
import { updatePipeline } from './manager.js';
import { getDb, schema } from '../db/index.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const APPROVAL_TIMEOUT_MS = 60_000;

// Custom-ID prefixes — everything after the prefix IS the nanoid approvalId.
const BATCH_APPROVE_PREFIX    = 'batch_approve_';
const BATCH_DENY_PREFIX       = 'batch_deny_';
const AGENT_APPROVE_PREFIX    = 'agent_approve_';
const AGENT_DENY_PREFIX       = 'agent_deny_';
const CHECKPOINT_CONFIRM_PREFIX = 'checkpoint_confirm_';
const CHECKPOINT_CANCEL_PREFIX  = 'checkpoint_cancel_';
const CHECKPOINT_SELECT_PREFIX  = 'agent_checkpoint_';

const ALL_APPROVE_PREFIXES = [BATCH_APPROVE_PREFIX, AGENT_APPROVE_PREFIX, CHECKPOINT_CONFIRM_PREFIX] as const;
const ALL_DENY_PREFIXES    = [BATCH_DENY_PREFIX,    AGENT_DENY_PREFIX,    CHECKPOINT_CANCEL_PREFIX]  as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true when a string looks like a raw JSON dump (object or array).
 * Used to suppress accidental JSON walls in Discord chat.
 */
function looksLikeJson(text: string): boolean {
  const t = text.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

/**
 * Extracts the approvalId and approved/denied verdict from a button custom_id.
 * Returns null if the custom_id doesn't match any known prefix.
 */
function extractButtonApproval(customId: string): { approvalId: string; approved: boolean } | null {
  for (const prefix of ALL_APPROVE_PREFIXES) {
    if (customId.startsWith(prefix)) return { approvalId: customId.slice(prefix.length), approved: true };
  }
  for (const prefix of ALL_DENY_PREFIXES) {
    if (customId.startsWith(prefix)) return { approvalId: customId.slice(prefix.length), approved: false };
  }
  return null;
}

/** Build a compact tool-input preview, capped for Discord embed field limits. */
function inputPreview(input: Record<string, unknown>, maxLen = 400): string {
  const s = JSON.stringify(input, null, 2);
  return s.length > maxLen ? s.slice(0, maxLen) + '\n…(truncated)' : s;
}

// ── DiscordPipeline ───────────────────────────────────────────────────────────

export class DiscordPipeline {
  private record: PipelineRecord;
  private client: Client | null = null;

  /**
   * All button / select interactions are routed through this map.
   * Key = nanoid(12) approvalId embedded in the component custom_id.
   * Created by `runWithBatchApprovalAsync` (batch) or `handleAgentCommandAsync`
   * (plan / checkpoint).  Resolved by the `interactionCreate` button handler.
   */
  private readonly pendingApprovals = new Map<string, PendingApproval>();

  constructor(record: PipelineRecord) {
    this.record = record;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async startAsync(): Promise<void> {
    const cfg = this.record.config as DiscordConfig;
    if (!cfg.botToken) throw new Error('Discord pipeline requires a botToken');
    if (!this.record.sessionId) throw new Error('Discord pipeline requires an assigned session');

    const channelId   = cfg.channelId;
    const pipelineName = this.record.name;
    const pipelineId   = this.record.id;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
      ],
      partials: [Partials.Channel, Partials.Message, Partials.Reaction],
    });

    // ── interactionCreate — three branches (order matters) ────────────────────
    this.client.on('interactionCreate', async (interaction) => {
      try {
        // Branch 1: StringSelectMenu for checkpoint step selection.
        // Use deferUpdate() to acknowledge without changing the message, then
        // mutate pending.checkpointStepIdx.  The Approve button reads it later.
        if (
          interaction.isStringSelectMenu() &&
          interaction.customId.startsWith(CHECKPOINT_SELECT_PREFIX)
        ) {
          const approvalId = interaction.customId.slice(CHECKPOINT_SELECT_PREFIX.length);
          const pending = this.pendingApprovals.get(approvalId);
          if (pending) {
            if (interaction.user.id !== pending.authorId) {
              await interaction.reply({ content: 'This menu belongs to someone else.', ephemeral: true });
              return;
            }
            await interaction.deferUpdate();
            const raw = interaction.values[0];
            pending.checkpointStepIdx = raw !== undefined ? parseInt(raw, 10) : undefined;
          }
          return;
        }

        // Branch 2: Button interactions — Approve / Deny / Confirm / Cancel.
        if (interaction.isButton()) {
          const match = extractButtonApproval(interaction.customId);
          if (!match) return; // not one of our buttons

          const { approvalId, approved } = match;
          const pending = this.pendingApprovals.get(approvalId);
          if (!pending) return; // already resolved or timed out

          if (interaction.user.id !== pending.authorId) {
            await interaction.reply({ content: 'This button belongs to someone else.', ephemeral: true });
            return;
          }

          // Remove from map BEFORE resolving to prevent double-resolution.
          this.pendingApprovals.delete(approvalId);

          // Disable all components on this message immediately.
          await interaction.update({ components: [] }).catch(() => undefined);

          pending.resolve({ approved, checkpointStepIdx: pending.checkpointStepIdx });
          return;
        }

        // Branch 3: slash commands.
        if (interaction.isChatInputCommand()) {
          if (interaction.commandName === 'agent') {
            this.handleAgentCommandAsync(
              interaction as ChatInputCommandInteraction,
              pipelineName,
              pipelineId,
            ).catch((err) => {
              console.error(`[Discord Pipeline: ${pipelineName}] /agent error:`, err);
            });
          } else if (interaction.commandName === 'clear') {
            this.handleClearCommandAsync(
              interaction as ChatInputCommandInteraction,
              pipelineName,
            ).catch((err) => {
              console.error(`[Discord Pipeline: ${pipelineName}] /clear error:`, err);
            });
          }
          return;
        }
      } catch (err) {
        console.error(`[Discord Pipeline: ${pipelineName}] interactionCreate error:`, err);
      }
    });

    // ── Regular message handler ───────────────────────────────────────────────
    this.client.on('messageCreate', (message: Message) => {
      if (message.author.bot) return;
      if (channelId && message.channelId !== channelId) return;

      const content = message.content.trim();
      if (!content) {
        console.warn(
          `[Discord Pipeline: ${pipelineName}] Empty message.content — ` +
          `enable the "Message Content Intent" in the Discord Developer Portal.`,
        );
        message.reply(
          'I received your message but could not read its content. ' +
          'Please ask the bot owner to enable the **Message Content Intent** in the Discord Developer Portal.',
        ).catch((err) => console.error(`[Discord Pipeline: ${pipelineName}] Failed to send intent warning:`, err));
        return;
      }

      this.handleMessageAsync(message, content, this.record.sessionId!, pipelineName, pipelineId).catch(
        (err) => console.error(`[Discord Pipeline: ${pipelineName}] Unhandled message error:`, err),
      );
    });

    // ── Ready + global command registration ───────────────────────────────────
    this.client.once('ready', async (c) => {
      console.log(`[Discord Pipeline: ${pipelineName}] Logged in as ${c.user.tag}`);
      try {
        const rest = new REST({ version: '10' }).setToken(cfg.botToken);

        const agentCommand = new SlashCommandBuilder()
          .setName('agent')
          .setDescription('Run an autonomous agentic task with plan review')
          .addStringOption((opt) =>
            opt
              .setName('goal')
              .setDescription('What should the agent accomplish?')
              .setRequired(true),
          )
          .addBooleanOption((opt) =>
            opt
              .setName('require_final_approval')
              .setDescription('Pause at a checkpoint to review actions before finishing?')
              .setRequired(false),
          )
          .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
          .setContexts([InteractionContextType.Guild]);

        const clearCommand = new SlashCommandBuilder()
          .setName('clear')
          .setDescription('Clear the conversation history for this pipeline (keeps the session)')
          .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
          .setContexts([InteractionContextType.Guild]);

        await rest.put(Routes.applicationCommands(c.user.id), {
          body: [agentCommand.toJSON(), clearCommand.toJSON()],
        });
        console.log(`[Discord Pipeline: ${pipelineName}] Registered global slash commands /agent, /clear`);
      } catch (err) {
        console.error(`[Discord Pipeline: ${pipelineName}] Failed to register /agent command:`, err);
      }
    });

    this.client.on('error', (err) => {
      console.error(`[Discord Pipeline: ${pipelineName}] Client error:`, err);
    });

    await this.client.login(cfg.botToken);
  }

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

  // ── Regular message handler ───────────────────────────────────────────────

  private async handleMessageAsync(
    message: Message,
    content: string,
    sessionId: string,
    pipelineName: string,
    pipelineId: string,
  ): Promise<void> {
    console.log(
      `[Discord Pipeline: ${pipelineName}] Message from ${message.author.tag}: ${content.substring(0, 80)}`,
    );

    // ── Typing indicator ──────────────────────────────────────────────────────
    const sendTyping = () => {
      if ('sendTyping' in message.channel) {
        (message.channel as any).sendTyping().catch(() => undefined);
      }
    };
    sendTyping();
    const typingInterval = setInterval(sendTyping, 8_000);

    this.client?.user?.setPresence({
      activities: [{ name: 'Thinking…', type: ActivityType.Watching }],
      status: 'online',
    });

    // ── Session recovery ──────────────────────────────────────────────────────
    const sessionRecoveryFn = async (): Promise<string | null> => {
      try {
        const newSession = createSession({ title: `${pipelineName} Conversation` });
        updatePipeline(pipelineId, { sessionId: newSession.id });
        this.record = { ...this.record, sessionId: newSession.id };
        console.log(`[Discord Pipeline: ${pipelineName}] Recreated session ${newSession.id}`);
        return newSession.id;
      } catch (err) {
        console.error(`[Discord Pipeline: ${pipelineName}] Session recovery failed:`, err);
        return null;
      }
    };

    // ── Tool activity indicator ───────────────────────────────────────────────
    const onToolCallStart = (tool: string, server: string): void => {
      sendTyping();
      this.client?.user?.setPresence({
        activities: [{ name: `Using ${tool} · ${server}`, type: ActivityType.Watching }],
        status: 'online',
      });
    };

    // ── Batch approval send function ──────────────────────────────────────────
    // Called by runWithBatchApprovalAsync once per approval round.
    // The approvalId is already registered in pendingApprovals before this is
    // called, so the button handler can resolve the promise.
    const sendFn: BatchApprovalSendFn = async (proposals: Proposal[], approvalId: string) => {
      const fields = proposals.slice(0, 10).map((p) => {
        const colonIdx = p.tool.indexOf(':');
        const toolName = colonIdx >= 0 ? p.tool.slice(colonIdx + 1) : p.tool;
        const serverId  = colonIdx >= 0 ? p.tool.slice(0, colonIdx)  : p.tool;
        return {
          name: `\`${toolName}\` — ${serverId}`,
          value: `\`\`\`json\n${inputPreview(p.input, 350)}\`\`\``,
        };
      });

      const embed = new EmbedBuilder()
        .setColor(0xf59e0b) // amber
        .setTitle(
          `Tool approval required — ${proposals.length} tool call${proposals.length === 1 ? '' : 's'}`,
        )
        .addFields(fields)
        .setFooter({ text: `Approve All or Deny All — expires in ${APPROVAL_TIMEOUT_MS / 1000}s` });

      const approveBtn = new ButtonBuilder()
        .setCustomId(`${BATCH_APPROVE_PREFIX}${approvalId}`)
        .setLabel('Approve All')
        .setStyle(ButtonStyle.Success);

      const denyBtn = new ButtonBuilder()
        .setCustomId(`${BATCH_DENY_PREFIX}${approvalId}`)
        .setLabel('Deny All')
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(approveBtn, denyBtn);
      await message.reply({ embeds: [embed], components: [row] });
    };

    let response: string;
    try {
      response = await runWithBatchApprovalAsync(
        sendFn,
        message.author.id,
        sessionId,
        content,
        pipelineName,
        this.pendingApprovals,
        sessionRecoveryFn,
        onToolCallStart,
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Discord Pipeline: ${pipelineName}] Agent error:`, errMsg);
      await message.reply(`An error occurred: ${errMsg}`).catch((replyErr) =>
        console.error(`[Discord Pipeline: ${pipelineName}] Failed to send error reply:`, replyErr),
      );
      return;
    } finally {
      clearInterval(typingInterval);
      this.client?.user?.setPresence({ activities: [], status: 'idle' });
    }

    if (!response) {
      console.warn(
        `[Discord Pipeline: ${pipelineName}] Agent returned empty response for: "${content.substring(0, 80)}"`,
      );
      await message.reply('I processed your message but have no response to send.').catch((err) =>
        console.error(`[Discord Pipeline: ${pipelineName}] Failed to send empty-response notice:`, err),
      );
      return;
    }

    // Iron Curtain: suppress raw JSON walls.
    if (looksLikeJson(response)) {
      console.warn(`[Discord Pipeline: ${pipelineName}] Iron Curtain: suppressing raw JSON response`);
      const suppressEmbed = new EmbedBuilder()
        .setColor(0x6b7280)
        .setTitle('ℹ️ Structured response suppressed')
        .setDescription(
          'The agent returned a structured data payload that is not suitable for display in chat.',
        );
      await message.reply({ embeds: [suppressEmbed] }).catch((err) =>
        console.error(`[Discord Pipeline: ${pipelineName}] Failed to send suppression embed:`, err),
      );
      return;
    }

    for (const chunk of splitMessage(response, 1990)) {
      await message.reply(chunk).catch((err) =>
        console.error(`[Discord Pipeline: ${pipelineName}] Failed to send reply chunk:`, err),
      );
    }
  }

  // ── /agent slash command handler ──────────────────────────────────────────

  private async handleAgentCommandAsync(
    interaction: ChatInputCommandInteraction,
    pipelineName: string,
    pipelineId: string,
  ): Promise<void> {
    // ── Defer immediately so Discord doesn't show "interaction failed" ────────
    await interaction.deferReply();

    const goal = interaction.options.getString('goal', true);
    const requireFinalApproval =
      interaction.options.getBoolean('require_final_approval') ?? false;
    const authorId = interaction.user.id;

    // Use the live sessionId (may have been updated by a previous recovery).
    const sessionId = this.record.sessionId;
    if (!sessionId) {
      await interaction.followUp('No session is configured for this pipeline.').catch(() => undefined);
      await interaction.deleteReply().catch(() => undefined);
      return;
    }

    console.log(
      `[Discord Pipeline: ${pipelineName}] /agent from ${interaction.user.tag}: ${goal.substring(0, 80)}`,
    );

    // ── Typing indicator controller ───────────────────────────────────────────
    // Discord's typing indicator expires after ~10 s, so we refresh every 8 s.
    // We PAUSE the indicator during approval/checkpoint waits (the bot is not
    // doing anything then — it's waiting for the user) and RESUME it when the
    // agent is actively working again.
    const sendTyping = (): void => {
      const ch = interaction.channel;
      if (ch && 'sendTyping' in ch) {
        (ch as any).sendTyping().catch(() => undefined);
      }
    };

    let typingTimer: ReturnType<typeof setInterval> | null = null;

    const startTyping = (): void => {
      sendTyping();
      if (typingTimer) clearInterval(typingTimer);
      typingTimer = setInterval(sendTyping, 8_000);
    };

    const stopTyping = (): void => {
      if (typingTimer) {
        clearInterval(typingTimer);
        typingTimer = null;
      }
    };

    // Start typing immediately — the first thing we do is call the LLM to
    // generate the plan, which can take several seconds.
    startTyping();

    // ── Session recovery ──────────────────────────────────────────────────────
    const sessionRecoveryFn = async (): Promise<string | null> => {
      try {
        const newSession = createSession({ title: `${pipelineName} Conversation` });
        updatePipeline(pipelineId, { sessionId: newSession.id });
        this.record = { ...this.record, sessionId: newSession.id };
        console.log(`[Discord Pipeline: ${pipelineName}] Recreated session ${newSession.id}`);
        return newSession.id;
      } catch (err) {
        console.error(`[Discord Pipeline: ${pipelineName}] Session recovery failed:`, err);
        return null;
      }
    };

    // ── Tool call presence + typing refresh ───────────────────────────────────
    const onToolCallStart = (tool: string, server: string): void => {
      // Nudge the typing indicator immediately on each tool call so it stays
      // visible even during long-running tools that exceed 10 s.
      sendTyping();
      this.client?.user?.setPresence({
        activities: [{ name: `Using ${tool} · ${server}`, type: ActivityType.Watching }],
        status: 'online',
      });
    };

    // ── Plan approval function ────────────────────────────────────────────────
    // Sends the plan embed as a followUp (visible below the deferred reply).
    // Registers a pendingApproval entry and awaits the user's button click.
    const planApprovalFn: AgenticApprovalFn = async (plan) => {
      const approvalId = nanoid(12);

      const stepList = plan
        .map(
          (s, i) =>
            `**${i + 1}.** ${s.description}${s.tool ? ` *(${s.tool})*` : ''}`,
        )
        .join('\n');

      const embed = new EmbedBuilder()
        .setColor(0x3b82f6) // blue
        .setTitle('Agentic Plan')
        .setDescription(`**Goal:** ${goal.slice(0, 400)}\n\n**Steps:**\n${stepList}`)
        .setFooter({
          text: requireFinalApproval
            ? 'Optionally select a checkpoint step, then click Approve & Run'
            : `Click Approve & Run to start — expires in ${APPROVAL_TIMEOUT_MS / 1000}s`,
        });

      const rows: ActionRowBuilder<any>[] = [];

      // Row 1 (optional): String Select for checkpoint — only shown when the
      // user asked for final approval AND there are at least 2 steps.
      if (requireFinalApproval && plan.length > 1) {
        const checkpointSelect = new StringSelectMenuBuilder()
          .setCustomId(`${CHECKPOINT_SELECT_PREFIX}${approvalId}`)
          .setPlaceholder('Select checkpoint step (optional)')
          .setMinValues(0)
          .setMaxValues(1)
          .addOptions(
            plan.map((s, i) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(`Step ${i + 1} — ${s.description.slice(0, 80)}`)
                .setValue(String(i)),
            ),
          );
        rows.push(
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(checkpointSelect),
        );
      }

      // Row 2: Approve & Run / Deny buttons.
      const approveBtn = new ButtonBuilder()
        .setCustomId(`${AGENT_APPROVE_PREFIX}${approvalId}`)
        .setLabel('Approve & Run')
        .setStyle(ButtonStyle.Success);

      const denyBtn = new ButtonBuilder()
        .setCustomId(`${AGENT_DENY_PREFIX}${approvalId}`)
        .setLabel('Deny')
        .setStyle(ButtonStyle.Danger);

      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(approveBtn, denyBtn));

      // Register BEFORE sending the message so the button handler never races.
      const approvalPromise = new Promise<{ approved: boolean; checkpointStepIdx?: number }>(
        (resolve) => {
          this.pendingApprovals.set(approvalId, { resolve, authorId });
        },
      );

      const timeoutId = setTimeout(() => {
        const pending = this.pendingApprovals.get(approvalId);
        if (pending) {
          this.pendingApprovals.delete(approvalId);
          console.warn(`[Discord Pipeline: ${pipelineName}] Plan approval timed out (${approvalId})`);
          pending.resolve({ approved: false });
        }
      }, APPROVAL_TIMEOUT_MS);

      // Stop typing while we wait for the user to read and click.
      stopTyping();
      await interaction.followUp({ embeds: [embed], components: rows });

      const result = await approvalPromise;
      clearTimeout(timeoutId);

      if (result.approved) {
        const cpText =
          result.checkpointStepIdx !== undefined
            ? ` (checkpoint after step ${result.checkpointStepIdx + 1})`
            : '';
        await interaction
          .followUp(`✅ Plan approved — running autonomously${cpText}…`)
          .catch(() => undefined);
        // Resume typing — execution is about to start.
        startTyping();
      }

      return result;
    };

    // ── Checkpoint review function ────────────────────────────────────────────
    // Called unconditionally after phase 1 completes (no MARKER tokens).
    // Sends a checkpoint embed as a followUp and awaits Confirm / Cancel.
    const onCheckpointFn: AgenticCheckpointFn = async (pendingActions, isEndOfPlan) => {
      const approvalId = nanoid(12);

      const actionsList =
        pendingActions
          .slice(0, 10)
          .map(
            (a) =>
              `• **${a.server}:${a.tool}** — \`${JSON.stringify(a.input).slice(0, 120)}\``,
          )
          .join('\n') || '_No tool actions recorded._';

      const embed = new EmbedBuilder()
        .setColor(0x8b5cf6) // purple
        .setTitle(isEndOfPlan ? 'Checkpoint — Plan Complete' : 'Checkpoint — Phase Complete')
        .setDescription(
          `The agent has completed ${isEndOfPlan ? 'all steps' : 'the first phase'}. ` +
          `Review the actions taken:\n\n${actionsList}`,
        )
        .setFooter({
          text: `${isEndOfPlan ? 'Confirm to finish' : 'Confirm to continue'} or Cancel to abort — expires in ${APPROVAL_TIMEOUT_MS / 1000}s`,
        });

      const confirmBtn = new ButtonBuilder()
        .setCustomId(`${CHECKPOINT_CONFIRM_PREFIX}${approvalId}`)
        .setLabel(isEndOfPlan ? 'Confirm & Finish' : 'Confirm & Continue')
        .setStyle(ButtonStyle.Success);

      const cancelBtn = new ButtonBuilder()
        .setCustomId(`${CHECKPOINT_CANCEL_PREFIX}${approvalId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn);

      const approvalPromise = new Promise<{ approved: boolean; checkpointStepIdx?: number }>(
        (resolve) => {
          this.pendingApprovals.set(approvalId, { resolve, authorId });
        },
      );

      const timeoutId = setTimeout(() => {
        const pending = this.pendingApprovals.get(approvalId);
        if (pending) {
          this.pendingApprovals.delete(approvalId);
          console.warn(`[Discord Pipeline: ${pipelineName}] Checkpoint timed out (${approvalId})`);
          pending.resolve({ approved: false });
        }
      }, APPROVAL_TIMEOUT_MS);

      // Stop typing while we wait for the user to review and confirm.
      stopTyping();
      await interaction.followUp({ embeds: [embed], components: [row] });

      const result = await approvalPromise;
      clearTimeout(timeoutId);

      if (result.approved) {
        await interaction
          .followUp(isEndOfPlan ? '✅ Confirmed — finishing up…' : '✅ Confirmed — continuing execution…')
          .catch(() => undefined);
        // Resume typing — phase 2 (or final summary generation) is starting.
        startTyping();
      }

      return result.approved;
    };

    // ── Run the agentic task ──────────────────────────────────────────────────
    this.client?.user?.setPresence({
      activities: [{ name: 'Planning…', type: ActivityType.Watching }],
      status: 'online',
    });

    try {
      const summary = await runAgenticTaskAsync(
        sessionId,
        goal,
        planApprovalFn,
        sessionRecoveryFn,
        undefined, // onProgress — not used for Discord (no web UI to update)
        onToolCallStart,
        requireFinalApproval,
        requireFinalApproval ? onCheckpointFn : undefined,
      );

      // Per the brief: delete the stale deferred "thinking…" reply first,
      // then followUp with the summary so it appears at the bottom where the
      // user is looking (not silently editing an off-screen message).
      await interaction.deleteReply().catch(() => undefined);

      const summaryText = summary || 'Task completed.';
      for (const chunk of splitMessage(summaryText, 1990)) {
        await interaction.followUp(chunk).catch(() => undefined);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Discord Pipeline: ${pipelineName}] /agent execution error:`, errMsg);
      await interaction.followUp(`An error occurred: ${errMsg}`).catch(() => undefined);
      await interaction.deleteReply().catch(() => undefined);
    } finally {
      stopTyping();
      this.client?.user?.setPresence({ activities: [], status: 'idle' });
    }
  }

  // ── /clear slash command handler ──────────────────────────────────────────

  private async handleClearCommandAsync(
    interaction: ChatInputCommandInteraction,
    pipelineName: string,
  ): Promise<void> {
    // Ephemeral so the confirmation is only visible to the user who ran /clear,
    // not broadcast to everyone in the channel.
    await interaction.deferReply({ ephemeral: true });

    const sessionId = this.record.sessionId;
    if (!sessionId) {
      await interaction.editReply('No session is configured for this pipeline.');
      return;
    }

    try {
      const db = getDb();
      db.delete(schema.messages as any).where(
        (col: (k: string) => unknown) => col('sessionId') === sessionId,
      );

      console.log(
        `[Discord Pipeline: ${pipelineName}] /clear — wiped messages for session ${sessionId}`,
      );

      await interaction.editReply('✅ Conversation history cleared.');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Discord Pipeline: ${pipelineName}] /clear failed:`, errMsg);
      await interaction.editReply(`Failed to clear history: ${errMsg}`).catch(() => undefined);
    }
  }
}
