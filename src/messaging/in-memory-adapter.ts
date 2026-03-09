import { BaseMessagingAdapter } from './adapter.js';
import type {
  ChannelInfo,
  MessageContent,
  MessageRef,
  QuestionRequest,
  QuestionResponse,
  PermissionRequest,
  PermissionDecision,
  MachineStatus,
  IncomingMessage,
  IncomingCommand,
} from './types.js';

interface SentMessage {
  channelId: string;
  content: MessageContent;
  threadId?: string;
  timestamp: Date;
}

interface CreatedChannel {
  machineName: string;
  projectName: string;
  channelInfo: ChannelInfo;
}

interface AskedQuestion {
  channelId: string;
  threadId: string;
  question: QuestionRequest;
  response: QuestionResponse;
}

interface AskedPermission {
  channelId: string;
  threadId: string;
  request: PermissionRequest;
  decision: PermissionDecision;
}

export class InMemoryMessagingAdapter extends BaseMessagingAdapter {
  readonly machineName: string;

  // Recorded state for assertions
  readonly sentMessages: SentMessage[] = [];
  readonly createdChannels: CreatedChannel[] = [];
  readonly archivedChannels: string[] = [];
  readonly askedQuestions: AskedQuestion[] = [];
  readonly askedPermissions: AskedPermission[] = [];
  readonly reportedStatuses: MachineStatus[] = [];
  readonly updatedMessages: Array<{ ref: MessageRef; content: MessageContent }> = [];
  readonly sentFiles: Array<{ channelId: string; filePath: string; filename: string; comment?: string; threadId?: string }> = [];

  private connected = false;
  private presenceReported = false;
  private channelIdCounter = 0;
  private messageIdCounter = 0;

  // Pre-queued responses
  private questionResponses: QuestionResponse[] = [];
  private permissionDecisions: PermissionDecision[] = [];

  // Control channel
  constructor(machineName: string = 'test-machine') {
    super();
    this.machineName = machineName;
  }

  // --- Queue responses for testing ---

  queueQuestionResponse(answer: string, wasFreeform: boolean = true): void {
    this.questionResponses.push({ answer, wasFreeform, timedOut: false });
  }

  queuePermissionDecision(decision: PermissionDecision): void {
    this.permissionDecisions.push(decision);
  }

  // --- Lifecycle ---

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // --- Channels ---

  async createProjectChannel(machineName: string, projectName: string): Promise<ChannelInfo> {
    const name = this.projectChannelName(machineName, projectName);
    const id = `C-${++this.channelIdCounter}`;
    const channelInfo: ChannelInfo = { id, name };
    this.createdChannels.push({ machineName, projectName, channelInfo });
    return channelInfo;
  }

  async archiveChannel(channelId: string): Promise<void> {
    this.archivedChannels.push(channelId);
  }

  readonly channelTopics: Array<{ channelId: string; topic: string }> = [];

  async setChannelTopic(channelId: string, topic: string): Promise<void> {
    this.channelTopics.push({ channelId, topic });
  }

  // --- Messages ---

  async sendMessage(channelId: string, content: MessageContent): Promise<MessageRef> {
    const messageId = `msg-${++this.messageIdCounter}`;
    this.sentMessages.push({ channelId, content, timestamp: new Date() });
    return { channelId, messageId };
  }

  async sendThreadReply(channelId: string, threadId: string, content: MessageContent): Promise<MessageRef> {
    const messageId = `msg-${++this.messageIdCounter}`;
    this.sentMessages.push({ channelId, content, threadId, timestamp: new Date() });
    return { channelId, messageId, threadId };
  }

  async updateMessage(ref: MessageRef, content: MessageContent): Promise<void> {
    this.updatedMessages.push({ ref, content });
  }

  async deleteMessage(_ref: MessageRef): Promise<void> {
    // No-op in test adapter
  }

  // --- Interaction ---

  async askQuestion(channelId: string, threadId: string, question: QuestionRequest): Promise<QuestionResponse> {
    const response = this.questionResponses.shift();
    if (!response) {
      const defaultResponse: QuestionResponse = { answer: '', wasFreeform: false, timedOut: true };
      this.askedQuestions.push({ channelId, threadId, question, response: defaultResponse });
      return defaultResponse;
    }
    this.askedQuestions.push({ channelId, threadId, question, response });
    return response;
  }

  async askPermission(channelId: string, threadId: string, request: PermissionRequest): Promise<PermissionDecision> {
    const decision = this.permissionDecisions.shift() ?? 'deny';
    this.askedPermissions.push({ channelId, threadId, request, decision });
    return decision;
  }

  // --- File uploads ---

  async sendFile(channelId: string, filePath: string, filename: string, initialComment?: string, threadId?: string): Promise<void> {
    this.sentFiles.push({ channelId, filePath, filename, comment: initialComment, threadId });
  }

  // --- File downloads ---

  async downloadFile(_url: string, _destPath: string): Promise<void> {
    // No-op in test adapter
  }

  // --- Thread status ---

