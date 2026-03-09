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
  }

  async disconnect(): Promise<void> {
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
    const requestId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
    const requestId = `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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
      } else {
        // DM or any other channel: parse as control command
        const parsed = parseControlChannelMessage(text);
        if (!parsed) {
          const controlCommands = ['create', 'delete', 'list', 'config', 'status', 'models', 'sessions', 'join', 'help'];
          const firstWord = text.split(/\s+/)[0]?.toLowerCase() ?? '';
          await this.sendMessage(channelId, formatUnknownCommand(firstWord, suggestCommands(firstWord, controlCommands)));
          return;
        }

        const cmd: IncomingCommand = {
          type: 'targeted',
          targetMachine: this.machineName,
          command: parsed.command,
          args: parsed.args,
          rawText: text,
          channelId,
          channelName,
          userId,
          messageId,
        };
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
      if (resolver) resolver(decision);
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

      // Resolve the selected value — buttons use .value, static_select uses .selected_option
      let answer: string;
      if (act.type === 'static_select' && act.selected_option) {
        const val = act.selected_option.value ?? '';
        // If value is idx_N, use the full text from the option label
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

      // Extract requestId from action_id: question_choice_{requestId}_{index}
      const parts = act.action_id.split('_');
      const requestId = `${parts[2]}_${parts[3]}_${parts[4]}`;
      const pending = this.pendingQuestions.get(requestId);
      if (pending) {
        pending.resolver({ answer, wasFreeform: false, timedOut: false });
      }
    });
  }

  private handlePossibleQuestionReply(msg: IncomingMessage): void {
    // Match freeform reply to the pending question in the same channel
    for (const [requestId, pending] of this.pendingQuestions) {
      if (pending.channelId === msg.channelId) {
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

    // In per-machine control channel, treat all commands as targeted to this machine
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
