import {
  Client,
  GatewayIntentBits,
  ChannelType,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  Events,
  type Guild,
  type TextChannel,
  type CategoryChannel,
  type Message,
  type ThreadChannel,
  type DMChannel,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { BaseMessagingAdapter } from '../adapter.js';
import type {
  ChannelInfo,
  MessageContent,
  MessageRef,
  IncomingMessage,
  IncomingCommand,
  QuestionRequest,
  QuestionResponse,
  PermissionRequest,
  PermissionDecision,
  MachineStatus,
} from '../types.js';
import type { Formatters } from '../types.js';
import {
  parseControlChannelMessage,
  parseProjectChannelMessage,
  isProjectChannel,
} from '../slack/commands.js';
import * as discordFormatters from './formatters.js';
import {
  formatControlHelp,
  formatProjectHelp,
  formatQuestion,
  formatUnknownCommand,
  formatMenu,
  formatWelcome,
} from './formatters.js';
import { classifyIntent } from '../intent.js';
import { truncateForDiscord, mrkdwnToDiscordMarkdown } from './markdown.js';
import { getLogger } from '../../utils/logger.js';

/** Levenshtein distance for command suggestions. */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function suggestCommands(input: string, validCommands: string[]): string[] {
  if (!input) return [];
  return validCommands
    .map((cmd) => ({ cmd, dist: levenshtein(input, cmd) }))
    .filter((c) => c.dist <= 2 || c.cmd.startsWith(input))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3)
    .map((c) => c.cmd);
}

export interface DiscordAdapterConfig {
  botToken: string;
  guildId: string;
  machineName: string;
  version?: string;
  categoryName?: string;
  spinnerEmoji?: string;
  permissionTimeoutMs?: number;
  questionTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const TYPING_INTERVAL_MS = 9_000; // Discord typing expires after 10s
const EMBED_COLOR = 0x1e90ff;

export class DiscordAdapter extends BaseMessagingAdapter {
  readonly machineName: string;
  readonly formatters: Formatters = discordFormatters;

  formatMarkdown(md: string): string {
    // Discord natively supports standard markdown — just pass through.
    // If the input was Slack mrkdwn, convert it.
    return md;
  }

  private client: Client | null = null;
  private guild: Guild | null = null;
  private category: CategoryChannel | null = null;

  // Pending interaction trackers
  private pendingQuestions = new Map<string, { resolver: (response: QuestionResponse) => void; channelId: string }>();
  private pendingPermissions = new Map<string, (decision: PermissionDecision) => void>();

  // Machine registry
  private registryChannelId: string | null = null;
  private heartbeatMessageId: string | null = null;

  // Track DM users who have already received a welcome message
  private seenDmUsers = new Set<string>();

  // Typing indicator intervals per thread
  private typingIntervals = new Map<string, ReturnType<typeof setInterval>>();

  private readonly config: DiscordAdapterConfig;

