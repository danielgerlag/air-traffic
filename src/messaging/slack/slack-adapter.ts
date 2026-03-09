import { App, LogLevel } from '@slack/bolt';
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
import {
  parseControlChannelMessage,
  parseProjectChannelMessage,
  isProjectChannel,
  parseAnyProjectChannel,
  extractProjectName,
} from './commands.js';
import {
  formatPermissionRequest,
  formatQuestion,
  formatControlHelp,
  formatProjectHelp,
  formatUnknownCommand,
} from './formatters.js';
import { getLogger } from '../../utils/logger.js';

/** Simple Levenshtein-based command suggestion. */
function suggestCommands(input: string, validCommands: string[]): string[] {
  if (!input) return [];
  return validCommands
    .map((cmd) => ({ cmd, dist: levenshtein(input, cmd) }))
    .filter((c) => c.dist <= 2 || c.cmd.startsWith(input))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3)
    .map((c) => c.cmd);
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
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

export interface SlackAdapterConfig {
  botToken: string;
  appToken: string;
  signingSecret: string;
  machineName: string;
  permissionTimeoutMs?: number;
  questionTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export class SlackAdapter extends BaseMessagingAdapter {
  readonly machineName: string;

  private app: App | null = null;
  private botUserId: string | null = null;

  // Pending interaction trackers
  private pendingQuestions = new Map<string, { resolver: (response: QuestionResponse) => void; channelId: string }>();
  private pendingPermissions = new Map<string, (decision: PermissionDecision) => void>();

  // Machine registry
  private registryChannelId: string | null = null;
  private heartbeatMessageTs: string | null = null;

  private readonly config: SlackAdapterConfig;

  constructor(config: SlackAdapterConfig) {
    super();
    this.config = config;
    this.machineName = config.machineName;
  }

  async connect(): Promise<void> {
    this.app = new App({
      token: this.config.botToken,
      appToken: this.config.appToken,
      signingSecret: this.config.signingSecret,
      socketMode: true,
      logLevel: LogLevel.WARN,
    });

    this.registerEventHandlers();

    await this.app.start();

    // Resolve bot user ID
    const authResult = await this.app.client.auth.test({ token: this.config.botToken });
    this.botUserId = (authResult.user_id as string) ?? null;

    this.startForwardPolling();
  }

  async disconnect(): Promise<void> {
    this.stopForwardPolling();
    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
  }

  // --- Channels ---

  async createProjectChannel(machineName: string, projectName: string): Promise<ChannelInfo> {
    const name = this.projectChannelName(machineName, projectName);
    const result = await this.client.conversations.create({ name, is_private: false });
    const channel = result.channel!;
    return { id: channel.id!, name: channel.name! };
  }

  async archiveChannel(channelId: string): Promise<void> {
    await this.client.conversations.archive({ channel: channelId });
  }

  async setChannelTopic(channelId: string, topic: string): Promise<void> {
    await this.client.conversations.setTopic({ channel: channelId, topic });
  }

  // --- Messages ---

  async sendMessage(channelId: string, content: MessageContent): Promise<MessageRef> {
    const result = await this.client.chat.postMessage({
      channel: channelId,
      text: content.text,
      ...(content.blocks ? { blocks: content.blocks as unknown as Record<string, unknown>[] } : {}),
    });
    return {
      channelId,
      messageId: result.ts!,
    };
  }

  async sendThreadReply(channelId: string, threadId: string, content: MessageContent): Promise<MessageRef> {
    const result = await this.client.chat.postMessage({
      channel: channelId,
      thread_ts: threadId,
      text: content.text,
      ...(content.blocks ? { blocks: content.blocks as unknown as Record<string, unknown>[] } : {}),
    });
    return {
      channelId,
      messageId: result.ts!,
      threadId,
    };
  }

  async updateMessage(ref: MessageRef, content: MessageContent): Promise<void> {
    await this.client.chat.update({
      channel: ref.channelId,
      ts: ref.messageId,
      text: content.text,
      ...(content.blocks ? { blocks: content.blocks as unknown as Record<string, unknown>[] } : {}),
    });
  }

  async deleteMessage(ref: MessageRef): Promise<void> {
    await this.client.chat.delete({
      channel: ref.channelId,
      ts: ref.messageId,
    });
  }

  // --- Interaction ---

  async askQuestion(channelId: string, threadId: string, question: QuestionRequest): Promise<QuestionResponse> {
    const requestId = `q_${this.machineName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timeout = question.timeout ?? this.config.questionTimeoutMs ?? DEFAULT_TIMEOUT_MS;

    const content = formatQuestion(question.question, question.choices, requestId);
    await this.sendMessage(channelId, content);

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

    const content = formatPermissionRequest(request.toolName, request.description, requestId, request.toolCategory);
    await this.sendMessage(channelId, content);

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

  // --- File uploads ---

  async sendFile(channelId: string, filePath: string, filename: string, initialComment?: string, threadId?: string): Promise<void> {
    const fileBuffer = await fs.promises.readFile(filePath);
    if (threadId) {
      await this.client.filesUploadV2({
        channel_id: channelId,
        thread_ts: threadId,
        filename,
        file: fileBuffer,
        initial_comment: initialComment,
      });
    } else {
      await this.client.filesUploadV2({
        channel_id: channelId,
        filename,
        file: fileBuffer,
        initial_comment: initialComment,
      });
    }
  }

  async downloadFile(url: string, destPath: string): Promise<void> {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.botToken}` },
    });
    if (!res.ok || !res.body) {
      throw new Error(`Failed to download file: ${res.status} ${res.statusText}`);
    }
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    const fileStream = fs.createWriteStream(destPath);
    await pipeline(Readable.fromWeb(res.body as any), fileStream);
  }

  // --- Thread status (AI assistant indicator) ---

  async setThreadStatus(channelId: string, threadId: string, status: string, loadingMessages?: string[]): Promise<void> {
    try {
      const payload: Record<string, unknown> = {
        channel_id: channelId,
        thread_ts: threadId,
        status,
      };
      if (loadingMessages && loadingMessages.length > 0) {
        payload.loading_messages = loadingMessages.slice(0, 10);
      }
      await this.client.apiCall('assistant.threads.setStatus', payload);
    } catch {
      // Silently ignore — status indicator is non-critical
    }
  }

  // --- Presence ---

  async reportPresence(): Promise<void> {
    // Set bot's Slack profile status to reflect availability
    const status = this.buildPresenceStatus();
    const statusText = `${status.machineName} · ${status.activeSessions} active sessions`;
    try {
      await this.client.users.profile.set({
        profile: {
          status_text: statusText,
          status_emoji: ':white_check_mark:',
        },
      });
    } catch {
      // Non-critical — presence is best-effort
    }
  }

  async reportStatus(status: MachineStatus): Promise<void> {
    // No-op — status is reported via DM responses now
  }

  // --- Machine registry (shared Slack channel) ---

  private async ensureRegistryChannel(): Promise<string> {
    if (this.registryChannelId) return this.registryChannelId;

    const channelName = 'atc-machines';

    // Search existing channels for the registry
    try {
      let cursor: string | undefined;
      do {
        const result = await this.client.conversations.list({
          types: 'public_channel',
          limit: 200,
          cursor,
          exclude_archived: true,
        });
        const found = result.channels?.find((c) => c.name === channelName);
        if (found) {
          this.registryChannelId = found.id!;
          try {
            await this.client.conversations.join({ channel: this.registryChannelId });
          } catch {
            // Already a member
          }
          return this.registryChannelId;
        }
        cursor = result.response_metadata?.next_cursor || undefined;
      } while (cursor);
    } catch {
      // Fall through to create
    }

    // Channel doesn't exist — create it
    const created = await this.client.conversations.create({ name: channelName, is_private: false });
    this.registryChannelId = created.channel!.id!;
    await this.client.conversations.setTopic({
      channel: this.registryChannelId,
      topic: 'Air Traffic machine registry — do not delete',
    });
    return this.registryChannelId;
  }

  async registerMachine(status: MachineStatus): Promise<void> {
    try {
      const channelId = await this.ensureRegistryChannel();
      const marker = `\`atc:${status.machineName}\``;
      const projectList = status.projects.length > 0 ? status.projects.join(', ') : 'none';
      const text = [
        marker,
        `🖥️ *${status.machineName}* 🟢 online`,
        `Sessions: ${status.activeSessions}`,
        `Projects: ${projectList}`,
        `Last seen: ${status.lastSeen.toISOString()}`,
      ].join('\n');

      // Try to update existing heartbeat message
      if (this.heartbeatMessageTs) {
        try {
          await this.client.chat.update({ channel: channelId, ts: this.heartbeatMessageTs, text });
          return;
        } catch {
          this.heartbeatMessageTs = null;
        }
      }

      // Search for an existing message from this machine
      const history = await this.client.conversations.history({ channel: channelId, limit: 50 });
      const existing = history.messages?.find((m) => m.text?.includes(marker));
      if (existing?.ts) {
        this.heartbeatMessageTs = existing.ts;
        await this.client.chat.update({ channel: channelId, ts: this.heartbeatMessageTs, text });
      } else {
        const posted = await this.client.chat.postMessage({ channel: channelId, text });
        this.heartbeatMessageTs = posted.ts!;
      }
    } catch {
      // Best-effort — registry is non-critical
    }
  }

  async getRegisteredMachines(): Promise<MachineStatus[]> {
    try {
      const channelId = await this.ensureRegistryChannel();
      const history = await this.client.conversations.history({ channel: channelId, limit: 50 });

      const machines: MachineStatus[] = [];
      for (const msg of history.messages ?? []) {
        const nameMatch = msg.text?.match(/`atc:([^`]+)`/);
        if (!nameMatch) continue;

        const name = nameMatch[1];
        const lastSeenMatch = msg.text?.match(/Last seen: (.+)/);
        const sessionsMatch = msg.text?.match(/Sessions: (\d+)/);
        const projectsMatch = msg.text?.match(/Projects: (.+)/);

        const lastSeen = lastSeenMatch ? new Date(lastSeenMatch[1]) : new Date(0);
        const staleThreshold = 3 * 60_000; // 3 minutes
        const isOnline = Date.now() - lastSeen.getTime() < staleThreshold;

        machines.push({
          machineName: name,
          online: isOnline,
          activeSessions: sessionsMatch ? parseInt(sessionsMatch[1], 10) : 0,
          projects:
            projectsMatch && projectsMatch[1] !== 'none'
              ? projectsMatch[1].split(', ')
              : [],
          lastSeen,
        });
      }
      return machines;
    } catch {
      return [];
    }
  }

  // --- Cross-daemon command forwarding (public interface) ---

  async forwardCommand(cmd: IncomingCommand): Promise<void> {
    await this.forwardControlCommand(cmd);
  }

  // --- Cross-daemon action forwarding ---

  private forwardPollTimer: ReturnType<typeof setInterval> | null = null;
  private lastForwardCheckTs: string | undefined;

  /**
   * Post a forwarded action response to the registry channel so the owning
   * daemon can pick it up. Format: `[atc-fwd] requestId|type|value`
   */
  private async forwardActionResponse(requestId: string, type: 'question' | 'permission', value: string): Promise<void> {
    try {
      const channelId = await this.ensureRegistryChannel();
      await this.client.chat.postMessage({
        channel: channelId,
        text: `[atc-fwd] ${requestId}|${type}|${value}`,
      });
    } catch {
      // Best-effort
    }
  }

  /**
   * Forward a project channel message that was routed to the wrong daemon.
   */
  private async forwardProjectMessage(targetMachine: string, msg: IncomingMessage): Promise<void> {
    try {
      const channelId = await this.ensureRegistryChannel();
      const payload = JSON.stringify({
        type: 'msg',
        targetMachine,
        channelId: msg.channelId,
        channelName: msg.channelName,
        threadId: msg.threadId ?? '',
        userId: msg.userId,
        text: msg.text,
        messageId: msg.messageId,
        timestamp: msg.timestamp.toISOString(),
      });
      await this.client.chat.postMessage({
        channel: channelId,
        text: `[atc-msg] ${payload}`,
      });
    } catch {
      // Best-effort
    }
  }

  /**
   * Forward a control command targeted at a different machine.
   */
  private async forwardControlCommand(cmd: IncomingCommand): Promise<void> {
    try {
      const channelId = await this.ensureRegistryChannel();
      const payload = JSON.stringify({
        type: 'cmd',
        targetMachine: cmd.targetMachine,
        command: cmd.command,
        args: cmd.args,
        rawText: cmd.rawText,
        channelId: cmd.channelId,
        channelName: cmd.channelName,
        threadId: cmd.threadId ?? '',
        userId: cmd.userId,
        messageId: cmd.messageId,
      });
      await this.client.chat.postMessage({
        channel: channelId,
        text: `[atc-cmd] ${payload}`,
      });
    } catch {
      // Best-effort
    }
  }

  /** Start polling the registry channel for forwarded responses and messages. */
  startForwardPolling(): void {
    if (this.forwardPollTimer) return;
    this.forwardPollTimer = setInterval(() => {
      void this.checkForwardedResponses();
    }, 2_000);
  }

  stopForwardPolling(): void {
    if (this.forwardPollTimer) {
      clearInterval(this.forwardPollTimer);
      this.forwardPollTimer = null;
    }
  }

  private async checkForwardedResponses(): Promise<void> {
    try {
      const channelId = await this.ensureRegistryChannel();
      const params: Record<string, unknown> = { channel: channelId, limit: 20 };
      if (this.lastForwardCheckTs) params.oldest = this.lastForwardCheckTs;
      const history = await this.client.conversations.history(params as any);

      for (const msg of history.messages ?? []) {
        if (msg.ts) this.lastForwardCheckTs = msg.ts;

        if (msg.text?.startsWith('[atc-fwd] ')) {
          // Skip if nothing is pending
          if (this.pendingQuestions.size === 0 && this.pendingPermissions.size === 0) continue;

          const payload = msg.text.slice('[atc-fwd] '.length);
          const [requestId, type, ...valueParts] = payload.split('|');
          const value = valueParts.join('|');

          if (type === 'question') {
            const pending = this.pendingQuestions.get(requestId);
            if (pending) {
              pending.resolver({ answer: value, wasFreeform: false, timedOut: false });
              try { await this.client.chat.delete({ channel: channelId, ts: msg.ts! }); } catch {}
            }
          } else if (type === 'permission') {
            const resolver = this.pendingPermissions.get(requestId);
            if (resolver) {
              resolver(value as PermissionDecision);
              try { await this.client.chat.delete({ channel: channelId, ts: msg.ts! }); } catch {}
            }
          }
        } else if (msg.text?.startsWith('[atc-msg] ')) {
          // Forwarded project channel message — check if it's for this machine
          try {
            const data = JSON.parse(msg.text.slice('[atc-msg] '.length));
            if (data.targetMachine === this.machineName.toLowerCase()) {
              const incoming: IncomingMessage = {
                channelId: data.channelId,
                channelName: data.channelName,
                threadId: data.threadId || undefined,
                userId: data.userId,
                text: data.text,
                messageId: data.messageId,
                timestamp: new Date(data.timestamp),
              };
              await this.handleProjectMessage(incoming);
              try { await this.client.chat.delete({ channel: channelId, ts: msg.ts! }); } catch {}
            }
          } catch {
            // Malformed forward — ignore
          }
        } else if (msg.text?.startsWith('[atc-cmd] ')) {
          // Forwarded control command — check if it's for this machine
          try {
            const data = JSON.parse(msg.text.slice('[atc-cmd] '.length));
            if (data.targetMachine?.toLowerCase() === this.machineName.toLowerCase()) {
              const cmd: IncomingCommand = {
                type: 'targeted',
                targetMachine: this.machineName,
                command: data.command,
                args: data.args ?? [],
                rawText: data.rawText ?? '',
                channelId: data.channelId,
                channelName: data.channelName ?? '',
                threadId: data.threadId || undefined,
                userId: data.userId,
                messageId: data.messageId,
              };
              await this.dispatchCommand(cmd);
              try { await this.client.chat.delete({ channel: channelId, ts: msg.ts! }); } catch {}
            }
          } catch {
            // Malformed forward — ignore
          }
        }
      }
    } catch {
      // Best-effort
    }
  }

  // --- Private helpers ---

  private get client() {
    if (!this.app) throw new Error('SlackAdapter not connected');
    return this.app.client;
  }

  private buildPresenceStatus(): MachineStatus {
    return {
      machineName: this.machineName,
      online: true,
      activeSessions: 0,
      projects: [],
      lastSeen: new Date(),
    };
  }

  private registerEventHandlers(): void {
    if (!this.app) return;

    // Handle /atc slash command
    this.app.command('/atc', async ({ command, ack }) => {
      await ack();

      const channelId = command.channel_id;
      const channelName = await this.resolveChannelName(channelId);
      const text = command.text.trim();
      const userId = command.user_id;
      const messageId = command.trigger_id;

      const isProject = isProjectChannel(channelName, this.machineName);
      const anyProject = !isProject ? parseAnyProjectChannel(channelName) : null;

      // Empty command or "help" — show context-aware help
      if (!text || text.toLowerCase() === 'help') {
        if (isProject) {
          const projectName = extractProjectName(channelName, this.machineName) ?? channelName;
          await this.sendMessage(channelId, formatProjectHelp(projectName));
        } else {
          await this.sendMessage(channelId, formatControlHelp(this.machineName));
        }
        return;
      }

      if (isProject) {
        // In a project channel: treat as project command
        const tokens = text.split(/\s+/);
        const cmdName = tokens[0]?.toLowerCase();
        if (!cmdName) return;

        const projectCommands = ['status', 'abort', 'diff', 'model', 'agent', 'mode', 'history', 'sessions', 'join', 'leave'];
        if (!projectCommands.includes(cmdName)) {
          await this.sendMessage(channelId, formatUnknownCommand(cmdName, suggestCommands(cmdName, projectCommands)));
          return;
        }

        const cmd: IncomingCommand = {
          type: 'targeted',
          targetMachine: this.machineName,
          command: cmdName,
          args: tokens.slice(1),
          rawText: text,
          channelId,
          channelName,
          userId,
          messageId,
        };
        await this.dispatchCommand(cmd);
      } else if (anyProject) {
        // Another machine's project channel — forward the command as a message
        const incoming: IncomingMessage = {
          channelId,
          channelName,
          userId,
          text,
          messageId,
          timestamp: new Date(),
        };
        void this.forwardProjectMessage(anyProject.machineName, incoming);
      } else {
        // DM or any other channel: parse as control command and route like handleControlMessage
        const parsed = parseControlChannelMessage(text);
        if (!parsed) {
          const controlCommands = ['create', 'delete', 'list', 'config', 'status', 'models', 'sessions', 'join', 'help'];
          const firstWord = text.split(/\s+/)[0]?.toLowerCase() ?? '';
          await this.sendMessage(channelId, formatUnknownCommand(firstWord, suggestCommands(firstWord, controlCommands)));
          return;
        }

        const cmd: IncomingCommand = {
          type: parsed.type,
          targetMachine: parsed.targetMachine ?? this.machineName,
          command: parsed.command,
          args: parsed.args,
          rawText: text,
          channelId,
          channelName,
          userId,
          messageId,
        };

        if (cmd.type === 'broadcast') {
          if (['status', 'machines', 'models'].includes(cmd.command)) {
            await this.dispatchBroadcast(cmd);
            return;
          }
          // Non-broadcast commands without a prefix: handle locally
          cmd.targetMachine = this.machineName;
        }

        // If targeted to a different machine, forward through registry
        if (cmd.targetMachine!.toLowerCase() !== this.machineName.toLowerCase()) {
          void this.forwardControlCommand(cmd);
          return;
        }

        await this.dispatchCommand(cmd);
      }
    });

    // Handle regular messages (prompts in project channels, freeform question replies)
    this.app.message(async ({ message }) => {
      // Ignore bot messages and subtypes (edits, deletes, etc.) — but allow file_share subtype
      if (!message) return;
      if (message.subtype && message.subtype !== 'file_share') return;

      const msg = message as { text?: string; user?: string; ts?: string; thread_ts?: string; channel?: string; files?: Array<{ name: string; url_private_download?: string; mimetype?: string; size?: number }> };
      if (!msg.user || !msg.channel) return;

      // A message must have text or files
      if (!msg.text && (!msg.files || msg.files.length === 0)) return;

      // Ignore own messages
      if (msg.user === this.botUserId) return;

      // Resolve channel name
      const channelName = await this.resolveChannelName(msg.channel);

      // Map attached files to IncomingFile[]
      const files = msg.files
        ?.filter((f) => f.url_private_download)
        .map((f) => ({
          name: f.name,
          url: f.url_private_download!,
          mimeType: f.mimetype,
          size: f.size,
        }));

      const incoming: IncomingMessage = {
        channelId: msg.channel,
        channelName,
        threadId: msg.thread_ts,
        userId: msg.user,
        text: msg.text || '',
        messageId: msg.ts!,
        timestamp: new Date(parseFloat(msg.ts!) * 1000),
        ...(files && files.length > 0 ? { files } : {}),
      };

      // Check for thread replies to pending questions
      if (msg.thread_ts) {
        this.handlePossibleQuestionReply(incoming);
      }

      const isDm = msg.channel.startsWith('D');

      if (isDm) {
        await this.handleControlMessage(incoming);
      } else if (isProjectChannel(channelName, this.machineName)) {
        await this.handleProjectMessage(incoming);
      } else {
        // Check if this is another machine's project channel
        const parsed = parseAnyProjectChannel(channelName);
        if (parsed && parsed.machineName !== this.machineName.toLowerCase()) {
          void this.forwardProjectMessage(parsed.machineName, incoming);
        }
      }
    });

    // Handle button actions (permission responses, question choices)
    this.app.action(/^perm_(allow|always|deny)_/, async ({ action, ack, body, client: actionClient }) => {
      await ack();
      const act = action as { action_id?: string; value?: string };
      if (!act.action_id || !act.value) return;

      const requestId = act.value;

      let decision: PermissionDecision;
      let label: string;
      if (act.action_id.startsWith('perm_always_')) {
        decision = 'always_allow';
        label = '✅ Always Allowed';
      } else if (act.action_id.startsWith('perm_allow_')) {
        decision = 'allow';
        label = '✅ Allowed';
      } else {
        decision = 'deny';
        label = '❌ Denied';
      }

      // Update the original message to show the decision
      const msgBody = body as { channel?: { id?: string }; message?: { ts?: string; text?: string } };
      if (msgBody.channel?.id && msgBody.message?.ts) {
        try {
          await actionClient.chat.update({
            channel: msgBody.channel.id,
            ts: msgBody.message.ts,
            text: `${msgBody.message.text ?? 'Permission request'} — ${label}`,
            blocks: [],
          });
        } catch (err) {
          getLogger().error('Failed to update permission message', { error: err });
        }
      }

      const resolver = this.pendingPermissions.get(requestId);
      if (resolver) {
        resolver(decision);
      } else {
        // Forward to the registry channel so the owning daemon can pick it up
        void this.forwardActionResponse(requestId, 'permission', decision);
      }
    });

    this.app.action(/^question_choice_/, async ({ action, ack, body, client: actionClient }) => {
      await ack();
      const act = action as {
        action_id?: string;
        value?: string;
        type?: string;
        selected_option?: { text?: { text?: string }; value?: string };
      };
      if (!act.action_id) return;

      // Extract requestId from action_id: question_choice_{requestId}_{index}
      // requestId format: q_{machineName}_{timestamp}_{random}
      const prefix = 'question_choice_';
      const suffix = act.action_id.slice(prefix.length);
      const lastUnderscore = suffix.lastIndexOf('_');
      const requestId = suffix.slice(0, lastUnderscore);

      // Resolve the selected value — buttons use .value, static_select uses .selected_option
      let answer: string;
      if (act.type === 'static_select' && act.selected_option) {
        const val = act.selected_option.value ?? '';
        answer = val.startsWith('idx_') ? (act.selected_option.text?.text ?? val) : val;
      } else {
        answer = act.value ?? '';
      }

      if (!answer) return;

      // Update the original message to show the chosen answer
      const displayAnswer = answer.length > 80 ? answer.slice(0, 77) + '…' : answer;
      const msgBody = body as { channel?: { id?: string }; message?: { ts?: string; text?: string } };
      if (msgBody.channel?.id && msgBody.message?.ts) {
        try {
          await actionClient.chat.update({
            channel: msgBody.channel.id,
            ts: msgBody.message.ts,
            text: `${msgBody.message.text ?? 'Question'} — 💬 Answered: ${displayAnswer}`,
            blocks: [],
          });
        } catch (err) {
          getLogger().error('Failed to update question message', { error: err });
        }
      }

      const pending = this.pendingQuestions.get(requestId);
      if (pending) {
        pending.resolver({ answer, wasFreeform: false, timedOut: false });
      } else {
        // Forward to the registry channel so the owning daemon can pick it up
        void this.forwardActionResponse(requestId, 'question', answer);
      }
    });
  }

  private handlePossibleQuestionReply(msg: IncomingMessage): void {
    // Match freeform reply to a pending question from THIS machine in the same channel
    for (const [requestId, pending] of this.pendingQuestions) {
      if (pending.channelId === msg.channelId && requestId.includes(`_${this.machineName}_`)) {
        pending.resolver({ answer: msg.text, wasFreeform: true, timedOut: false });
        return;
      }
    }
  }

  private async handleControlMessage(msg: IncomingMessage): Promise<void> {
    const parsed = parseControlChannelMessage(msg.text);
    if (!parsed) return;

    const cmd: IncomingCommand = {
      type: parsed.type,
      targetMachine: parsed.targetMachine ?? this.machineName,
      command: parsed.command,
      args: parsed.args,
      rawText: msg.text,
      channelId: msg.channelId,
      channelName: msg.channelName,
      threadId: msg.threadId,
      userId: msg.userId,
      messageId: msg.messageId,
    };

    if (cmd.type === 'broadcast') {
      if (['status', 'machines', 'models'].includes(cmd.command)) {
        await this.dispatchBroadcast(cmd);
        return;
      }
      // Non-broadcast commands without a prefix: handle locally
      cmd.targetMachine = this.machineName;
    }

    // If targeted to a different machine, forward through registry
    if (cmd.targetMachine!.toLowerCase() !== this.machineName.toLowerCase()) {
      void this.forwardControlCommand(cmd);
      return;
    }

    await this.dispatchCommand(cmd);
  }

  private async handleProjectMessage(msg: IncomingMessage): Promise<void> {
    const parsed = parseProjectChannelMessage(msg.text);
    if (parsed) {
      const cmd: IncomingCommand = {
        type: 'targeted',
        targetMachine: this.machineName,
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
    } else {
      // Regular text — treat as prompt message
      await this.dispatchMessage(msg);
    }
  }

  private async resolveChannelName(channelId: string): Promise<string> {
    try {
      const result = await this.client.conversations.info({ channel: channelId });
      return (result.channel as { name?: string })?.name ?? channelId;
    } catch {
      return channelId;
    }
  }
}
