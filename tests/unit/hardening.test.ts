import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InMemoryMessagingAdapter } from '../../src/messaging/in-memory-adapter.js';
import { ProjectManager } from '../../src/projects/project-manager.js';
import { createLogger } from '../../src/utils/logger.js';

// Ensure a logger exists for modules that call getLogger()
createLogger('error', 'test');

// ---------------------------------------------------------------------------
// Mock heavy dependencies that WingmanDaemon imports
// ---------------------------------------------------------------------------

// Mock simple-git (used by daemon's !diff command)
vi.mock('simple-git', () => ({
  simpleGit: () => ({
    diff: vi.fn().mockResolvedValue(''),
    clone: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock the SessionOrchestrator so we don't need a real CopilotClient
vi.mock('../../src/copilot/session-orchestrator.js', () => {
  class MockSessionOrchestrator {
    private sessions = new Map<string, unknown>();
    async start() {}
    async stop() {}
    getClient() { return {} as any; }
    registerSession(name: string, session: unknown) { this.sessions.set(name, session); }
    getSession(name: string) { return this.sessions.get(name); }
    removeSession(name: string) { this.sessions.delete(name); }
    getActiveSessions() { return this.sessions; }
    getActiveSessionCount() { return this.sessions.size; }
    getActiveProjectNames() { return [...this.sessions.keys()]; }
  }
  return { SessionOrchestrator: MockSessionOrchestrator };
});

// Mock AgentSession so we never touch the real Copilot SDK
vi.mock('../../src/copilot/agent-session.js', () => {
  class MockAgentSession {
    private _idle = true;
    private _disconnected = false;
    async initialize() {}
    async handlePrompt() { this._idle = false; }
    async abort() { this._idle = true; }
    async disconnect() { this._disconnected = true; this._idle = true; }
    isIdle() { return this._idle; }
    isDisconnected() { return this._disconnected; }
  }
  return { AgentSession: MockAgentSession };
});

// Now import WingmanDaemon (after mocks are in place)
const { WingmanDaemon } = await import('../../src/daemon.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: { projectsDir: string; dataDir: string }) {
  return {
    slack: {
      botToken: 'xoxb-test',
      appToken: 'xapp-test',
      signingSecret: 'test-secret',
    },
    wingman: {
      machineName: 'test-machine',
      projectsDir: overrides.projectsDir,
      dataDir: overrides.dataDir,
      defaultModel: 'claude-sonnet-4.5',
      logLevel: 'error' as const,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Hardening', () => {
  // ---- Timeout / default behaviour of InMemoryMessagingAdapter ----

  describe('InMemoryMessagingAdapter timeout defaults', () => {
    let adapter: InMemoryMessagingAdapter;

    beforeEach(() => {
      adapter = new InMemoryMessagingAdapter('test-machine');
    });

    it('askQuestion returns timedOut: true when no response is queued', async () => {
      const response = await adapter.askQuestion('C-1', 'thread-1', {
        question: 'Pick a colour',
        choices: ['Red', 'Blue'],
      });
      expect(response.timedOut).toBe(true);
      expect(response.answer).toBe('');
    });

    it('askPermission defaults to deny when no decision is queued', async () => {
      const decision = await adapter.askPermission('C-1', 'thread-1', {
        toolName: 'shell',
        toolCategory: 'shell',
        description: 'Run a command',
      });
      expect(decision).toBe('deny');
    });

    it('askQuestion returns queued response and does not time out', async () => {
      adapter.queueQuestionResponse('Blue');
      const response = await adapter.askQuestion('C-1', 'thread-1', {
        question: 'Pick a colour',
      });
      expect(response.timedOut).toBe(false);
      expect(response.answer).toBe('Blue');
    });

    it('askPermission returns queued decision', async () => {
      adapter.queuePermissionDecision('allow');
      const decision = await adapter.askPermission('C-1', 'thread-1', {
        toolName: 'edit',
        toolCategory: 'fileEdit',
        description: 'Edit a file',
      });
      expect(decision).toBe('allow');
    });
  });

  // ---- Daemon error resilience ----

  describe('WingmanDaemon error resilience', () => {
    let tmpDir: string;
    let adapter: InMemoryMessagingAdapter;
    let daemon: InstanceType<typeof WingmanDaemon>;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wingman-hard-'));
      const projectsDir = path.join(tmpDir, 'projects');
      const dataDir = path.join(tmpDir, 'data');
      await fs.mkdir(projectsDir, { recursive: true });
      await fs.mkdir(dataDir, { recursive: true });

      adapter = new InMemoryMessagingAdapter('test-machine');
      const config = makeConfig({ projectsDir, dataDir });
      daemon = new WingmanDaemon(config, adapter);
      await daemon.start();
    });

    afterEach(async () => {
      await daemon.stop();
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('posts an error message when a create command has an invalid name', async () => {
      // "INVALID" is uppercase → ProjectManager.validateProjectName rejects it
      await adapter.simulateIncomingCommand({
        type: 'targeted',
        targetMachine: 'test-machine',
        command: 'create',
        args: ['INVALID_NAME'],
        rawText: 'test-machine: create INVALID_NAME',
        channelId: 'C-control',
        channelName: 'wingman-control',
        userId: 'U-1',
        messageId: 'msg-1',
      });

      const last = adapter.getLastMessage();
      expect(last).toBeDefined();
      expect(last!.content.text).toMatch(/Error/i);
    });

    it('continues processing commands after a failure', async () => {
      // First command: invalid → error
      await adapter.simulateIncomingCommand({
        type: 'targeted',
        targetMachine: 'test-machine',
        command: 'create',
        args: ['BAD!'],
        rawText: 'test-machine: create BAD!',
        channelId: 'C-control',
        channelName: 'wingman-control',
        userId: 'U-1',
        messageId: 'msg-1',
      });

      const errorMsg = adapter.getLastMessage();
      expect(errorMsg!.content.text).toMatch(/Error/i);

      // Second command: valid → should succeed
      await adapter.simulateIncomingCommand({
        type: 'targeted',
        targetMachine: 'test-machine',
        command: 'create',
        args: ['good-project'],
        rawText: 'test-machine: create good-project',
        channelId: 'C-control',
        channelName: 'wingman-control',
        userId: 'U-2',
        messageId: 'msg-2',
      });

      const successMsg = adapter.getLastMessage();
      expect(successMsg!.content.text).toMatch(/good-project/);
      expect(successMsg!.content.text).toMatch(/✅/);
    });

    it('posts an error when deleting a nonexistent project', async () => {
      await adapter.simulateIncomingCommand({
        type: 'targeted',
        targetMachine: 'test-machine',
        command: 'delete',
        args: ['no-such-project'],
        rawText: 'test-machine: delete no-such-project',
        channelId: 'C-control',
        channelName: 'wingman-control',
        userId: 'U-1',
        messageId: 'msg-1',
      });

      const last = adapter.getLastMessage();
      expect(last).toBeDefined();
      expect(last!.content.text).toMatch(/Error/i);
    });

    it('handles broadcast commands without crashing', async () => {
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

      // Status is now sent directly to the requesting channel
      const statusMsg = adapter.sentMessages.find(m => m.content.text.includes('online'));
      expect(statusMsg).toBeDefined();
    });
  });

  // ---- Session cleanup on project deletion ----

  describe('Session cleanup on project deletion', () => {
    let tmpDir: string;
    let adapter: InMemoryMessagingAdapter;
    let daemon: InstanceType<typeof WingmanDaemon>;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wingman-sess-'));
      const projectsDir = path.join(tmpDir, 'projects');
      const dataDir = path.join(tmpDir, 'data');
      await fs.mkdir(projectsDir, { recursive: true });
      await fs.mkdir(dataDir, { recursive: true });

      adapter = new InMemoryMessagingAdapter('test-machine');
      const config = makeConfig({ projectsDir, dataDir });
      daemon = new WingmanDaemon(config, adapter);
      await daemon.start();
    });

    afterEach(async () => {
      await daemon.stop();
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('removes orchestrator session when a project is deleted', async () => {
      // Create a project
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

      const createMsg = adapter.getLastMessage();
      expect(createMsg!.content.text).toMatch(/✅/);

      // Delete the project
      await adapter.simulateIncomingCommand({
        type: 'targeted',
        targetMachine: 'test-machine',
        command: 'delete',
        args: ['my-app'],
        rawText: 'test-machine: delete my-app',
        channelId: 'C-control',
        channelName: 'wingman-control',
        userId: 'U-1',
        messageId: 'msg-2',
      });

      const deleteMsg = adapter.getLastMessage();
      expect(deleteMsg!.content.text).toMatch(/deleted/i);

      // Channel was archived
      expect(adapter.archivedChannels.length).toBeGreaterThanOrEqual(1);
    });

    it('create → delete → re-create works without errors', async () => {
      // Create
      await adapter.simulateIncomingCommand({
        type: 'targeted',
        targetMachine: 'test-machine',
        command: 'create',
        args: ['cycle-test'],
        rawText: 'test-machine: create cycle-test',
        channelId: 'C-control',
        channelName: 'wingman-control',
        userId: 'U-1',
        messageId: 'msg-1',
      });
      expect(adapter.getLastMessage()!.content.text).toMatch(/✅/);

      // Delete
      await adapter.simulateIncomingCommand({
        type: 'targeted',
        targetMachine: 'test-machine',
        command: 'delete',
        args: ['cycle-test'],
        rawText: 'test-machine: delete cycle-test',
        channelId: 'C-control',
        channelName: 'wingman-control',
        userId: 'U-1',
        messageId: 'msg-2',
      });
      expect(adapter.getLastMessage()!.content.text).toMatch(/deleted/i);

      // Re-create
      await adapter.simulateIncomingCommand({
        type: 'targeted',
        targetMachine: 'test-machine',
        command: 'create',
        args: ['cycle-test'],
        rawText: 'test-machine: create cycle-test',
        channelId: 'C-control',
        channelName: 'wingman-control',
        userId: 'U-1',
        messageId: 'msg-3',
      });
      expect(adapter.getLastMessage()!.content.text).toMatch(/✅/);
    });
  });
});
