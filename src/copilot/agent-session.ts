import { EventEmitter } from 'node:events';
import path from 'node:path';
import { CopilotClient, CopilotSession, approveAll } from '@github/copilot-sdk';
import type { MessagingAdapter, MessageRef } from '../messaging/types.js';
import type { ProjectConfig } from '../projects/types.js';
import { MODE_PREFIXES } from '../projects/types.js';
import { PermissionManager } from './permission-manager.js';
import { markdownToMrkdwn } from '../messaging/slack/mrkdwn.js';
import { getLogger } from '../utils/logger.js';

/** File patterns that trigger automatic upload to the messaging channel. */
const PLAN_FILE_PATTERNS = ['plan.md', 'PLAN.md'];

/** File extensions that should be auto-uploaded to the channel when created by tools. */
const AUTO_UPLOAD_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.pdf'];

/** Tools whose status we skip in the tool-call ticker (handled separately or too noisy). */
const TOOL_STATUS_SKIP = new Set(['report_intent']);

/** Extract a brief description for a tool call from its args. */
function toolCallLabel(toolName: string, toolArgs: Record<string, unknown>): string {
  const desc = (toolArgs.description ?? '') as string;
  if (desc) return desc;
  const p = (toolArgs.path ?? toolArgs.file_path ?? toolArgs.filename ?? '') as string;
  if (p) return path.basename(p);
  const pat = (toolArgs.pattern ?? toolArgs.query ?? '') as string;
  if (pat) return pat.length > 40 ? pat.slice(0, 37) + '…' : pat;
  return '';
}

/** System preamble injected to give Copilot context about the bridged remote interaction. */
function buildSystemPreamble(project: ProjectConfig): string {
  return [
    '<air_traffic_context>',
    'You are being operated remotely through a messaging bridge (e.g. Slack).',
    'The user is NOT at the local machine — they can only see what you send back through the messaging channel.',
    '',
    'IMPORTANT behavioral rules for this remote context:',
    '• The user CANNOT open localhost URLs, local browsers, or view local files directly.',
    '• When you take screenshots or generate images/files the user needs to see, ALWAYS save them',
    `  to the working directory (${project.path}) with a clear filename. The bridge will auto-upload them.`,
    '• When referencing files you created or modified, mention the file path so the user knows what changed.',
    '• Do NOT say "here\'s the screenshot" without saving the file — the user can\'t see your local screen.',
    '• Do NOT suggest the user open localhost URLs — they are remote. Instead, describe what you see or take a screenshot.',
    '• When using Playwright or browser tools, capture screenshots and save them to share results.',
    '• For questions or decisions, be explicit — the user will respond through the messaging channel.',
    '',
    'OUTPUT FORMATTING — your responses are rendered in Slack, not a terminal or browser:',
    '• Use Slack mrkdwn syntax, NOT standard Markdown.',
    '• Bold: *bold text*  Italic: _italic text_  Strikethrough: ~struck~  Inline code: `code`',
    '• Code blocks: wrap in triple backticks (``` ... ```). You can add a language hint on the opening line.',
    '• Links: <https://example.com|link text>  — do NOT use [text](url) Markdown links.',
    '• Bullet lists: use • or - at the start of a line. Numbered lists: 1. 2. 3.',
    '• Do NOT use # for headings — Slack does not render them. Use *bold* for section titles instead.',
    '• Do NOT use HTML tags — Slack strips them.',
    '• Block quotes: prefix lines with > for quoted text.',
    '• Keep messages concise — Slack truncates very long messages.',
    '</air_traffic_context>',
  ].join('\n');
}

export class AgentSession {
  private session: CopilotSession | null = null;
  private currentThreadId: string | null = null;
  private currentUserId: string | null = null;
  private deltaBuffer: string = '';
  private deltaFlushTimer: ReturnType<typeof setInterval> | null = null;
  private lastDeltaMessageRef: MessageRef | null = null;
  private idle: boolean = true;
  private pendingPlanFile: string | null = null;
  private activeSubAgent: string | null = null;
  private currentIntent: string = '';
  private toolCallLog: Array<{ name: string; label: string; done: boolean }> = [];
  private readonly DELTA_FLUSH_INTERVAL = 2000; // 2 seconds

