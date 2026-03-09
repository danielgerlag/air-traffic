import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryMessagingAdapter } from '../../../src/messaging/in-memory-adapter.js';

describe('InMemoryMessagingAdapter', () => {
  let adapter: InMemoryMessagingAdapter;

  beforeEach(() => {
    adapter = new InMemoryMessagingAdapter('test-machine');
  });

  describe('lifecycle', () => {
    it('should start disconnected', () => {
      expect(adapter.isConnected()).toBe(false);
    });

    it('should connect and disconnect', async () => {
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe('channels', () => {
    it('should create project channels with correct naming', async () => {
      const channel = await adapter.createProjectChannel('desktop', 'my-app');
      expect(channel.name).toBe('wm-desktop-my-app');
      expect(channel.id).toBeTruthy();
      expect(adapter.createdChannels).toHaveLength(1);
      expect(adapter.createdChannels[0].machineName).toBe('desktop');
      expect(adapter.createdChannels[0].projectName).toBe('my-app');
    });

    it('should archive channels', async () => {
      await adapter.archiveChannel('C-123');
      expect(adapter.archivedChannels).toContain('C-123');
    });
  });

  describe('messages', () => {
    it('should send and record messages', async () => {
      const ref = await adapter.sendMessage('C-1', { text: 'Hello world' });
      expect(ref.channelId).toBe('C-1');
      expect(ref.messageId).toBeTruthy();
      expect(adapter.sentMessages).toHaveLength(1);
      expect(adapter.sentMessages[0].content.text).toBe('Hello world');
    });

    it('should send thread replies', async () => {
      const ref = await adapter.sendThreadReply('C-1', 'thread-1', { text: 'Reply' });
      expect(ref.threadId).toBe('thread-1');
      expect(adapter.sentMessages).toHaveLength(1);
      expect(adapter.sentMessages[0].threadId).toBe('thread-1');
    });

    it('should update messages', async () => {
      const ref = { channelId: 'C-1', messageId: 'msg-1' };
      await adapter.updateMessage(ref, { text: 'Updated' });
      expect(adapter.updatedMessages).toHaveLength(1);
      expect(adapter.updatedMessages[0].content.text).toBe('Updated');
    });

    it('should get last message', async () => {
      await adapter.sendMessage('C-1', { text: 'First' });
      await adapter.sendMessage('C-1', { text: 'Second' });
      const last = adapter.getLastMessage();
      expect(last?.content.text).toBe('Second');
    });

    it('should filter messages by channel', async () => {
      await adapter.sendMessage('C-1', { text: 'In C-1' });
      await adapter.sendMessage('C-2', { text: 'In C-2' });
      await adapter.sendMessage('C-1', { text: 'Also in C-1' });
      const msgs = adapter.getMessagesForChannel('C-1');
      expect(msgs).toHaveLength(2);
    });

    it('should filter thread messages', async () => {
      await adapter.sendThreadReply('C-1', 'thread-1', { text: 'Thread msg' });
      await adapter.sendMessage('C-1', { text: 'Top level' });
      const msgs = adapter.getThreadMessages('C-1', 'thread-1');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content.text).toBe('Thread msg');
    });
  });

  describe('questions', () => {
    it('should return queued question response', async () => {
      adapter.queueQuestionResponse('Yes');
      const response = await adapter.askQuestion('C-1', 'thread-1', {
        question: 'Continue?',
        choices: ['Yes', 'No'],
      });
      expect(response.answer).toBe('Yes');
      expect(response.timedOut).toBe(false);
      expect(adapter.askedQuestions).toHaveLength(1);
      expect(adapter.askedQuestions[0].question.question).toBe('Continue?');
    });

    it('should timeout when no response queued', async () => {
      const response = await adapter.askQuestion('C-1', 'thread-1', {
        question: 'Continue?',
      });
      expect(response.timedOut).toBe(true);
      expect(response.answer).toBe('');
    });

    it('should consume responses in order', async () => {
      adapter.queueQuestionResponse('First');
      adapter.queueQuestionResponse('Second');
      const r1 = await adapter.askQuestion('C-1', 't1', { question: 'Q1' });
      const r2 = await adapter.askQuestion('C-1', 't2', { question: 'Q2' });
      expect(r1.answer).toBe('First');
      expect(r2.answer).toBe('Second');
    });
  });

  describe('permissions', () => {
    it('should return queued permission decision', async () => {
      adapter.queuePermissionDecision('allow');
      const decision = await adapter.askPermission('C-1', 'thread-1', {
        toolName: 'shell',
        toolCategory: 'shell',
        description: 'Run npm install',
      });
      expect(decision).toBe('allow');
      expect(adapter.askedPermissions).toHaveLength(1);
    });

    it('should default to deny when no decision queued', async () => {
      const decision = await adapter.askPermission('C-1', 'thread-1', {
        toolName: 'shell',
        toolCategory: 'shell',
        description: 'Run rm -rf /',
      });
      expect(decision).toBe('deny');
    });
  });

  describe('presence', () => {
    it('should track presence reporting', async () => {
      expect(adapter.wasPresenceReported()).toBe(false);
      await adapter.reportPresence();
      expect(adapter.wasPresenceReported()).toBe(true);
    });

    it('should record status reports', async () => {
      await adapter.reportStatus({
        machineName: 'test-machine',
        online: true,
        activeSessions: 2,
        projects: ['app1', 'app2'],
        lastSeen: new Date(),
      });
      expect(adapter.reportedStatuses).toHaveLength(1);
      expect(adapter.reportedStatuses[0].activeSessions).toBe(2);
    });
  });

  describe('event dispatching', () => {
    it('should dispatch incoming messages to handlers', async () => {
      const received: string[] = [];
      adapter.onMessage((msg) => { received.push(msg.text); });

      await adapter.simulateIncomingMessage({
        channelId: 'C-1',
        channelName: 'wm-test-machine-app',
        userId: 'U-1',
        text: 'Add authentication',
        messageId: 'msg-1',
        timestamp: new Date(),
      });

      expect(received).toEqual(['Add authentication']);
    });

    it('should dispatch targeted commands to command handlers', async () => {
      const received: string[] = [];
      adapter.onCommand((cmd) => { received.push(cmd.command); });

      await adapter.simulateIncomingCommand({
        type: 'targeted',
        targetMachine: 'test-machine',
        command: 'create',
        args: ['my-app'],
        rawText: 'test-machine: create my-app',
        channelId: 'C-control',
        channelName: 'wingman-control',
        userId: 'U-1',
        messageId: 'msg-1',
      });

      expect(received).toEqual(['create']);
    });

    it('should dispatch broadcast commands to broadcast handlers', async () => {
      const received: string[] = [];
      adapter.onBroadcast((cmd) => { received.push(cmd.command); });

      await adapter.simulateIncomingCommand({
        type: 'broadcast',
        command: 'status',
        args: [],
        rawText: 'status',
        channelId: 'C-control',
        channelName: 'wingman-control',
        userId: 'U-1',
        messageId: 'msg-1',
      });

      expect(received).toEqual(['status']);
    });
  });

  describe('reset', () => {
    it('should clear all recorded state', async () => {
      await adapter.sendMessage('C-1', { text: 'msg' });
      await adapter.createProjectChannel('m', 'p');
      adapter.queueQuestionResponse('yes');
      await adapter.askQuestion('C-1', 't1', { question: 'Q?' });
      await adapter.reportPresence();

      adapter.reset();

      expect(adapter.sentMessages).toHaveLength(0);
      expect(adapter.createdChannels).toHaveLength(0);
      expect(adapter.askedQuestions).toHaveLength(0);
      expect(adapter.wasPresenceReported()).toBe(false);
    });
  });
});
