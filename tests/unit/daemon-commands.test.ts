import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InMemoryMessagingAdapter } from '../../src/messaging/in-memory-adapter.js';
import { createLogger } from '../../src/utils/logger.js';

// Ensure a logger exists for modules that call getLogger()
createLogger('error', 'test');

// ---------------------------------------------------------------------------
// Mock heavy dependencies
// ---------------------------------------------------------------------------

vi.mock('simple-git', () => ({
  simpleGit: () => ({
    diff: vi.fn().mockResolvedValue(''),
    clone: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../src/copilot/session-orchestrator.js', () => {
  class MockSessionOrchestrator {
    private sessions = new Map<string, unknown>();
    async start() {}
    async stop() {}
    getClient() { return { listModels: async () => [
      { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', capabilities: {} },
      { id: 'gpt-5', name: 'GPT-5', capabilities: {} },
      { id: 'gpt-4.1', name: 'GPT-4.1', capabilities: {} },
    ] } as any; }
    async ensureClient() { return this.getClient(); }
    registerSession(name: string, session: unknown) { this.sessions.set(name, session); }
    getSession(name: string) { return this.sessions.get(name); }
    removeSession(name: string) { this.sessions.delete(name); }
    getActiveSessions() { return this.sessions; }
    getActiveSessionCount() { return this.sessions.size; }
    getActiveProjectNames() { return [...this.sessions.keys()]; }
    async listAllSessions() { return []; }
  }
  return { SessionOrchestrator: MockSessionOrchestrator };
});

vi.mock('../../src/copilot/agent-session.js', () => {
  class MockAgentSession {
    private _idle = true;
    private _disconnected = false;
    readonly events = { on: vi.fn(), emit: vi.fn(), off: vi.fn() };
    async initialize() {}
    async handlePrompt() { this._idle = false; }
    async abort() { this._idle = true; }
    async disconnect() { this._disconnected = true; this._idle = true; }
    isIdle() { return this._idle; }
    isDisconnected() { return this._disconnected; }
    getSessionId() { return 'mock-session-id'; }
    async getHistory() { return []; }
  }
  return { AgentSession: MockAgentSession };
});

const { AirTrafficDaemon } = await import('../../src/daemon.js');

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
    airTraffic: {
      machineName: 'test-machine',
      projectsDir: overrides.projectsDir,
      dataDir: overrides.dataDir,
      defaultModel: 'claude-sonnet-4.5',
      logLevel: 'error' as const,
    },
  };
}

function makeCommand(
  command: string,
  args: string[] = [],
  overrides: Partial<{
    channelId: string;
    channelName: string;
    userId: string;
  }> = {},
) {
  return {
    command,
    args,
    rawText: `${command} ${args.join(' ')}`.trim(),
    channelId: overrides.channelId ?? 'C-control',
    channelName: overrides.channelName ?? 'air-traffic-control',
    userId: overrides.userId ?? 'U-1',
    messageId: 'msg-test',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Interactive pickers (parameter-less commands)', () => {
  let tmpDir: string;
  let adapter: InMemoryMessagingAdapter;
  let daemon: InstanceType<typeof AirTrafficDaemon>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atc-pick-'));
    const projectsDir = path.join(tmpDir, 'projects');
    const dataDir = path.join(tmpDir, 'data');
    await fs.mkdir(projectsDir, { recursive: true });
    await fs.mkdir(dataDir, { recursive: true });

    adapter = new InMemoryMessagingAdapter('test-machine');
    const config = makeConfig({ projectsDir, dataDir });
    daemon = new AirTrafficDaemon(config, adapter);
    await daemon.start();
  });

  afterEach(async () => {
    await daemon.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // --- delete without args → project picker ---

  it('delete without args shows project picker', async () => {
    // Create a project first
    await adapter.simulateIncomingCommand(makeCommand('create', ['picker-test']));

    // Queue a picker response
    adapter.queueQuestionResponse('picker-test');

    // Delete without args
    await adapter.simulateIncomingCommand(makeCommand('delete'));

    // Should have asked a question with project name as choice
    const question = adapter.askedQuestions.find(
      (q) => q.question.question.includes('delete'),
    );
    expect(question).toBeDefined();
    expect(question!.question.choices).toContain('picker-test');

    // Verify project was deleted
    const last = adapter.getLastMessage();
    expect(last!.content.text).toMatch(/deleted/i);
  });

  it('delete without args shows message when no projects exist', async () => {
    await adapter.simulateIncomingCommand(makeCommand('delete'));

    const last = adapter.getLastMessage();
    expect(last!.content.text).toMatch(/no projects/i);
  });

  // --- model without args → model picker ---

  it('model without args shows model picker in project channel', async () => {
    // Create a project
    await adapter.simulateIncomingCommand(makeCommand('create', ['model-test']));
    const project = await daemon.getProjectManager().getProject('model-test');

    // Queue a model selection
    adapter.queueQuestionResponse('gpt-5');

    // Send model command without args from the project channel
    await adapter.simulateIncomingCommand(makeCommand('model', [], {
      channelId: project.channelId,
      channelName: `atc-test-machine-model-test`,
    }));

    // Should have asked a question with model choices
    const question = adapter.askedQuestions.find(
      (q) => q.question.question.includes('model'),
    );
    expect(question).toBeDefined();
    expect(question!.question.choices).toBeDefined();
    expect(question!.question.choices!.length).toBeGreaterThan(0);

    // Verify model was set
    const msg = adapter.getLastMessage();
    expect(msg!.content.text).toMatch(/gpt-5/);
  });

  // --- mode without args → mode picker ---

  it('mode without args shows mode picker in project channel', async () => {
    // Create a project
    await adapter.simulateIncomingCommand(makeCommand('create', ['mode-test']));
    const project = await daemon.getProjectManager().getProject('mode-test');

    // Queue a mode selection
    adapter.queueQuestionResponse('plan — Plan — creates a plan for review before implementing');

    // Send mode command without args
    await adapter.simulateIncomingCommand(makeCommand('mode', [], {
      channelId: project.channelId,
      channelName: `atc-test-machine-mode-test`,
    }));

    // Should have asked a question with mode choices
    const question = adapter.askedQuestions.find(
      (q) => q.question.question.includes('mode'),
    );
    expect(question).toBeDefined();
    expect(question!.question.choices).toBeDefined();
    expect(question!.question.choices!.length).toBe(3);

    // Verify mode was set
    const msg = adapter.getLastMessage();
    expect(msg!.content.text).toMatch(/plan/);
  });

  // --- agent without args → freeform prompt ---

  it('agent without args prompts for agent name', async () => {
    // Create a project
    await adapter.simulateIncomingCommand(makeCommand('create', ['agent-test']));
    const project = await daemon.getProjectManager().getProject('agent-test');

    // Queue a freeform response
    adapter.queueQuestionResponse('my-custom-agent');

    // Send agent command without args
    await adapter.simulateIncomingCommand(makeCommand('agent', [], {
      channelId: project.channelId,
      channelName: `atc-test-machine-agent-test`,
    }));

    // Should have asked a question
    const question = adapter.askedQuestions.find(
      (q) => q.question.question.includes('agent'),
    );
    expect(question).toBeDefined();

    // Verify agent was set
    const msg = adapter.getLastMessage();
    expect(msg!.content.text).toMatch(/my-custom-agent/);
  });

  // --- config without args → guided wizard ---

  it('config without any args starts guided wizard', async () => {
    // Create a project
    await adapter.simulateIncomingCommand(makeCommand('create', ['config-test']));

    // Queue responses: project picker → field picker → model picker
    adapter.queueQuestionResponse('config-test');
    adapter.queueQuestionResponse('model');
    adapter.queueQuestionResponse('gpt-5');

    // Send config without args
    await adapter.simulateIncomingCommand(makeCommand('config'));

    // Should have asked 3 questions
    expect(adapter.askedQuestions.length).toBeGreaterThanOrEqual(3);

    // First question: project picker
    const projectQ = adapter.askedQuestions.find(
      (q) => q.question.question.includes('configure'),
    );
    expect(projectQ).toBeDefined();
    expect(projectQ!.question.choices).toContain('config-test');

    // Verify config was updated
    const msg = adapter.getLastMessage();
    expect(msg!.content.text).toMatch(/updated/i);
  });

  it('config without field shows field picker', async () => {
    // Create project
    await adapter.simulateIncomingCommand(makeCommand('create', ['field-test']));

    // Queue field selection + value
    adapter.queueQuestionResponse('model');
    adapter.queueQuestionResponse('gpt-5');

    // Send config with project but no field
    await adapter.simulateIncomingCommand(makeCommand('config', ['field-test']));

    const fieldQ = adapter.askedQuestions.find(
      (q) => q.question.choices?.includes('model'),
    );
    expect(fieldQ).toBeDefined();
  });

  it('config permissions without value shows category + mode picker', async () => {
    // Create project
    await adapter.simulateIncomingCommand(makeCommand('create', ['perm-test']));

    // Queue: category picker → mode picker
    adapter.queueQuestionResponse('shell');
    adapter.queueQuestionResponse('ask');

    // Send config with project + permissions but no value
    await adapter.simulateIncomingCommand(makeCommand('config', ['perm-test', 'permissions']));

    // Should have asked category question
    const catQ = adapter.askedQuestions.find(
      (q) => q.question.choices?.includes('shell'),
    );
    expect(catQ).toBeDefined();

    // Should have asked mode question
    const modeQ = adapter.askedQuestions.find(
      (q) => q.question.choices?.includes('ask'),
    );
    expect(modeQ).toBeDefined();
  });
});

describe('Command routing in control channel', () => {
  let tmpDir: string;
  let adapter: InMemoryMessagingAdapter;
  let daemon: InstanceType<typeof AirTrafficDaemon>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atc-route-'));
    const projectsDir = path.join(tmpDir, 'projects');
    const dataDir = path.join(tmpDir, 'data');
    await fs.mkdir(projectsDir, { recursive: true });
    await fs.mkdir(dataDir, { recursive: true });

    adapter = new InMemoryMessagingAdapter('test-machine');
    const config = makeConfig({ projectsDir, dataDir });
    daemon = new AirTrafficDaemon(config, adapter);
    await daemon.start();
  });

  afterEach(async () => {
    await daemon.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('create command works from control channel', async () => {
    await adapter.simulateIncomingCommand(makeCommand('create', ['route-test']));
    const messages = adapter.getMessagesForChannel('C-control');
    const createMsg = messages.find(m => m.content.text.includes('✅'));
    expect(createMsg).toBeDefined();
    expect(createMsg!.content.text).toMatch(/route-test/);
  });

  it('list command works from control channel', async () => {
    await adapter.simulateIncomingCommand(makeCommand('create', ['list-proj']));
    adapter.reset();

    await adapter.simulateIncomingCommand(makeCommand('list'));
    const msg = adapter.getLastMessage();
    expect(msg!.content.text).toMatch(/list-proj/);
  });

  it('help command returns help text', async () => {
    await adapter.simulateIncomingCommand(makeCommand('help'));
    const msg = adapter.getLastMessage();
    expect(msg!.content.text).toMatch(/Air Traffic Commands/);
    expect(msg!.content.text).toMatch(/create/);
    expect(msg!.content.text).toMatch(/delete/);
  });

  it('models command lists available models', async () => {
    await adapter.simulateIncomingCommand(makeCommand('models'));
    const msg = adapter.getLastMessage();
    expect(msg!.content.text).toMatch(/Available models/);
    expect(msg!.content.text).toMatch(/claude/i);
  });

  it('sessions command runs without error', async () => {
    await adapter.simulateIncomingCommand(makeCommand('sessions'));
    // Should not throw — either shows sessions or "no sessions" message
    const msg = adapter.getLastMessage();
    expect(msg).toBeDefined();
  });
});

describe('Project channel command routing', () => {
  let tmpDir: string;
  let adapter: InMemoryMessagingAdapter;
  let daemon: InstanceType<typeof AirTrafficDaemon>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atc-proj-'));
    const projectsDir = path.join(tmpDir, 'projects');
    const dataDir = path.join(tmpDir, 'data');
    await fs.mkdir(projectsDir, { recursive: true });
    await fs.mkdir(dataDir, { recursive: true });

    adapter = new InMemoryMessagingAdapter('test-machine');
    const config = makeConfig({ projectsDir, dataDir });
    daemon = new AirTrafficDaemon(config, adapter);
    await daemon.start();

    // Create a test project for project-channel commands
    await adapter.simulateIncomingCommand(makeCommand('create', ['my-proj']));
    adapter.reset();
  });

  afterEach(async () => {
    await daemon.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('status command shows project info', async () => {
    const project = await daemon.getProjectManager().getProject('my-proj');
    await adapter.simulateIncomingCommand(makeCommand('status', [], {
      channelId: project.channelId,
      channelName: 'atc-test-machine-my-proj',
    }));
    const msg = adapter.getLastMessage();
    expect(msg!.content.text).toMatch(/my-proj/);
    expect(msg!.content.text).toMatch(/Model/i);
  });

  it('model command with args sets model directly', async () => {
    const project = await daemon.getProjectManager().getProject('my-proj');
    await adapter.simulateIncomingCommand(makeCommand('model', ['gpt-5'], {
      channelId: project.channelId,
      channelName: 'atc-test-machine-my-proj',
    }));
    const msg = adapter.getLastMessage();
    expect(msg!.content.text).toMatch(/gpt-5/);
    expect(msg!.content.text).toMatch(/✅/);
  });

  it('mode command with args sets mode directly', async () => {
    const project = await daemon.getProjectManager().getProject('my-proj');
    await adapter.simulateIncomingCommand(makeCommand('mode', ['plan'], {
      channelId: project.channelId,
      channelName: 'atc-test-machine-my-proj',
    }));
    const msg = adapter.getLastMessage();
    expect(msg!.content.text).toMatch(/plan/);
    expect(msg!.content.text).toMatch(/✅/);
  });

  it('mode rejects invalid mode', async () => {
    const project = await daemon.getProjectManager().getProject('my-proj');
    await adapter.simulateIncomingCommand(makeCommand('mode', ['foobar'], {
      channelId: project.channelId,
      channelName: 'atc-test-machine-my-proj',
    }));
    const msg = adapter.getLastMessage();
    expect(msg!.content.text).toMatch(/Unknown mode/i);
  });

  it('agent command with args sets agent directly', async () => {
    const project = await daemon.getProjectManager().getProject('my-proj');
    await adapter.simulateIncomingCommand(makeCommand('agent', ['my-agent'], {
      channelId: project.channelId,
      channelName: 'atc-test-machine-my-proj',
    }));
    const msg = adapter.getLastMessage();
    expect(msg!.content.text).toMatch(/my-agent/);
    expect(msg!.content.text).toMatch(/✅/);
  });

  it('abort without active session reports no session', async () => {
    const project = await daemon.getProjectManager().getProject('my-proj');
    await adapter.simulateIncomingCommand(makeCommand('abort', [], {
      channelId: project.channelId,
      channelName: 'atc-test-machine-my-proj',
    }));
    const msg = adapter.getLastMessage();
    expect(msg!.content.text).toMatch(/no active session/i);
  });

  it('leave without active session reports no session', async () => {
    const project = await daemon.getProjectManager().getProject('my-proj');
    await adapter.simulateIncomingCommand(makeCommand('leave', [], {
      channelId: project.channelId,
      channelName: 'atc-test-machine-my-proj',
    }));
    const msg = adapter.getLastMessage();
    expect(msg!.content.text).toMatch(/no active session/i);
  });
});