  constructor(config: DiscordAdapterConfig) {
    super();
    this.config = config;
    this.machineName = config.machineName;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
      ],
    });

    this.registerEventHandlers();

    await this.client.login(this.config.botToken);

    // Resolve guild
    this.guild = await this.client.guilds.fetch(this.config.guildId);
    if (!this.guild) throw new Error(`Guild ${this.config.guildId} not found`);

    // Ensure category exists
    await this.ensureCategory();

    // Send startup welcome to DM
    await this.broadcastStartupWelcome();
  }

  async disconnect(): Promise<void> {
    // Clear all typing intervals
    for (const interval of this.typingIntervals.values()) {
      clearInterval(interval);
    }
    this.typingIntervals.clear();

    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.guild = null;
    this.category = null;
  }

  // ─── Channels ──────────────────────────────────────────────────────

  async createProjectChannel(machineName: string, projectName: string): Promise<ChannelInfo> {
    const name = this.projectChannelName(machineName, projectName);
    const channel = await this.requireGuild().channels.create({
      name,
      type: ChannelType.GuildText,
      parent: this.category ?? undefined,
    });
    return { id: channel.id, name: channel.name };
  }

  async archiveChannel(channelId: string): Promise<void> {
    const channel = await this.requireGuild().channels.fetch(channelId);
    if (channel) {
      await channel.delete('Project archived');
    }
  }

  async setChannelTopic(channelId: string, topic: string): Promise<void> {
    const channel = await this.requireGuild().channels.fetch(channelId);
    if (channel && channel.type === ChannelType.GuildText) {
      await (channel as TextChannel).setTopic(topic);
    }
  }

  // ─── Messages ──────────────────────────────────────────────────────

  async sendMessage(channelId: string, content: MessageContent): Promise<MessageRef> {
    const channel = await this.resolveTextChannel(channelId);
    const sendOptions = this.buildSendOptions(content);
    const msg = await channel.send(sendOptions);
    return { channelId, messageId: msg.id };
  }

  async sendThreadReply(channelId: string, threadId: string, content: MessageContent): Promise<MessageRef> {
    try {
      const thread = await this.resolveThread(channelId, threadId);
      const sendOptions = this.buildSendOptions(content);
      const msg = await thread.send(sendOptions);
      return { channelId, messageId: msg.id, threadId };
    } catch {
      // Thread resolution failed (e.g. DM context) — fall back to regular message
      return this.sendMessage(channelId, content);
    }
  }

  async updateMessage(ref: MessageRef, content: MessageContent): Promise<void> {
    try {
      const channel = ref.threadId
        ? await this.resolveThread(ref.channelId, ref.threadId)
        : await this.resolveTextChannel(ref.channelId);
      const msg = await channel.messages.fetch(ref.messageId);
      const editOptions = this.buildSendOptions(content);
      await msg.edit(editOptions);
    } catch {
      // Best-effort — message may have been deleted
    }
  }

  async deleteMessage(ref: MessageRef): Promise<void> {
    try {
      const channel = ref.threadId
        ? await this.resolveThread(ref.channelId, ref.threadId)
        : await this.resolveTextChannel(ref.channelId);
      const msg = await channel.messages.fetch(ref.messageId);
      await msg.delete();
    } catch {
      // Best-effort
    }
  }

  // ─── Interaction ──────────────────────────────────────────────────

  async askQuestion(channelId: string, threadId: string, question: QuestionRequest): Promise<QuestionResponse> {
    const requestId = `q_${this.machineName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timeout = question.timeout ?? this.config.questionTimeoutMs ?? DEFAULT_TIMEOUT_MS;

    const content = formatQuestion(question.question, question.choices, requestId);
    await this.sendToChannelOrThread(channelId, threadId, content);

    return new Promise<QuestionResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingQuestions.delete(requestId);
        resolve({ answer: '', wasFreeform: false, timedOut: true });
      }, timeout);

      this.pendingQuestions.set(requestId, {
        channelId,
        resolver: (response) => {
          clearTimeout(timer);
          this.pendingQuestions.delete(requestId);
          resolve(response);
        },
      });
    });
  }

  async askPermission(channelId: string, threadId: string, request: PermissionRequest): Promise<PermissionDecision> {
    const requestId = `p_${this.machineName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const { formatPermissionRequest } = await import('./formatters.js');

    const content = formatPermissionRequest(request.toolName, request.description, requestId, request.toolCategory);
    await this.sendToChannelOrThread(channelId, threadId, content);

    const permTimeout = this.config.permissionTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise<PermissionDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPermissions.delete(requestId);
        resolve('deny');
      }, permTimeout);

      this.pendingPermissions.set(requestId, (decision) => {
        clearTimeout(timer);
        this.pendingPermissions.delete(requestId);
        resolve(decision);
      });
    });
  }

  // ─── File uploads ──────────────────────────────────────────────────

  async sendFile(channelId: string, filePath: string, filename: string, initialComment?: string, threadId?: string): Promise<void> {
    const channel = threadId
      ? await this.resolveThread(channelId, threadId)
      : await this.resolveTextChannel(channelId);
    await channel.send({
      content: initialComment || undefined,
      files: [{ attachment: filePath, name: filename }],
    });
  }

  // ─── File downloads ──────────────────────────────────────────────

  async downloadFile(url: string, destPath: string): Promise<void> {
    // Discord CDN URLs are public — no auth needed
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      throw new Error(`Failed to download file: ${res.status} ${res.statusText}`);
    }
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    const fileStream = fs.createWriteStream(destPath);
    await pipeline(Readable.fromWeb(res.body as any), fileStream);
  }

  // ─── Thread status ──────────────────────────────────────────────

  async setThreadStatus(channelId: string, threadId: string, status: string, _loadingMessages?: string[]): Promise<void> {
    const key = `${channelId}:${threadId}`;

    // Clear existing typing interval
    const existing = this.typingIntervals.get(key);
    if (existing) {
      clearInterval(existing);
      this.typingIntervals.delete(key);
    }

    if (!status) return; // Empty status = stop typing

    try {
      const channel = threadId
        ? await this.resolveThread(channelId, threadId)
        : await this.resolveTextChannel(channelId);

      // Send typing immediately and then every 9s
      await channel.sendTyping();
      const interval = setInterval(async () => {
        try {
          await channel.sendTyping();
        } catch {
          clearInterval(interval);
          this.typingIntervals.delete(key);
        }
      }, TYPING_INTERVAL_MS);
      this.typingIntervals.set(key, interval);
    } catch {
      // Non-critical
    }
  }

  // ─── Presence ──────────────────────────────────────────────────

  async reportPresence(): Promise<void> {
    if (!this.client?.user) return;
    try {
      this.client.user.setPresence({
        status: 'online',
        activities: [{
          name: `${this.machineName} · Air Traffic`,
          type: 4, // Custom
        }],
      });
    } catch {
      // Non-critical
    }
  }

  async reportStatus(_status: MachineStatus): Promise<void> {
    // No-op — status is reported via DM responses
  }

  // ─── Machine registry ──────────────────────────────────────────

  async registerMachine(status: MachineStatus): Promise<void> {
    try {
      const channelId = await this.ensureRegistryChannel();
      const channel = await this.resolveTextChannel(channelId);
      const marker = `\`atc:${status.machineName}\``;
      const projectList = status.projects.length > 0 ? status.projects.join(', ') : 'none';
      const text = [
        marker,
        `🖥️ **${status.machineName}** 🟢 online`,
        `Sessions: ${status.activeSessions}`,
        `Projects: ${projectList}`,
        `Last seen: ${status.lastSeen.toISOString()}`,
      ].join('\n');

      // Try to update existing heartbeat message
      if (this.heartbeatMessageId) {
        try {
          const msg = await channel.messages.fetch(this.heartbeatMessageId);
          await msg.edit(text);
          return;
        } catch {
          this.heartbeatMessageId = null;
        }
      }

      // Search for existing message
      const messages = await channel.messages.fetch({ limit: 50 });
      const existing = messages.find((m) => m.content.includes(marker));
      if (existing) {
        this.heartbeatMessageId = existing.id;
        await existing.edit(text);
      } else {
        const posted = await channel.send(text);
        this.heartbeatMessageId = posted.id;
      }
    } catch {
      // Best-effort
    }
  }

  async getRegisteredMachines(): Promise<MachineStatus[]> {
    try {
      const channelId = await this.ensureRegistryChannel();
      const channel = await this.resolveTextChannel(channelId);
      const messages = await channel.messages.fetch({ limit: 50 });

      const machines: MachineStatus[] = [];
      for (const [, msg] of messages) {
        const nameMatch = msg.content.match(/`atc:([^`]+)`/);
        if (!nameMatch) continue;

        const name = nameMatch[1];
        const lastSeenMatch = msg.content.match(/Last seen: (.+)/);
        const sessionsMatch = msg.content.match(/Sessions: (\d+)/);
        const projectsMatch = msg.content.match(/Projects: (.+)/);

        const lastSeen = lastSeenMatch ? new Date(lastSeenMatch[1]) : new Date(0);
        const staleThreshold = 3 * 60_000;
        const isOnline = Date.now() - lastSeen.getTime() < staleThreshold;

        machines.push({
          machineName: name,
          online: isOnline,
          activeSessions: sessionsMatch ? parseInt(sessionsMatch[1], 10) : 0,
          projects: projectsMatch && projectsMatch[1] !== 'none' ? projectsMatch[1].split(', ') : [],
          lastSeen,
        });
      }
      return machines;
    } catch {
      return [];
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────

  private requireGuild(): Guild {
    if (!this.guild) throw new Error('DiscordAdapter not connected');
    return this.guild;
  }

  private async resolveTextChannel(channelId: string): Promise<TextChannel | DMChannel> {
    // Try client-level fetch first — works for both DMs and guild channels
    try {
      const channel = await this.client!.channels.fetch(channelId);
      if (channel) {
        if (channel.type === ChannelType.DM) return channel as DMChannel;
        if (channel.type === ChannelType.GuildText || channel.type === ChannelType.PublicThread || channel.type === ChannelType.PrivateThread) {
          return channel as TextChannel;
        }
      }
    } catch {
      // Fall through
    }
    throw new Error(`Channel ${channelId} not found`);
  }

  private async resolveThread(channelId: string, threadId: string): Promise<ThreadChannel> {
    const guild = this.requireGuild();
    // threadId IS the thread channel ID in Discord
    const thread = await guild.channels.fetch(threadId);
    if (thread && (thread.type === ChannelType.PublicThread || thread.type === ChannelType.PrivateThread)) {
      return thread as ThreadChannel;
    }
    // threadId might be a message ID — try to fetch from parent channel
    const parentChannel = await guild.channels.fetch(channelId) as TextChannel;
    const existingThread = parentChannel.threads.cache.get(threadId);
    if (existingThread) return existingThread;

    // Try to create a thread from the message
    const msg = await parentChannel.messages.fetch(threadId);
    const newThread = await msg.startThread({ name: 'Copilot Session' });
    return newThread;
  }

  private async ensureCategory(): Promise<void> {
    const guild = this.requireGuild();
    const categoryName = this.config.categoryName ?? 'Air Traffic';

    // Search existing
    const existing = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === categoryName,
    ) as CategoryChannel | undefined;

    if (existing) {
      this.category = existing;
      return;
    }

    // Create
    this.category = await guild.channels.create({
      name: categoryName,
      type: ChannelType.GuildCategory,
    }) as CategoryChannel;
  }

  private async ensureRegistryChannel(): Promise<string> {
    if (this.registryChannelId) return this.registryChannelId;

    const guild = this.requireGuild();
    const channelName = 'atc-machines';

    // Search existing
    const existing = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === channelName,
    ) as TextChannel | undefined;

    if (existing) {
      this.registryChannelId = existing.id;
      return this.registryChannelId;
    }

    // Create under category
    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: this.category ?? undefined,
      topic: 'Air Traffic machine registry — do not delete',
    });
    this.registryChannelId = channel.id;
    return this.registryChannelId;
  }

  private async broadcastStartupWelcome(): Promise<void> {
    const log = getLogger();
    try {
      // Find the bot's first DM channel (owner)
      if (!this.client?.user) return;
      const owner = await this.requireGuild().fetchOwner();
      if (!owner) return;

      const dm = await owner.createDM();
      this.seenDmUsers.add(owner.id);
      await dm.send(this.buildSendOptions(formatWelcome(this.machineName, this.config.version)));
      log.info('Sent startup welcome to guild owner DM');
    } catch (err) {
      log.warn('Failed to send startup welcome', { error: err });
    }
  }

  private async sendToChannelOrThread(channelId: string, threadId: string | undefined, content: MessageContent): Promise<MessageRef> {
    // In DMs, threadId is often set to channelId (no real threads) — send as regular message
    if (threadId && threadId !== channelId) {
      return this.sendThreadReply(channelId, threadId, content);
    }
    return this.sendMessage(channelId, content);
  }

  // ─── Build Discord message payloads from MessageContent ────────

  private buildSendOptions(content: MessageContent): Record<string, unknown> {
    const options: Record<string, unknown> = {};
    const embeds: EmbedBuilder[] = [];
    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

    const text = truncateForDiscord(content.text);
    options.content = text;

    if (content.blocks && Array.isArray(content.blocks)) {
      for (const block of content.blocks as Array<Record<string, unknown>>) {
        if (block.type === 'discord_embed') {
          const embed = new EmbedBuilder().setColor(block.color as number ?? EMBED_COLOR);
          if (block.title) embed.setTitle(truncateForDiscord(block.title as string, 256));
          if (block.description) embed.setDescription(truncateForDiscord(block.description as string, 4096));
          if (block.footer) embed.setFooter({ text: block.footer as string });
          embeds.push(embed);
        } else if (block.type === 'discord_action_row') {
          const row = new ActionRowBuilder<ButtonBuilder>();
          const comps = block.components as Array<Record<string, string>>;
          for (const comp of comps) {
            const styleMap: Record<string, ButtonStyle> = {
              primary: ButtonStyle.Primary,
              secondary: ButtonStyle.Secondary,
              success: ButtonStyle.Success,
              danger: ButtonStyle.Danger,
            };
            const btn = new ButtonBuilder()
              .setCustomId(comp.customId)
              .setLabel(comp.label)
              .setStyle(styleMap[comp.style] ?? ButtonStyle.Secondary);
            row.addComponents(btn);
          }
          components.push(row);
        } else if (block.type === 'discord_select') {
          const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>();
          const opts = (block.options as Array<Record<string, string>>).slice(0, 25); // Discord limit
          const select = new StringSelectMenuBuilder()
            .setCustomId(`question_choice_${block.requestId}_0`)
            .setPlaceholder(block.placeholder as string ?? 'Choose an option…');
          for (const opt of opts) {
            select.addOptions({
              label: (opt.label || '').slice(0, 100),
              value: (opt.value || '').slice(0, 100),
              ...(opt.description ? { description: opt.description.slice(0, 100) } : {}),
            });
          }
          selectRow.addComponents(select);
          components.push(selectRow);
        }
        // Slack-native block types (section, context, actions) are silently skipped
      }
    }

    if (embeds.length > 0) {
      options.embeds = embeds;
      // If we have embeds, the content is redundant (embed carries the info)
      options.content = undefined;
    }
    if (components.length > 0) {
      options.components = components;
    }

    return options;
  }

  // ─── Event handlers ──────────────────────────────────────────────

  private registerEventHandlers(): void {
    if (!this.client) return;

    // Handle incoming messages
    this.client.on(Events.MessageCreate, async (message: Message) => {
      const log = getLogger();
      try {
        // Ignore bot messages
        if (message.author.bot) return;
        if (!message.content && message.attachments.size === 0) return;

        const isDm = message.channel.type === ChannelType.DM;
        const channelName = isDm ? 'dm' : ('name' in message.channel ? (message.channel.name ?? '') : '');
        const threadId = message.channel.isThread() ? message.channel.id : undefined;
        const channelId = isDm ? message.channel.id : (message.channel.isThread() ? (message.channel.parentId ?? message.channel.id) : message.channel.id);

        log.debug('Incoming message', { channel: channelId, channelName, text: message.content.slice(0, 50), user: message.author.id });

        // Map attachments to IncomingFile[]
        const files = Array.from(message.attachments.values()).map((a) => ({
          name: a.name,
          url: a.url,
          mimeType: a.contentType ?? undefined,
          size: a.size,
        }));

        const incoming: IncomingMessage = {
          channelId,
          channelName,
          threadId,
          userId: message.author.id,
          text: message.content,
          messageId: message.id,
          timestamp: message.createdAt,
          ...(files.length > 0 ? { files } : {}),
        };

        // Check for freeform replies to pending questions
        if (this.handlePossibleQuestionReply(incoming)) {
          return;
        }

        if (isDm) {
          // Strip ! prefix in DMs
          if (incoming.text.startsWith('!')) {
            incoming.text = incoming.text.slice(1);
          }

          // Welcome on first contact
          if (!this.seenDmUsers.has(message.author.id)) {
            this.seenDmUsers.add(message.author.id);
            const isCommand = parseControlChannelMessage(incoming.text) !== null || classifyIntent(incoming.text) !== null;
            if (!isCommand) {
              const dm = message.channel as DMChannel;
              await dm.send(this.buildSendOptions(formatWelcome(this.machineName, this.config.version)));
              await dm.send(this.buildSendOptions(formatMenu(this.machineName)));
            }
          }

          await this.handleControlMessage(incoming);
        } else if (channelName && isProjectChannel(channelName, this.machineName)) {
          await this.handleProjectMessage(incoming);
        }
      } catch (err) {
        log.error('Error handling message event', { error: err });
      }
    });

    // Handle button and select menu interactions
    this.client.on(Events.InteractionCreate, async (interaction) => {
      const log = getLogger();
      try {
        if (interaction.isButton()) {
          await this.handleButtonInteraction(interaction as ButtonInteraction);
        } else if (interaction.isStringSelectMenu()) {
          await this.handleSelectInteraction(interaction as StringSelectMenuInteraction);
        }
      } catch (err) {
        log.error('Error handling interaction', { error: err });
      }
    });
  }

  private async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;

    // Permission buttons
    if (customId.startsWith('perm_')) {
      await interaction.deferUpdate();

      let decision: PermissionDecision;
      let label: string;

      const requestId = customId.replace(/^perm_(allow|always|deny)_/, '');

      if (customId.startsWith('perm_always_')) {
        decision = 'always_allow';
        label = '✅ Always Allowed';
      } else if (customId.startsWith('perm_allow_')) {
        decision = 'allow';
        label = '✅ Allowed';
      } else {
        decision = 'deny';
        label = '❌ Denied';
      }

      // Update message to show decision, remove buttons
      try {
        await interaction.editReply({
          content: `${interaction.message.content ?? 'Permission request'} — ${label}`,
          components: [],
        });
      } catch {
        // Best-effort
      }

      const resolver = this.pendingPermissions.get(requestId);
      if (resolver) {
        resolver(decision);
      }
      return;
    }

    // Menu buttons
    if (customId.startsWith('menu_')) {
      await interaction.deferUpdate();
      const command = customId.replace('menu_', '');
      const channelId = interaction.channelId;
      const userId = interaction.user.id;

      const cmd: IncomingCommand = {
        command,
        args: [],
        rawText: command,
        channelId,
        channelName: '',
        userId,
        messageId: interaction.message.id,
      };
      await this.dispatchCommand(cmd);
      return;
    }

    // Project card buttons
    if (customId.startsWith('project_card_')) {
      await interaction.deferUpdate();

      const actionMap: Record<string, string> = {
        project_card_change_model: 'model',
        project_card_change_mode: 'mode',
        project_card_change_agent: 'agent',
        project_card_switch_branch: 'switch_branch',
        project_card_new_branch: 'new_branch',
      };

      // Extract action and project name from customId
      // Format: project_card_{action}_{projectName}
      let matchedAction: string | null = null;
      let projectName: string | null = null;
      for (const [prefix, action] of Object.entries(actionMap)) {
        if (customId.startsWith(prefix + '_')) {
          matchedAction = action;
          projectName = customId.slice(prefix.length + 1);
          break;
        }
      }
      if (!matchedAction || !projectName) return;

      const channelName = this.projectChannelName(this.machineName, projectName);
      const cmd: IncomingCommand = {
        command: matchedAction,
        args: [],
        rawText: `!${matchedAction}`,
        channelId: interaction.channelId,
        channelName,
        userId: interaction.user.id,
        messageId: interaction.message.id,
      };
      await this.dispatchCommand(cmd);
      return;
    }
  }

  private async handleSelectInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
    const customId = interaction.customId;

    // Question select
    if (customId.startsWith('question_choice_')) {
      await interaction.deferUpdate();

      // Extract requestId: question_choice_{requestId}_{index}
      const prefix = 'question_choice_';
      const suffix = customId.slice(prefix.length);
      const lastUnderscore = suffix.lastIndexOf('_');
      const requestId = suffix.slice(0, lastUnderscore);

      const answer = interaction.values[0] ?? '';
      if (!answer) return;

      // Update message to show chosen answer
      const displayAnswer = answer.length > 80 ? answer.slice(0, 77) + '…' : answer;
      try {
        await interaction.editReply({
          content: `${interaction.message.content ?? 'Question'} — 💬 Answered: ${displayAnswer}`,
          components: [],
        });
      } catch {
        // Best-effort
      }

      const pending = this.pendingQuestions.get(requestId);
      if (pending) {
        pending.resolver({ answer, wasFreeform: false, timedOut: false });
      }
    }
  }

  private handlePossibleQuestionReply(msg: IncomingMessage): boolean {
    for (const [requestId, pending] of this.pendingQuestions) {
      if (pending.channelId === msg.channelId && requestId.includes(`_${this.machineName}_`)) {
        pending.resolver({ answer: msg.text, wasFreeform: true, timedOut: false });
        return true;
      }
    }
    return false;
  }

  private async handleControlMessage(msg: IncomingMessage): Promise<void> {
    const parsed = parseControlChannelMessage(msg.text);
    if (parsed) {
      const cmd: IncomingCommand = {
        command: parsed.command,
        args: parsed.args,
        rawText: msg.text,
        channelId: msg.channelId,
        channelName: msg.channelName,
        threadId: msg.threadId,
        userId: msg.userId,
        messageId: msg.messageId,
      };
      await this.dispatchCommand(cmd);
      return;
    }

    // Try NL intent classification
    const intent = classifyIntent(msg.text);
    if (intent) {
      const cmd: IncomingCommand = {
        command: intent.command,
        args: intent.args,
        rawText: msg.text,
        channelId: msg.channelId,
        channelName: msg.channelName,
        threadId: msg.threadId,
        userId: msg.userId,
        messageId: msg.messageId,
      };
      await this.dispatchCommand(cmd);
      return;
    }

    // No match — show suggestions
    const controlCommands = ['create', 'delete', 'list', 'config', 'status', 'models', 'sessions', 'join', 'menu', 'help'];
    const firstWord = msg.text.split(/\s+/)[0]?.toLowerCase() ?? '';

    // Send to the DM channel directly
    try {
      const channel = await this.client!.channels.fetch(msg.channelId);
      if (channel && 'send' in channel) {
        await (channel as TextChannel | DMChannel).send(
          this.buildSendOptions(formatUnknownCommand(firstWord, suggestCommands(firstWord, controlCommands))),
        );
      }
    } catch {
      // Best-effort
    }
  }

  private async handleProjectMessage(msg: IncomingMessage): Promise<void> {
    const parsed = parseProjectChannelMessage(msg.text);
    if (parsed) {
      const cmd: IncomingCommand = {
        command: parsed.command,
        args: parsed.args,
        rawText: msg.text,
        channelId: msg.channelId,
        channelName: msg.channelName,
        threadId: msg.threadId,
        userId: msg.userId,
        messageId: msg.messageId,
      };
      await this.dispatchCommand(cmd);
    } else if (msg.text.startsWith('!')) {
      // Unknown ! command
      const projectCommands = ['model', 'status', 'abort', 'diff', 'agent', 'mode', 'history', 'sessions', 'join', 'leave', 'help'];
      const attempted = msg.text.slice(1).split(/\s+/)[0]?.toLowerCase() ?? '';
      await this.sendMessage(msg.channelId, formatUnknownCommand(attempted, suggestCommands(attempted, projectCommands)));
    } else {
      // Regular text — treat as prompt
      await this.dispatchMessage(msg);
    }
  }
}
