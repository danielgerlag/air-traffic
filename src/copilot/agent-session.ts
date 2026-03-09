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

/** System preamble injected to give Copilot context about the bridged remote interaction. */
function buildSystemPreamble(project: ProjectConfig): string {
  return [
    '<wingman_context>',
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
    '• Keep responses concise — they will be displayed in a chat interface with limited formatting.',
    '• For questions or decisions, be explicit — the user will respond through the messaging channel.',
    '</wingman_context>',
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
  private thinkingRef: MessageRef | null = null;
  private toolStatusRef: MessageRef | null = null;
  private intentRef: MessageRef | null = null;
  private thinkingTimer: ReturnType<typeof setInterval> | null = null;
  private thinkingTick: number = 0;
  private activeSubAgent: string | null = null;
  private readonly DELTA_FLUSH_INTERVAL = 2000; // 2 seconds
  private static readonly THINKING_FRAMES = ['⏳ Thinking', '⏳ Thinking.', '⏳ Thinking..', '⏳ Thinking...'];

  /** EventEmitter for Console / Socket.IO observation of session events. */
  public readonly events: EventEmitter = new EventEmitter();

  constructor(
    private client: CopilotClient,
    private messaging: MessagingAdapter,
    private project: ProjectConfig,
    private permissionManager: PermissionManager,
  ) {}

  async initialize(model?: string): Promise<void> {
    const logger = getLogger();
    const effectiveModel = model ?? this.project.model;

    this.session = await this.client.createSession({
      model: effectiveModel,
      systemMessage: { mode: 'append', content: buildSystemPreamble(this.project) },
      streaming: true,
      workingDirectory: this.project.path,
      onPermissionRequest: approveAll,
      onUserInputRequest: async (request) => {
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
        return { answer: response.answer, wasFreeform: response.wasFreeform };
      },
      hooks: {
        onPreToolUse: async (input) => {
          const toolName = input.toolName;
          getLogger().debug(`onPreToolUse called: ${toolName}`, { args: input.toolArgs });

          // Capture report_intent tool calls → show intent in channel
          if (toolName === 'report_intent') {
            const args = input.toolArgs as Record<string, unknown>;
            const intent = (args.intent ?? '') as string;
            if (intent && this.currentThreadId) {
              this.events.emit('intent', { intent });
              const text = `💭 \`${intent}\``;
              // Delete the previous intent message and post a fresh one
              if (this.intentRef) {
                this.messaging.deleteMessage(this.intentRef).catch(() => {});
                this.intentRef = null;
              }
              this.messaging
                .sendMessage(this.project.channelId, { text })
                .then((ref) => { this.intentRef = ref; })
                .catch(() => {});
            }
            return { permissionDecision: 'allow' as const };
          }

          // Track sub-agent (task tool) launches
          if (toolName === 'task') {
            const args = input.toolArgs as Record<string, unknown>;
            const description = (args.description ?? args.prompt ?? 'sub-agent') as string;
            this.activeSubAgent = description;
            this.events.emit('subagent', { status: 'start', description });
            if (this.currentThreadId) {
              const text = `🤖 Sub-agent: _${description}_`;
              if (this.toolStatusRef) {
                this.messaging.updateMessage(this.toolStatusRef, { text }).catch(() => {});
              } else {
                this.messaging
                  .sendMessage(this.project.channelId, { text })
                  .then((ref) => { this.toolStatusRef = ref; })
                  .catch(() => {});
              }
            }
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
            if (decision === 'always_allow') {
              // Update in-memory permissions so future calls in this session auto-approve
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
        onPostToolUse: async (input) => {
          const toolName = input.toolName;
          const args = input.toolArgs as Record<string, unknown>;

          // Capture sub-agent (task tool) completion and post output
          if (toolName === 'task' && this.activeSubAgent) {
            const result = input.toolResult?.textResultForLlm ?? '';
            const description = this.activeSubAgent;
            this.activeSubAgent = null;
            if (result && this.currentThreadId) {
              // Truncate to a reasonable preview length for Slack
              const preview = result.length > 3000 ? result.slice(0, 3000) + '\n…(truncated)' : result;
              const formatted = markdownToMrkdwn(preview);
              await this.messaging.sendMessage(this.project.channelId, {
                text: `🤖 *Sub-agent result* — _${description}_\n>>>${formatted}`,
              }).catch(() => {});
            }
            this.events.emit('subagent', { status: 'done', description, output: result });
          }

          // Auto-upload image/file artifacts to the messaging channel
          const filePath = (args.path ?? args.filename ?? args.file_path ?? '') as string;

          // Direct file creation tools — check args for the file path
          if (
            toolName === 'create' || toolName === 'create_file' ||
            toolName === 'playwright-browser_take_screenshot'
          ) {
            if (filePath && this.currentThreadId) {
              await this.tryUploadArtifact(filePath);
            }
          }

          // Scan tool output for file paths with uploadable extensions (e.g. shell commands that save screenshots)
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
    });

    this.setupEventListeners();
    logger.info(`Session initialized for project ${this.project.name} with model ${effectiveModel}`);
  }

  private setupEventListeners(): void {
    if (!this.session) return;

    // Stream deltas (batched)
    this.session.on('assistant.message_delta', (event) => {
      this.stopThinking(); // dismiss spinner on first output
      this.deltaBuffer += event.data.deltaContent;
      this.scheduleDeltaFlush();
      this.events.emit('delta', { content: event.data.deltaContent });
    });

    // Tool execution start
    this.session.on('tool.execution_start', (event) => {
      this.stopThinking(); // dismiss spinner on first tool
      const toolName = event.data?.toolName ?? 'unknown tool';
      this.events.emit('tool', { toolName, status: 'start' });
      if (this.currentThreadId) {
        const text = `🔧 Running: ${toolName}`;
        if (this.toolStatusRef) {
          this.messaging
            .updateMessage(this.toolStatusRef, { text })
            .catch((err) => getLogger().error('Failed to update tool status', { error: err }));
        } else {
          this.messaging
            .sendMessage(this.project.channelId, { text })
            .then((ref) => { this.toolStatusRef = ref; })
            .catch((err) => getLogger().error('Failed to post tool status', { error: err }));
        }
      }
    });

    // Session idle (task complete)
    this.session.on('session.idle', () => {
      this.stopThinking();
      // Remove tool status message
      if (this.toolStatusRef) {
        this.messaging.deleteMessage(this.toolStatusRef).catch(() => {});
        this.toolStatusRef = null;
      }
      // Remove intent message
      if (this.intentRef) {
        this.messaging.deleteMessage(this.intentRef).catch(() => {});
        this.intentRef = null;
      }
      this.activeSubAgent = null;
      this.flushDeltaBuffer()
        .then(async () => {
          this.stopDeltaFlush();
          this.idle = true;
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
    this.toolStatusRef = null;
    this.intentRef = null;

    this.events.emit('prompt', { text: prompt });
    await this.startThinking();

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
    } catch (err) {
      getLogger().error('Failed to flush delta buffer', { error: err });
    }
  }

  // --- Thinking indicator ---

  private async startThinking(): Promise<void> {
    this.thinkingTick = 0;
    try {
      this.thinkingRef = await this.messaging.sendMessage(this.project.channelId, {
        text: AgentSession.THINKING_FRAMES[0],
      });
    } catch {
      return; // Non-critical — don't block the session
    }
    this.thinkingTimer = setInterval(() => {
      this.thinkingTick = (this.thinkingTick + 1) % AgentSession.THINKING_FRAMES.length;
      if (this.thinkingRef) {
        this.messaging
          .updateMessage(this.thinkingRef, { text: AgentSession.THINKING_FRAMES[this.thinkingTick] })
          .catch(() => {}); // best-effort animation
      }
    }, 1000);
  }

  private async stopThinking(): Promise<void> {
    if (this.thinkingTimer) {
      clearInterval(this.thinkingTimer);
      this.thinkingTimer = null;
    }
    if (this.thinkingRef) {
      try {
        await this.messaging.deleteMessage(this.thinkingRef);
      } catch {
        // If delete fails, try blanking it out
        try {
          await this.messaging.updateMessage(this.thinkingRef, { text: '🔄 Working...' });
        } catch { /* best-effort */ }
      }
      this.thinkingRef = null;
    }
  }
}