  /** EventEmitter for Console / Socket.IO observation of session events. */
  public readonly events: EventEmitter = new EventEmitter();

  constructor(
    private client: CopilotClient,
    private messaging: MessagingAdapter,
    private project: ProjectConfig,
    private permissionManager: PermissionManager,
  ) {}

  /** Build the shared session config used for both new and resumed sessions. */
  private buildSessionConfig(model?: string) {
    const effectiveModel = model ?? this.project.model;
    return {
      model: effectiveModel,
      systemMessage: { mode: 'append' as const, content: buildSystemPreamble(this.project) },
      streaming: true,
      workingDirectory: this.project.path,
      onPermissionRequest: approveAll,
      onUserInputRequest: async (request: { question: string; choices?: string[]; allowFreeform?: boolean }) => {
        if (!this.currentThreadId) {
          return { answer: '', wasFreeform: true };
        }
        const mention = this.currentUserId ? `<@${this.currentUserId}> ` : '';
        this.events.emit('question', { question: request.question, choices: request.choices });
        const response = await this.messaging.askQuestion(
          this.project.channelId,
          this.currentThreadId,
          {
            question: `${mention}${request.question}`,
            choices: request.choices,
            allowFreeform: request.allowFreeform ?? true,
          },
        );
        this.events.emit('answer', { question: request.question, answer: response.answer });
        // Re-assert status — the question message cleared it
        this.updateAssistantStatus();
        return { answer: response.answer, wasFreeform: response.wasFreeform };
      },
      hooks: {
        onPreToolUse: async (input: { toolName: string; toolArgs: unknown }) => {
          const toolName = input.toolName;
          getLogger().debug(`onPreToolUse called: ${toolName}`, { args: input.toolArgs });

          // Capture report_intent tool calls → update assistant status
          if (toolName === 'report_intent') {
            const args = input.toolArgs as Record<string, unknown>;
            const intent = (args.intent ?? '') as string;
            if (intent && this.currentThreadId) {
              this.currentIntent = intent;
              this.events.emit('intent', { intent });
              this.updateAssistantStatus();
            }
            return { permissionDecision: 'allow' as const };
          }

          // Track sub-agent (task tool) launches
          if (toolName === 'task') {
            const args = input.toolArgs as Record<string, unknown>;
            const description = (args.description ?? args.prompt ?? 'sub-agent') as string;
            this.activeSubAgent = description;
            this.events.emit('subagent', { status: 'start', description });
            this.updateAssistantStatus();
          }

          // Track tool calls for assistant status
          if (!TOOL_STATUS_SKIP.has(toolName) && this.currentThreadId) {
            const args = input.toolArgs as Record<string, unknown>;
            const label = toolCallLabel(toolName, args);
            this.toolCallLog.push({ name: toolName, label, done: false });
            this.events.emit('tool', { status: 'running', toolName, label });
            this.updateAssistantStatus();
          }

          // Detect plan file writes for auto-upload
          if (toolName === 'create' || toolName === 'create_file' || toolName === 'edit' || toolName === 'edit_file') {
            const args = input.toolArgs as Record<string, unknown>;
            const filePath = (args.path ?? args.file_path ?? '') as string;
            const basename = path.basename(filePath);
            if (PLAN_FILE_PATTERNS.includes(basename)) {
              this.pendingPlanFile = filePath;
            }
          }

          if (this.permissionManager.shouldAsk(toolName, this.project.permissions)) {
            if (!this.currentThreadId) {
              return { permissionDecision: 'deny' as const };
            }
            const category = this.permissionManager.categorize(toolName);
            this.events.emit('permission_request', { toolName, category });
            const mention = this.currentUserId ? `<@${this.currentUserId}> ` : '';
            const decision = await this.messaging.askPermission(
              this.project.channelId,
              this.currentThreadId,
              {
                toolName,
                toolCategory: category,
                description: `${mention}Tool "${toolName}" wants to execute`,
                args: input.toolArgs as Record<string, unknown>,
              },
            );
            this.events.emit('permission_response', { toolName, category, decision });
            // Re-assert status after permission interaction
            this.updateAssistantStatus();
            if (decision === 'always_allow') {
              (this.project.permissions as unknown as Record<string, string>)[category] = 'auto';
              this.events.emit('permissions_updated', {
                projectName: this.project.name,
                category,
                mode: 'auto',
              });
              return { permissionDecision: 'allow' as const };
            }
            return {
              permissionDecision: decision === 'allow' ? ('allow' as const) : ('deny' as const),
            };
          }
          return { permissionDecision: 'allow' as const };
        },
        onPostToolUse: async (input: { toolName: string; toolArgs: unknown; toolResult?: { textResultForLlm?: string } }) => {
          const toolName = input.toolName;
          const args = input.toolArgs as Record<string, unknown>;

          // Mark tool done in the call log
          if (!TOOL_STATUS_SKIP.has(toolName) && this.currentThreadId) {
            let idx = -1;
            for (let i = this.toolCallLog.length - 1; i >= 0; i--) {
              if (this.toolCallLog[i].name === toolName && !this.toolCallLog[i].done) {
                idx = i;
                break;
              }
            }
            if (idx >= 0) {
              this.toolCallLog[idx].done = true;
              this.events.emit('tool', { status: 'done', toolName, label: this.toolCallLog[idx].label });
              this.updateAssistantStatus();
            }
          }

          // Capture sub-agent (task tool) completion and post output
          if (toolName === 'task' && this.activeSubAgent) {
            const result = input.toolResult?.textResultForLlm ?? '';
            const description = this.activeSubAgent;
            this.activeSubAgent = null;
            if (result && this.currentThreadId) {
              const preview = result.length > 3000 ? result.slice(0, 3000) + '\n…(truncated)' : result;
              const formatted = markdownToMrkdwn(preview);
              await this.messaging.sendMessage(this.project.channelId, {
                text: `🤖 *Sub-agent result* — _${description}_\n>>>${formatted}`,
              }).catch(() => {});
              // Re-assert status after sending
              this.updateAssistantStatus();
            }
            this.events.emit('subagent', { status: 'done', description, output: result });
          }

          // Auto-upload image/file artifacts to the messaging channel
          const filePath = (args.path ?? args.filename ?? args.file_path ?? '') as string;

          if (
            toolName === 'create' || toolName === 'create_file' ||
            toolName === 'playwright-browser_take_screenshot'
          ) {
            if (filePath && this.currentThreadId) {
              await this.tryUploadArtifact(filePath);
            }
          }

          // Scan tool output for file paths with uploadable extensions
          const resultText = input.toolResult?.textResultForLlm ?? '';
          if (resultText && this.currentThreadId) {
            const filePathPattern = /(?:[A-Z]:\\[\w\\.-]+|\/[\w/.-]+)\.(?:png|jpg|jpeg|gif|svg|webp|pdf)/gi;
            const matches = resultText.match(filePathPattern);
            if (matches) {
              const seen = new Set<string>();
              for (const match of matches) {
                const normalized = path.resolve(match);
                if (!seen.has(normalized)) {
                  seen.add(normalized);
                  await this.tryUploadArtifact(normalized);
                }
              }
            }
          }
        },
      },
    };
  }