  readonly threadStatuses: Array<{ channelId: string; threadId: string; status: string; loadingMessages?: string[] }> = [];

  async setThreadStatus(channelId: string, threadId: string, status: string, loadingMessages?: string[]): Promise<void> {
    this.threadStatuses.push({ channelId, threadId, status, loadingMessages });
  }

  // --- Presence ---

  async reportPresence(): Promise<void> {
    this.presenceReported = true;
  }

  async reportStatus(status: MachineStatus): Promise<void> {
    this.reportedStatuses.push(status);
  }

  // --- Machine registry ---

  readonly registeredMachines: Map<string, MachineStatus> = new Map();

  async registerMachine(status: MachineStatus): Promise<void> {
    this.registeredMachines.set(status.machineName, status);
  }

  async getRegisteredMachines(): Promise<MachineStatus[]> {
    return [...this.registeredMachines.values()];
  }

  // --- Multi-machine forwarding (for testing) ---

  readonly forwardedCommands: IncomingCommand[] = [];
  readonly forwardedMessages: Array<{ targetMachine: string; msg: IncomingMessage }> = [];

  // Peer adapter (simulates the registry channel link between two daemons)
  private peerAdapter: InMemoryMessagingAdapter | null = null;

  /** Connect two adapters so forwarded commands/messages reach the peer. */
  linkPeer(peer: InMemoryMessagingAdapter): void {
    this.peerAdapter = peer;
    peer.peerAdapter = this;
  }

  async forwardCommand(cmd: IncomingCommand): Promise<void> {
    this.forwardedCommands.push(cmd);
    if (this.peerAdapter && cmd.targetMachine?.toLowerCase() === this.peerAdapter.machineName.toLowerCase()) {
      await this.peerAdapter.dispatchCommand(cmd);
    }
  }

  wasPresenceReported(): boolean {
    return this.presenceReported;
  }

  // --- Simulation helpers (for tests to inject messages/commands) ---

  async simulateIncomingMessage(msg: IncomingMessage): Promise<void> {
    await this.dispatchMessage(msg);
  }

  async simulateIncomingCommand(cmd: IncomingCommand): Promise<void> {
    // Simulate multi-machine routing: if targeted to another machine, forward to peer
    if (cmd.type === 'targeted' && cmd.targetMachine &&
        cmd.targetMachine.toLowerCase() !== this.machineName.toLowerCase()) {
      this.forwardedCommands.push(cmd);
      if (this.peerAdapter && cmd.targetMachine.toLowerCase() === this.peerAdapter.machineName.toLowerCase()) {
        await this.peerAdapter.dispatchCommand(cmd);
      }
      return;
    }

    if (cmd.type === 'broadcast') {
      // True broadcast commands go to all machines
      if (['status', 'machines', 'models'].includes(cmd.command)) {
        await this.dispatchBroadcast(cmd);
        return;
      }
      // Non-broadcast commands without a prefix: route as local command
      // (matches Slack adapter's handleControlMessage behavior)
      cmd.targetMachine = this.machineName;
      await this.dispatchCommand(cmd);
      return;
    }

    await this.dispatchCommand(cmd);
  }

  /** Simulate a message in a project channel that may belong to another machine. */
  async simulateProjectMessage(msg: IncomingMessage, ownerMachine?: string): Promise<void> {
    if (ownerMachine && ownerMachine.toLowerCase() !== this.machineName.toLowerCase()) {
      this.forwardedMessages.push({ targetMachine: ownerMachine, msg });
      if (this.peerAdapter && ownerMachine.toLowerCase() === this.peerAdapter.machineName.toLowerCase()) {
        await this.peerAdapter.dispatchMessage(msg);
      }
      return;
    }
    await this.dispatchMessage(msg);
  }

  // --- Assertion helpers ---

  getLastMessage(): SentMessage | undefined {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  getMessagesForChannel(channelId: string): SentMessage[] {
    return this.sentMessages.filter((m) => m.channelId === channelId);
  }

  getThreadMessages(channelId: string, threadId: string): SentMessage[] {
    return this.sentMessages.filter((m) => m.channelId === channelId && m.threadId === threadId);
  }

  getLastQuestion(): AskedQuestion | undefined {
    return this.askedQuestions[this.askedQuestions.length - 1];
  }

  getLastPermission(): AskedPermission | undefined {
    return this.askedPermissions[this.askedPermissions.length - 1];
  }

  // --- Reset ---

  reset(): void {
    this.sentMessages.length = 0;
    this.createdChannels.length = 0;
    this.archivedChannels.length = 0;
    this.askedQuestions.length = 0;
    this.askedPermissions.length = 0;
    this.reportedStatuses.length = 0;
    this.updatedMessages.length = 0;
    this.sentFiles.length = 0;
    this.threadStatuses.length = 0;
    this.questionResponses.length = 0;
    this.permissionDecisions.length = 0;
    this.registeredMachines.clear();
    this.forwardedCommands.length = 0;
    this.forwardedMessages.length = 0;
    this.presenceReported = false;
    this.channelIdCounter = 0;
    this.messageIdCounter = 0;
  }
}
