import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InMemoryMessagingAdapter } from '../../src/messaging/in-memory-adapter.js';
import { createLogger } from '../../src/utils/logger.js';

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
    getClient() {
      return {
        listModels: async () => [
          { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', capabilities: {} },
          { id: 'gpt-5', name: 'GPT-5', capabilities: {} },
        ],
      } as any;
    }
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

function makeConfig(machineName: string, dirs: { projectsDir: string; dataDir: string }) {
  return {
    slack: {
      botToken: 'xoxb-test',
      appToken: 'xapp-test',
      signingSecret: 'test-secret',
    },
    airTraffic: {
      machineName,
      projectsDir: dirs.projectsDir,
      dataDir: dirs.dataDir,
      defaultModel: 'claude-sonnet-4.5',
      logLevel: 'error' as const,
    },
  };
}

function makeCommand(
  command: string,
  args: string[] = [],
  overrides: Partial<{
    type: 'targeted' | 'broadcast';
    targetMachine: string;
    channelId: string;
    channelName: string;
    userId: string;
  }> = {},
) {
  return {
    type: overrides.type ?? ('targeted' as const),
    targetMachine: overrides.targetMachine ?? 'desktop',
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
// Multi-machine integration tests
// ---------------------------------------------------------------------------

describe('Multi-machine routing', () => {
  let tmpDir: string;
  let desktopAdapter: InMemoryMessagingAdapter;
  let laptopAdapter: InMemoryMessagingAdapter;
  let desktopDaemon: InstanceType<typeof AirTrafficDaemon>;
  let laptopDaemon: InstanceType<typeof AirTrafficDaemon>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atc-multi-'));

    // Desktop machine
    const desktopProjects = path.join(tmpDir, 'desktop', 'projects');
    const desktopData = path.join(tmpDir, 'desktop', 'data');
    await fs.mkdir(desktopProjects, { recursive: true });
    await fs.mkdir(desktopData, { recursive: true });

    desktopAdapter = new InMemoryMessagingAdapter('desktop');
    desktopDaemon = new AirTrafficDaemon(
      makeConfig('desktop', { projectsDir: desktopProjects, dataDir: desktopData }),
      desktopAdapter,
    );

    // Laptop machine
    const laptopProjects = path.join(tmpDir, 'laptop', 'projects');
    const laptopData = path.join(tmpDir, 'laptop', 'data');
    await fs.mkdir(laptopProjects, { recursive: true });
    await fs.mkdir(laptopData, { recursive: true });

    laptopAdapter = new InMemoryMessagingAdapter('laptop');
    laptopDaemon = new AirTrafficDaemon(
      makeConfig('laptop', { projectsDir: laptopProjects, dataDir: laptopData }),
      laptopAdapter,
    );

    // Link the two adapters for cross-daemon forwarding
    desktopAdapter.linkPeer(laptopAdapter);

    // Start both daemons
    await desktopDaemon.start();
    await laptopDaemon.start();

    // Register both machines in both adapters (simulates heartbeat)
    const desktopStatus = {
      machineName: 'desktop',
      online: true,
      activeSessions: 0,
      projects: [] as string[],
      lastSeen: new Date(),
    };
    const laptopStatus = {
      machineName: 'laptop',
      online: true,
      activeSessions: 0,
      projects: [] as string[],
      lastSeen: new Date(),
    };
    await desktopAdapter.registerMachine(desktopStatus);
    await desktopAdapter.registerMachine(laptopStatus);
    await laptopAdapter.registerMachine(desktopStatus);
    await laptopAdapter.registerMachine(laptopStatus);
  });

  afterEach(async () => {
    await desktopDaemon.stop();
    await laptopDaemon.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Create command routing
  // -----------------------------------------------------------------------

  describe('create command routing', () => {
    it('create on local machine succeeds and shows machine name', async () => {
      await desktopAdapter.simulateIncomingCommand(
        makeCommand('create', ['myapp'], { targetMachine: 'desktop' }),
      );

      const msg = desktopAdapter.getLastMessage();
      expect(msg).toBeDefined();
      expect(msg!.content.text).toMatch(/myapp/i);
      expect(msg!.content.text).toMatch(/desktop/i);
      expect(msg!.content.text).toMatch(/✅/);
    });

    it('targeted create for other machine is forwarded, not handled locally', async () => {
      // Simulate: "laptop: create myapp" received by the desktop daemon
      await desktopAdapter.simulateIncomingCommand(
        makeCommand('create', ['myapp'], { targetMachine: 'laptop' }),
      );

      // Desktop should NOT have created the project
      const desktopProjects = await desktopDaemon.getProjectManager().listProjects();
      expect(desktopProjects).toHaveLength(0);

      // Command was forwarded
      expect(desktopAdapter.forwardedCommands).toHaveLength(1);
      expect(desktopAdapter.forwardedCommands[0].targetMachine).toBe('laptop');
      expect(desktopAdapter.forwardedCommands[0].command).toBe('create');

      // Laptop should have received and created it
      const laptopProjects = await laptopDaemon.getProjectManager().listProjects();
      expect(laptopProjects).toHaveLength(1);
      expect(laptopProjects[0].name).toBe('myapp');
    });

    it('targeted create response is sent from the correct machine', async () => {
      await desktopAdapter.simulateIncomingCommand(
        makeCommand('create', ['myapp'], { targetMachine: 'laptop' }),
      );

      // The laptop adapter should have the success message (since it processed the command)
      const laptopMsg = laptopAdapter.getLastMessage();
      expect(laptopMsg).toBeDefined();
      expect(laptopMsg!.content.text).toMatch(/laptop/i);
      expect(laptopMsg!.content.text).toMatch(/myapp/i);
    });

    it('unprefixed create asks which machine when multiple are online', async () => {
      // Queue machine picker answer: user picks "desktop"
      desktopAdapter.queueQuestionResponse('desktop');

      await desktopAdapter.simulateIncomingCommand(
        makeCommand('create', ['myapp'], { type: 'broadcast', targetMachine: '' }),
      );

      // Should have asked which machine
      const question = desktopAdapter.askedQuestions.find(
        q => q.question.question.includes('machine'),
      );
      expect(question).toBeDefined();
      expect(question!.question.choices).toContain('desktop');
      expect(question!.question.choices).toContain('laptop');

      // Desktop created the project (user picked desktop)
      const projects = await desktopDaemon.getProjectManager().listProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('myapp');
    });

    it('unprefixed create forwards to selected remote machine', async () => {
      // Queue machine picker answer: user picks "laptop"
      desktopAdapter.queueQuestionResponse('laptop');

      await desktopAdapter.simulateIncomingCommand(
        makeCommand('create', ['myapp'], { type: 'broadcast', targetMachine: '' }),
      );

      // Desktop should NOT have created it
      const desktopProjects = await desktopDaemon.getProjectManager().listProjects();
      expect(desktopProjects).toHaveLength(0);

      // Should be forwarded to laptop
      expect(desktopAdapter.forwardedCommands).toHaveLength(1);
      expect(desktopAdapter.forwardedCommands[0].targetMachine).toBe('laptop');

      // Laptop should have the project
      const laptopProjects = await laptopDaemon.getProjectManager().listProjects();
      expect(laptopProjects).toHaveLength(1);
      expect(laptopProjects[0].name).toBe('myapp');
    });
  });

  // -----------------------------------------------------------------------
  // Delete command routing
  // -----------------------------------------------------------------------

  describe('delete command routing', () => {
    it('targeted delete for other machine is forwarded', async () => {
      // Create a project on laptop
      await laptopAdapter.simulateIncomingCommand(
        makeCommand('create', ['remote-proj'], { targetMachine: 'laptop' }),
      );
      laptopAdapter.sentMessages.length = 0;

      // "laptop: delete remote-proj" lands on desktop
      await desktopAdapter.simulateIncomingCommand(
        makeCommand('delete', ['remote-proj'], { targetMachine: 'laptop' }),
      );

      // Should be forwarded to laptop
      expect(desktopAdapter.forwardedCommands).toHaveLength(1);
      expect(desktopAdapter.forwardedCommands[0].command).toBe('delete');

      // Laptop should have processed the delete
      const laptopProjects = await laptopDaemon.getProjectManager().listProjects();
      expect(laptopProjects).toHaveLength(0);
    });

    it('unprefixed delete asks which machine and forwards', async () => {
      // Create project on laptop
      await laptopAdapter.simulateIncomingCommand(
        makeCommand('create', ['remote-proj'], { targetMachine: 'laptop' }),
      );

      // Queue: machine picker → laptop, then project picker → remote-proj
      desktopAdapter.queueQuestionResponse('laptop');

      await desktopAdapter.simulateIncomingCommand(
        makeCommand('delete', ['remote-proj'], { type: 'broadcast', targetMachine: '' }),
      );

      // Should have asked which machine
      const question = desktopAdapter.askedQuestions.find(
        q => q.question.question.includes('machine'),
      );
      expect(question).toBeDefined();

      // Forwarded to laptop
      expect(desktopAdapter.forwardedCommands).toHaveLength(1);
      expect(desktopAdapter.forwardedCommands[0].targetMachine).toBe('laptop');
    });
  });

  // -----------------------------------------------------------------------
  // List command routing
  // -----------------------------------------------------------------------

  describe('list command routing', () => {
    it('list includes machine name in output', async () => {
      // Create projects on desktop
      await desktopAdapter.simulateIncomingCommand(
        makeCommand('create', ['proj-a'], { targetMachine: 'desktop' }),
      );
      await desktopAdapter.simulateIncomingCommand(
        makeCommand('create', ['proj-b'], { targetMachine: 'desktop' }),
      );

      desktopAdapter.sentMessages.length = 0;

      // Run list
      await desktopAdapter.simulateIncomingCommand(
        makeCommand('list', [], { targetMachine: 'desktop' }),
      );

      const msg = desktopAdapter.getLastMessage();
      expect(msg).toBeDefined();
      expect(msg!.content.text).toMatch(/desktop/i);
      expect(msg!.content.text).toMatch(/proj-a/i);
      expect(msg!.content.text).toMatch(/proj-b/i);
    });
  });

  // -----------------------------------------------------------------------
  // Status command (broadcast)
  // -----------------------------------------------------------------------

  describe('status command', () => {
    it('status shows all registered machines', async () => {
      // Machines are already registered in beforeEach
      await desktopAdapter.simulateIncomingCommand(
        makeCommand('status', [], { type: 'broadcast', targetMachine: '' }),
      );

      const msg = desktopAdapter.getLastMessage();
      expect(msg).toBeDefined();
      expect(msg!.content.text).toMatch(/desktop/i);
      expect(msg!.content.text).toMatch(/laptop/i);
    });

    it('status shows offline machines', async () => {
      const staleDate = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      desktopAdapter.registeredMachines.set('laptop', {
        machineName: 'laptop',
        online: false,
        activeSessions: 0,
        projects: [],
        lastSeen: staleDate,
      });

      await desktopAdapter.simulateIncomingCommand(
        makeCommand('status', [], { type: 'broadcast', targetMachine: '' }),
      );

      const msg = desktopAdapter.getLastMessage();
      expect(msg).toBeDefined();
      expect(msg!.content.text).toMatch(/desktop/i);
      expect(msg!.content.text).toMatch(/laptop/i);
    });
  });

  // -----------------------------------------------------------------------
  // Project message forwarding
  // -----------------------------------------------------------------------

  describe('project message forwarding', () => {
    it('message for local project is handled locally', async () => {
      // Create a project on desktop
      await desktopAdapter.simulateIncomingCommand(
        makeCommand('create', ['local-proj'], { targetMachine: 'desktop' }),
      );
      const project = await desktopDaemon.getProjectManager().getProject('local-proj');
      expect(project).toBeDefined();

      // Simulate a message in the project channel
      await desktopAdapter.simulateProjectMessage({
        channelId: project!.channelId,
        channelName: `atc-desktop-local-proj`,
        userId: 'U-1',
        text: 'hello world',
        messageId: 'msg-1',
        timestamp: new Date(),
      });

      // Should NOT be forwarded
      expect(desktopAdapter.forwardedMessages).toHaveLength(0);
    });

    it('message for remote project is forwarded to owning machine', async () => {
      // Create a project on laptop
      await laptopAdapter.simulateIncomingCommand(
        makeCommand('create', ['remote-proj'], { targetMachine: 'laptop' }),
      );
      const project = await laptopDaemon.getProjectManager().getProject('remote-proj');
      expect(project).toBeDefined();

      // Simulate: message in laptop's channel lands on desktop adapter
      await desktopAdapter.simulateProjectMessage(
        {
          channelId: project!.channelId,
          channelName: `atc-laptop-remote-proj`,
          userId: 'U-1',
          text: 'do something',
          messageId: 'msg-2',
          timestamp: new Date(),
        },
        'laptop', // owner machine
      );

      // Should be forwarded
      expect(desktopAdapter.forwardedMessages).toHaveLength(1);
      expect(desktopAdapter.forwardedMessages[0].targetMachine).toBe('laptop');
    });
  });

  // -----------------------------------------------------------------------
  // Machine isolation
  // -----------------------------------------------------------------------

  describe('machine isolation', () => {
    it('each machine has independent project lists', async () => {
      // Create projects on each machine (targeted, no picker)
      await desktopAdapter.simulateIncomingCommand(
        makeCommand('create', ['desktop-proj'], { targetMachine: 'desktop' }),
      );
      await laptopAdapter.simulateIncomingCommand(
        makeCommand('create', ['laptop-proj'], { targetMachine: 'laptop' }),
      );

      const desktopProjects = await desktopDaemon.getProjectManager().listProjects();
      const laptopProjects = await laptopDaemon.getProjectManager().listProjects();

      expect(desktopProjects).toHaveLength(1);
      expect(desktopProjects[0].name).toBe('desktop-proj');

      expect(laptopProjects).toHaveLength(1);
      expect(laptopProjects[0].name).toBe('laptop-proj');
    });

    it('unprefixed create with multiple machines asks user', async () => {
      // With 2 machines registered, unprefixed create should ask
      desktopAdapter.queueQuestionResponse('desktop');

      await desktopAdapter.simulateIncomingCommand(
        makeCommand('create', ['local-proj'], { type: 'broadcast', targetMachine: '' }),
      );

      // Should have asked which machine
      expect(desktopAdapter.askedQuestions).toHaveLength(1);

      const projects = await desktopDaemon.getProjectManager().listProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('local-proj');
    });

    it('multiple targeted creates go to correct machines', async () => {
      // "desktop: create proj-d" received by desktop
      await desktopAdapter.simulateIncomingCommand(
        makeCommand('create', ['proj-d'], { targetMachine: 'desktop' }),
      );

      // "laptop: create proj-l" received by desktop (wrong daemon)
      await desktopAdapter.simulateIncomingCommand(
        makeCommand('create', ['proj-l'], { targetMachine: 'laptop' }),
      );

      // desktop has its own project
      const desktopProjects = await desktopDaemon.getProjectManager().listProjects();
      expect(desktopProjects).toHaveLength(1);
      expect(desktopProjects[0].name).toBe('proj-d');

      // laptop got the forwarded create
      const laptopProjects = await laptopDaemon.getProjectManager().listProjects();
      expect(laptopProjects).toHaveLength(1);
      expect(laptopProjects[0].name).toBe('proj-l');
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('forwarded create for non-existent machine records forward but no peer handles it', async () => {
      // "ghost: create myapp" — no daemon named "ghost" exists
      await desktopAdapter.simulateIncomingCommand(
        makeCommand('create', ['myapp'], { targetMachine: 'ghost' }),
      );

      // Should be forwarded
      expect(desktopAdapter.forwardedCommands).toHaveLength(1);

      // Neither machine created it
      const desktopProjects = await desktopDaemon.getProjectManager().listProjects();
      const laptopProjects = await laptopDaemon.getProjectManager().listProjects();
      expect(desktopProjects).toHaveLength(0);
      expect(laptopProjects).toHaveLength(0);
    });

    it('machine name comparison is case-insensitive', async () => {
      // "DESKTOP: create myapp" — should match desktop daemon
      await desktopAdapter.simulateIncomingCommand(
        makeCommand('create', ['myapp'], { targetMachine: 'DESKTOP' }),
      );

      // Should be handled locally (case-insensitive match)
      const desktopProjects = await desktopDaemon.getProjectManager().listProjects();
      expect(desktopProjects).toHaveLength(1);
      expect(desktopAdapter.forwardedCommands).toHaveLength(0);
    });

    it('create with --from flag works correctly when forwarded', async () => {
      // "laptop: create myapp --from https://github.com/user/repo" lands on desktop
      await desktopAdapter.simulateIncomingCommand(
        makeCommand('create', ['myapp', '--from', 'https://github.com/user/repo'], { targetMachine: 'laptop' }),
      );

      // Forwarded to laptop
      expect(desktopAdapter.forwardedCommands).toHaveLength(1);

      // Laptop created it
      const laptopProjects = await laptopDaemon.getProjectManager().listProjects();
      expect(laptopProjects).toHaveLength(1);
      expect(laptopProjects[0].name).toBe('myapp');
    });
  });
});