  /**
   * Build and push a rich status string to the Slack assistant status API.
   * Uses `status` for the primary action and `loading_messages` to cycle
   * through recent tool activity.
   */
  private updateAssistantStatus(): void {
    if (!this.currentThreadId) return;

    // Primary status line
    let status = 'is thinking…';
    if (this.activeSubAgent) {
      status = `is running sub-agent: ${this.activeSubAgent}`;
    } else if (this.currentIntent) {
      status = `is ${this.currentIntent.toLowerCase()}`;
    }

    // Build loading_messages from the tool call log (last 10)
    const loadingMessages: string[] = [];
    const recent = this.toolCallLog.slice(-10);
    for (const t of recent) {
      const icon = t.done ? '✅' : '⚙️';
      const detail = t.label ? ` — ${t.label}` : '';
      loadingMessages.push(`${icon} ${t.name}${detail}`);
    }

    this.messaging.setThreadStatus(
      this.project.channelId,
      this.currentThreadId,
      status,
      loadingMessages.length > 0 ? loadingMessages : undefined,
    ).catch(() => {});
  }

  /** Clear the assistant status indicator. */
  private clearAssistantStatus(): void {
    if (!this.currentThreadId) return;
    this.messaging.setThreadStatus(this.project.channelId, this.currentThreadId, '').catch(() => {});
  }

