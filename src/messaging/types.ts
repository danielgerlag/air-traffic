// Channel information
export interface ChannelInfo {
  id: string;
  name: string;
}

// Reference to a sent message (for updates)
export interface MessageRef {
  channelId: string;
  messageId: string;      // Slack ts, Discord message ID, etc.
  threadId?: string;
}

// Content of a message to send
export interface MessageContent {
  text: string;
  blocks?: unknown[];     // Platform-specific rich content (Block Kit for Slack, embeds for Discord, etc.)
}

// File attachment on an incoming message
export interface IncomingFile {
  name: string;
  url: string;          // Platform-specific download URL (requires auth)
  mimeType?: string;
  size?: number;
}

// Incoming message from a user
export interface IncomingMessage {
  channelId: string;
  channelName: string;
  threadId?: string;
  userId: string;
  text: string;
  messageId: string;
  timestamp: Date;
  files?: IncomingFile[];
}

// Parsed command from control or project channel
export interface IncomingCommand {
  type: 'targeted' | 'broadcast';
  targetMachine?: string;    // Only set for 'targeted' commands
  command: string;           // The command name (e.g., 'create', 'list', 'status')
  args: string[];            // Remaining arguments
  rawText: string;           // Original message text
  channelId: string;
  channelName: string;
  threadId?: string;
  userId: string;
  messageId: string;
}

// Question from agent to user
export interface QuestionRequest {
  question: string;
  choices?: string[];
  allowFreeform?: boolean;
  timeout?: number;          // ms, default from config
}

// User's response to a question
export interface QuestionResponse {
  answer: string;
  wasFreeform: boolean;
  timedOut: boolean;
}

// Permission request from agent
export interface PermissionRequest {
  toolName: string;
  toolCategory: string;     // 'fileEdit', 'shell', 'git', 'network', etc.
  description: string;      // Human-readable description of what the tool wants to do
  args?: Record<string, unknown>;
}

// User's permission decision
export type PermissionDecision = 'allow' | 'deny' | 'always_allow';

// Machine status for presence reporting
export interface MachineStatus {
  machineName: string;
  online: boolean;
  activeSessions: number;
  projects: string[];
  lastSeen: Date;
}

// Handler types
export type MessageHandler = (msg: IncomingMessage) => void | Promise<void>;
export type CommandHandler = (cmd: IncomingCommand) => void | Promise<void>;

// The core messaging adapter interface
export interface MessagingAdapter {
  readonly machineName: string;

  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Channels
  createProjectChannel(machineName: string, projectName: string): Promise<ChannelInfo>;
  archiveChannel(channelId: string): Promise<void>;
  setChannelTopic(channelId: string, topic: string): Promise<void>;

  // Messages
  sendMessage(channelId: string, content: MessageContent): Promise<MessageRef>;
  sendThreadReply(channelId: string, threadId: string, content: MessageContent): Promise<MessageRef>;
  updateMessage(ref: MessageRef, content: MessageContent): Promise<void>;
  deleteMessage(ref: MessageRef): Promise<void>;

  // Interaction
  askQuestion(channelId: string, threadId: string, question: QuestionRequest): Promise<QuestionResponse>;
  askPermission(channelId: string, threadId: string, request: PermissionRequest): Promise<PermissionDecision>;

  // File uploads
  sendFile(channelId: string, filePath: string, filename: string, initialComment?: string, threadId?: string): Promise<void>;

  // File downloads (from incoming uploads)
  downloadFile(url: string, destPath: string): Promise<void>;

  // Thread status (AI assistant typing indicator)
  setThreadStatus(channelId: string, threadId: string, status: string, loadingMessages?: string[]): Promise<void>;

  // Presence
  reportPresence(): Promise<void>;
  reportStatus(status: MachineStatus): Promise<void>;

  // Events (machine-filtered)
  onMessage(handler: MessageHandler): void;
  onCommand(handler: CommandHandler): void;
  onBroadcast(handler: CommandHandler): void;
}
