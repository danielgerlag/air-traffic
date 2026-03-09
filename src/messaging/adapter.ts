import type {
  MessagingAdapter,
  ChannelInfo,
  MessageContent,
  MessageRef,
  QuestionRequest,
  QuestionResponse,
  PermissionRequest,
  PermissionDecision,
  MachineStatus,
  MessageHandler,
  CommandHandler,
} from './types.js';

export abstract class BaseMessagingAdapter implements MessagingAdapter {
  abstract readonly machineName: string;

  protected messageHandlers: MessageHandler[] = [];
  protected commandHandlers: CommandHandler[] = [];
  protected broadcastHandlers: CommandHandler[] = [];

  // Lifecycle
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;

  // Channels
  abstract createProjectChannel(machineName: string, projectName: string): Promise<ChannelInfo>;
  abstract archiveChannel(channelId: string): Promise<void>;
  abstract getControlChannel(): Promise<ChannelInfo>;

  // Messages
  abstract sendMessage(channelId: string, content: MessageContent): Promise<MessageRef>;
  abstract sendThreadReply(channelId: string, threadId: string, content: MessageContent): Promise<MessageRef>;
  abstract updateMessage(ref: MessageRef, content: MessageContent): Promise<void>;
  abstract deleteMessage(ref: MessageRef): Promise<void>;

  // Interaction
  abstract askQuestion(channelId: string, threadId: string, question: QuestionRequest): Promise<QuestionResponse>;
  abstract askPermission(channelId: string, threadId: string, request: PermissionRequest): Promise<PermissionDecision>;

  // File uploads
  abstract sendFile(channelId: string, filePath: string, filename: string, initialComment?: string): Promise<void>;

  // File downloads
  abstract downloadFile(url: string, destPath: string): Promise<void>;

  // Presence
  abstract reportPresence(): Promise<void>;
  abstract reportStatus(status: MachineStatus): Promise<void>;

  // Event registration
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  onCommand(handler: CommandHandler): void {
    this.commandHandlers.push(handler);
  }

  onBroadcast(handler: CommandHandler): void {
    this.broadcastHandlers.push(handler);
  }

  // Dispatch helpers for subclasses
  protected async dispatchMessage(msg: Parameters<MessageHandler>[0]): Promise<void> {
    for (const handler of this.messageHandlers) {
      await handler(msg);
    }
  }

  protected async dispatchCommand(cmd: Parameters<CommandHandler>[0]): Promise<void> {
    for (const handler of this.commandHandlers) {
      await handler(cmd);
    }
  }

  protected async dispatchBroadcast(cmd: Parameters<CommandHandler>[0]): Promise<void> {
    for (const handler of this.broadcastHandlers) {
      await handler(cmd);
    }
  }

  // Helper: generate project channel name
  protected projectChannelName(machineName: string, projectName: string): string {
    return `wm-${machineName}-${projectName}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }
}