  async initialize(model?: string): Promise<void> {
    const logger = getLogger();
    const config = this.buildSessionConfig(model);
    this.session = await this.client.createSession(config);
    this.setupEventListeners();
    logger.info(`Session initialized for project ${this.project.name} with model ${config.model}`);
  }

  /** Resume an existing Copilot CLI session by ID. */
  async resumeExisting(sessionId: string, threadId: string, userId?: string): Promise<string> {
    const logger = getLogger();
    const config = this.buildSessionConfig();
    this.session = await this.client.resumeSession(sessionId, config);
    this.setupEventListeners();
    this.currentThreadId = threadId;
    this.currentUserId = userId ?? null;
    this.idle = true;

    // Replay conversation history as a summary
    let summary = '';
    try {
      const messages = await this.session.getMessages();
      const turns: string[] = [];
      for (const msg of messages) {
        if (msg.type === 'user.message') {
          const text = msg.data?.content ?? '';
          if (text) turns.push(`👤 ${text.slice(0, 200)}`);
        } else if (msg.type === 'assistant.message') {
          const text = msg.data?.content ?? '';
          if (text) turns.push(`🤖 ${text.slice(0, 200)}`);
        }
      }
      if (turns.length > 0) {
        // Show last 10 turns max
        const recent = turns.slice(-10);
        summary = `📜 *Session history* (${messages.length} events, showing last ${recent.length} turns):\n${recent.join('\n')}`;
      } else {
        summary = '📜 Session has no conversation history yet.';
      }
    } catch (err) {
      logger.warn('Failed to retrieve session history', { error: err });
      summary = '📜 Could not retrieve session history.';
    }

    logger.info(`Resumed session ${sessionId} for project ${this.project.name}`);
    return summary;
  }

  private setupEventListeners(): void {
    if (!this.session) return;

    // Stream deltas (batched)
    this.session.on('assistant.message_delta', (event) => {
      this.deltaBuffer += event.data.deltaContent;
      this.scheduleDeltaFlush();
      this.events.emit('delta', { content: event.data.deltaContent });
    });

    // Tool execution start (event only — status handled by onPreToolUse)
    this.session.on('tool.execution_start', (event) => {
      const toolName = event.data?.toolName ?? 'unknown tool';
      this.events.emit('tool', { toolName, status: 'start' });
    });

    // Session idle (task complete)
    this.session.on('session.idle', () => {
      this.idle = true; // Set idle BEFORE flushing to prevent status re-assertion
      this.clearAssistantStatus();
      this.activeSubAgent = null;
      this.currentIntent = '';
      this.flushDeltaBuffer()
        .then(async () => {
          this.stopDeltaFlush();
          this.events.emit('idle');

          // Upload plan file if one was written during this task
          if (this.pendingPlanFile) {
            try {
              await this.messaging.sendFile(
                this.project.channelId,
                this.pendingPlanFile,
                path.basename(this.pendingPlanFile),
                '📋 Plan ready for review',
              );
            } catch (err) {
              getLogger().error('Failed to upload plan file', { error: err });
            }
            this.pendingPlanFile = null;
          }

          return this.messaging.sendMessage(this.project.channelId, {
            text: '✅ Task complete',
          });
        })
        .catch((err) => getLogger().error('Error handling session.idle', { error: err }));
    });

    // Full assistant message
    this.session.on('assistant.message', (event) => {
      this.events.emit('message', { content: event.data.content });
    });
  }

  async handlePrompt(prompt: string, threadId: string, userId?: string): Promise<void> {
    if (!this.session) {
      await this.initialize();
    }

    this.currentThreadId = threadId;
    this.currentUserId = userId ?? null;
    this.idle = false;
    this.deltaBuffer = '';
    this.accumulatedContent = '';
    this.lastDeltaMessageRef = null;
    this.currentIntent = '';
    this.toolCallLog = [];

    this.events.emit('prompt', { text: prompt });
    this.updateAssistantStatus(); // Shows "Thinking…" via assistant API

    const modePrefix = MODE_PREFIXES[this.project.mode ?? 'normal'] ?? '';
    await this.session!.send({ prompt: `${modePrefix}${prompt}` });
  }

  async abort(): Promise<void> {
    if (this.session) {
      await this.session.abort();
      this.stopDeltaFlush();
      this.idle = true;
    }
  }

  async disconnect(): Promise<void> {
    this.stopDeltaFlush();
    if (this.session) {
      await this.session.disconnect();
      this.session = null;
    }
  }

  isIdle(): boolean {
    return this.idle;
  }

  /** Return the underlying SDK session ID, if initialized. */
  getSessionId(): string | null {
    return this.session?.sessionId ?? null;
  }

  /** Return structured conversation history from the underlying session. */
  async getHistory(): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    if (!this.session) return [];
    try {
      const messages = await this.session.getMessages();
      const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
      for (const msg of messages) {
        if (msg.type === 'user.message') {
          const text = (msg as any).data?.content ?? '';
          if (text) history.push({ role: 'user', content: text });
        } else if (msg.type === 'assistant.message') {
          const text = (msg as any).data?.content ?? '';
          if (text) history.push({ role: 'assistant', content: text });
        }
      }
      return history;
    } catch {
      return [];
    }
  }

  /** Try to upload a file to the messaging channel if it has an uploadable extension. */
  private async tryUploadArtifact(filePath: string): Promise<void> {
    const ext = path.extname(filePath).toLowerCase();
    if (!AUTO_UPLOAD_EXTENSIONS.includes(ext)) return;
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.project.path, filePath);
    try {
      const fs = await import('node:fs');
      if (!fs.existsSync(resolvedPath)) return;
      await this.messaging.sendFile(
        this.project.channelId,
        resolvedPath,
        path.basename(resolvedPath),
        `📎 ${path.basename(resolvedPath)}`,
      );
      getLogger().info(`Auto-uploaded artifact: ${resolvedPath}`);
    } catch (err) {
      getLogger().warn(`Failed to auto-upload artifact: ${resolvedPath}`, { error: err });
    }
  }

  // --- Delta batching ---

  private scheduleDeltaFlush(): void {
    if (this.deltaFlushTimer) return;
    this.deltaFlushTimer = setInterval(() => {
      this.flushDeltaBuffer();
    }, this.DELTA_FLUSH_INTERVAL);
  }

  private stopDeltaFlush(): void {
    if (this.deltaFlushTimer) {
      clearInterval(this.deltaFlushTimer);
      this.deltaFlushTimer = null;
    }
  }

  private accumulatedContent: string = '';

  private async flushDeltaBuffer(): Promise<void> {
    if (!this.deltaBuffer || !this.currentThreadId) return;

    this.accumulatedContent += this.deltaBuffer;
    this.deltaBuffer = '';

    // Slack has a 4000-char limit per message; start a new message if exceeded
    const MAX_MSG_LEN = 3900;
    if (this.lastDeltaMessageRef && this.accumulatedContent.length > MAX_MSG_LEN) {
      this.lastDeltaMessageRef = null;
      this.accumulatedContent = this.accumulatedContent.slice(-MAX_MSG_LEN);
    }

    const formatted = markdownToMrkdwn(this.accumulatedContent);

    try {
      if (this.lastDeltaMessageRef) {
        await this.messaging.updateMessage(this.lastDeltaMessageRef, { text: formatted });
      } else {
        this.lastDeltaMessageRef = await this.messaging.sendMessage(
          this.project.channelId,
          { text: formatted },
        );
      }
      // Re-assert assistant status after sending — Slack auto-clears it on bot messages
      if (!this.idle) this.updateAssistantStatus();
    } catch (err) {
      getLogger().error('Failed to flush delta buffer', { error: err });
    }
  }

}
