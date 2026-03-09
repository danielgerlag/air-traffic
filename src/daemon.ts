import { simpleGit } from 'simple-git';
import path from 'node:path';
import type { WingmanConfig } from './config.js';
import type { MessagingAdapter, IncomingMessage, IncomingCommand } from './messaging/types.js';
import { ProjectManager } from './projects/project-manager.js';
import { SessionOrchestrator } from './copilot/session-orchestrator.js';
import { AgentSession } from './copilot/agent-session.js';
import { PermissionManager } from './copilot/permission-manager.js';
import { ModelRegistry } from './copilot/model-registry.js';
import { PresenceManager } from './messaging/slack/presence.js';
import { extractProjectName } from './messaging/slack/commands.js';
import { parseProjectChannelMessage } from './messaging/slack/commands.js';
import { MODE_DESCRIPTIONS } from './projects/types.js';
import type { CopilotMode } from './projects/types.js';
import { WebServer } from './web/server.js';
import { SessionBridge } from './web/session-bridge.js';
import { getLogger } from './utils/logger.js';

export class WingmanDaemon {
  private readonly projectManager: ProjectManager;
  private readonly orchestrator: SessionOrchestrator;
  private readonly permissionManager: PermissionManager;
  private readonly modelRegistry: ModelRegistry;
  private readonly presence: PresenceManager;
  private webServer: WebServer | null = null;
  private sessionBridge: SessionBridge | null = null;

  constructor(
    private readonly config: WingmanConfig,
    private readonly adapter: MessagingAdapter,
  ) {
    this.projectManager = new ProjectManager(
      config.wingman.projectsDir,
      config.wingman.dataDir,
      config.wingman.defaultModel,
      adapter,
    );
    this.orchestrator = new SessionOrchestrator();
    this.permissionManager = new PermissionManager();
    this.modelRegistry = new ModelRegistry();
    this.presence = new PresenceManager(adapter);
  }

  async start(): Promise<void> {
    const log = getLogger();

    await this.orchestrator.start();
    await this.adapter.connect();
    this.presence.start();

    this.adapter.onCommand((cmd) => this.handleCommand(cmd));
    this.adapter.onBroadcast((cmd) => this.handleBroadcast(cmd));
    this.adapter.onMessage((msg) => this.handleMessage(msg));

    // Start Console web server
    this.webServer = new WebServer({
      projectManager: this.projectManager,
      orchestrator: this.orchestrator,
      modelRegistry: this.modelRegistry,
      machineName: this.config.wingman.machineName,
      adapter: this.adapter,
      config: { webPort: this.config.wingman.webPort },
    });
    this.sessionBridge = new SessionBridge(this.webServer.getIO());
    await this.webServer.start();

    log.info(`Wingman daemon started on machine "${this.config.wingman.machineName}"`);
  }

  async stop(): Promise<void> {
    const log = getLogger();

    if (this.sessionBridge) this.sessionBridge.unbridgeAll();
    if (this.webServer) await this.webServer.stop();
    this.presence.stop();
    await this.orchestrator.stop();
    await this.adapter.disconnect();

    log.info('Wingman daemon stopped');
  }

  // --- Command routing ---

  private async handleCommand(cmd: IncomingCommand): Promise<void> {
    const log = getLogger();

    // Check if this command came from a project channel (e.g. via /wm slash command)
    const projectName = extractProjectName(cmd.channelName, this.config.wingman.machineName);
    if (projectName) {
      try {
        const msg: IncomingMessage = {
          channelId: cmd.channelId,
          channelName: cmd.channelName,
          threadId: cmd.threadId,
          userId: cmd.userId,
          text: cmd.rawText,
          messageId: cmd.messageId,
          timestamp: new Date(),
        };
        await this.routeProjectCommand(projectName, cmd.command, cmd.args, msg);
      } catch (err) {
        log.error(`Error handling project command "${cmd.command}"`, { error: err });
        await this.postError(cmd.channelId, err);
      }
      return;
    }

    try {
      switch (cmd.command) {
        case 'create':
          await this.cmdCreateProject(cmd);
          break;
        case 'delete':
          await this.cmdDeleteProject(cmd);
          break;
        case 'list':
          await this.cmdListProjects(cmd);
          break;
        case 'config':
          await this.cmdUpdateConfig(cmd);
          break;
        case 'status':
          await this.postMachineStatus(cmd.channelId);
          break;
        case 'models':
          await this.postAvailableModels(cmd.channelId);
          break;
        default:
          log.warn(`Unknown targeted command: ${cmd.command}`);
      }
    } catch (err) {
      log.error(`Error handling command "${cmd.command}"`, { error: err });
      await this.postError(cmd.channelId, err);
    }
  }

  private async handleBroadcast(cmd: IncomingCommand): Promise<void> {
    const log = getLogger();
    try {
      switch (cmd.command) {
        case 'status':
          await this.postMachineStatus(cmd.channelId);
          break;
        case 'machines':
          await this.postMachinePresence(cmd.channelId);
          break;
        case 'models':
          await this.postAvailableModels(cmd.channelId);
          break;
        case 'help':
          break;
        default:
          log.debug(`Ignoring broadcast command: ${cmd.command}`);
      }
    } catch (err) {
      log.error(`Error handling broadcast "${cmd.command}"`, { error: err });
      await this.postError(cmd.channelId, err);
    }
  }

  private async handleMessage(msg: IncomingMessage): Promise<void> {
    const log = getLogger();
    const projectName = extractProjectName(msg.channelName, this.config.wingman.machineName);
    if (!projectName) return;

    try {
      // Handle file uploads — download to project workspace
      if (msg.files && msg.files.length > 0) {
        await this.handleFileUploads(projectName, msg);
      }

      // If there's also text, process as command/prompt
      if (msg.text) {
        const parsed = parseProjectChannelMessage(msg.text);
        if (parsed) {
          await this.routeProjectCommand(projectName, parsed.command, parsed.args, msg);
        } else {
          const session = await this.getOrCreateSession(projectName);
          const threadId = msg.threadId ?? msg.messageId;
          await session.handlePrompt(msg.text, threadId, msg.userId);
        }
      }
    } catch (err) {
      log.error(`Error handling message in project "${projectName}"`, { error: err });
      await this.postError(msg.channelId, err);
    }
  }

  private async handleFileUploads(projectName: string, msg: IncomingMessage): Promise<void> {
    const log = getLogger();
    const project = await this.projectManager.getProject(projectName);

    const saved: string[] = [];
    for (const file of msg.files!) {
      const destPath = path.join(project.path, file.name);
      try {
        await this.adapter.downloadFile(file.url, destPath);
        saved.push(file.name);
        log.info(`Downloaded file "${file.name}" to ${destPath}`);
      } catch (err) {
        log.error(`Failed to download file "${file.name}"`, { error: err });
        await this.adapter.sendMessage(msg.channelId, { text: `❌ Failed to download \`${file.name}\`: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    if (saved.length > 0) {
      const fileList = saved.map((f) => `\`${f}\``).join(', ');
      await this.adapter.sendMessage(msg.channelId, {
        text: `📥 Saved ${saved.length === 1 ? 'file' : `${saved.length} files`} to workspace: ${fileList}`,
      });
    }
  }

  // --- Project-channel !commands ---

  private async routeProjectCommand(
    projectName: string,
    command: string,
    args: string[],
    msg: IncomingMessage,
  ): Promise<void> {
    const log = getLogger();
    try {
      switch (command) {
        case 'model':
          await this.cmdSetProjectModel(projectName, args, msg);
          break;
        case 'status':
          await this.cmdProjectStatus(projectName, msg);
          break;
        case 'abort':
          await this.cmdAbortSession(projectName, msg);
          break;
        case 'diff':
          await this.cmdGitDiff(projectName, msg);
          break;
        case 'agent':
          await this.cmdSetAgent(projectName, args, msg);
          break;
        case 'mode':
          await this.cmdSetMode(projectName, args, msg);
          break;
        case 'history':
          await this.cmdHistory(projectName, msg);
          break;
        default:
          log.warn(`Unknown project command: !${command}`);
      }
    } catch (err) {
      log.error(`Error handling !${command} in project "${projectName}"`, { error: err });
      await this.postError(msg.channelId, err);
    }
  }

  // --- Control-channel command implementations ---

  private async cmdCreateProject(cmd: IncomingCommand): Promise<void> {
    const { args } = cmd;
    if (args.length === 0) {
      await this.adapter.sendMessage(cmd.channelId, { text: '❌ Usage: create <name> [--from <repo-url>]' });
      return;
    }

    const name = args[0];
    const fromIdx = args.indexOf('--from');
    const repoUrl = fromIdx !== -1 && args[fromIdx + 1] ? args[fromIdx + 1] : undefined;

    const project = await this.projectManager.createProject(name, this.config.wingman.machineName, { repoUrl });
    await this.adapter.sendMessage(cmd.channelId, {
      text: `✅ Project "${project.name}" created → <#${project.channelId}>`,
    });
  }

  private async cmdDeleteProject(cmd: IncomingCommand): Promise<void> {
    const name = cmd.args[0];
    if (!name) {
      await this.adapter.sendMessage(cmd.channelId, { text: '❌ Usage: delete <project-name>' });
      return;
    }

    const session = this.orchestrator.getSession(name);
    if (session) {
      await session.disconnect();
    }
    this.orchestrator.removeSession(name);
    await this.projectManager.deleteProject(name);
    await this.adapter.sendMessage(cmd.channelId, { text: `✅ Project "${name}" deleted` });
  }

  private async cmdListProjects(cmd: IncomingCommand): Promise<void> {
    const projects = await this.projectManager.listProjects();
    if (projects.length === 0) {
      await this.adapter.sendMessage(cmd.channelId, { text: 'No projects configured.' });
      return;
    }

    const lines = projects.map((p) => {
      const session = this.orchestrator.getSession(p.name);
      const status = session ? (session.isIdle() ? '💤 idle' : '🔄 active') : '⬚ no session';
      return `• *${p.name}* — model: \`${p.model}\` — ${status}`;
    });
    await this.adapter.sendMessage(cmd.channelId, { text: lines.join('\n') });
  }

  private async cmdUpdateConfig(cmd: IncomingCommand): Promise<void> {
    const [projectName, field, ...valueParts] = cmd.args;
    if (!projectName || !field || valueParts.length === 0) {
      await this.adapter.sendMessage(cmd.channelId, {
        text: '❌ Usage: config <project> <field> <value>',
      });
      return;
    }
    const value = valueParts.join(' ');

    const updates: Record<string, unknown> = {};
    if (field === 'model') {
      if (!this.modelRegistry.isValid(value)) {
        await this.adapter.sendMessage(cmd.channelId, { text: `❌ Unknown model: ${value}` });
        return;
      }
      updates.model = value;
    } else if (field === 'agent') {
      updates.agent = value;
    } else if (field === 'permissions') {
      // Handle permissions: "config my-app permissions all auto" or "config my-app permissions shell ask"
      const [category, mode] = valueParts;
      if (!category || !mode || (mode !== 'auto' && mode !== 'ask')) {
        await this.adapter.sendMessage(cmd.channelId, {
          text: '❌ Usage: config <project> permissions <category|all> <auto|ask>\nCategories: fileEdit, fileCreate, shell, git, network, default, all',
        });
        return;
      }
      const project = await this.projectManager.getProject(projectName);
      const perms = { ...project.permissions };
      if (category === 'all') {
        perms.fileEdit = mode;
        perms.fileCreate = mode;
        perms.shell = mode;
        perms.git = mode;
        perms.network = mode;
        perms.default = mode;
      } else if (category in perms) {
        (perms as Record<string, string>)[category] = mode;
      } else {
        await this.adapter.sendMessage(cmd.channelId, {
          text: `❌ Unknown permission category: ${category}\nValid: fileEdit, fileCreate, shell, git, network, default, all`,
        });
        return;
      }
      updates.permissions = perms;
    } else {
      await this.adapter.sendMessage(cmd.channelId, { text: `❌ Unknown config field: ${field}\nValid fields: model, agent, permissions` });
      return;
    }

    const updated = await this.projectManager.updateProjectConfig(
      projectName,
      updates as Partial<Pick<import('./projects/types.js').ProjectConfig, 'model' | 'agent' | 'mode' | 'permissions'>>,
    );
    await this.adapter.sendMessage(cmd.channelId, {
      text: `✅ Project "${updated.name}" config updated: ${field} = \`${value}\``,
    });
  }

  // --- Project-channel !command implementations ---

  private async cmdSetProjectModel(projectName: string, args: string[], msg: IncomingMessage): Promise<void> {
    const model = args[0];
    if (!model) {
      await this.adapter.sendMessage(msg.channelId, { text: '❌ Usage: !model <model-name>' });
      return;
    }
    if (!this.modelRegistry.isValid(model)) {
      await this.adapter.sendMessage(msg.channelId, { text: `❌ Unknown model: ${model}` });
      return;
    }
    await this.projectManager.updateProjectConfig(projectName, { model });
    await this.adapter.sendMessage(msg.channelId, { text: `✅ Model set to \`${model}\`` });
  }

  private async cmdProjectStatus(projectName: string, msg: IncomingMessage): Promise<void> {
    const session = this.orchestrator.getSession(projectName);
    const project = await this.projectManager.getProject(projectName);
    const status = session ? (session.isIdle() ? '💤 idle' : '🔄 active') : '⬚ no session';
    await this.adapter.sendMessage(msg.channelId, {
      text: `*${project.name}*\nModel: \`${project.model}\`\nMode: \`${project.mode ?? 'normal'}\`\nStatus: ${status}`,
    });
  }

  private async cmdAbortSession(projectName: string, msg: IncomingMessage): Promise<void> {
    const session = this.orchestrator.getSession(projectName);
    if (!session) {
      await this.adapter.sendMessage(msg.channelId, { text: 'No active session to abort.' });
      return;
    }
    await session.abort();
    await this.adapter.sendMessage(msg.channelId, { text: '🛑 Session aborted' });
  }

  private async cmdGitDiff(projectName: string, msg: IncomingMessage): Promise<void> {
    const project = await this.projectManager.getProject(projectName);
    const git = simpleGit(project.path);
    const diff = await git.diff();
    const text = diff.trim() || 'No changes.';
    await this.adapter.sendMessage(msg.channelId, { text: `\`\`\`\n${text}\n\`\`\`` });
  }

  private async cmdSetAgent(projectName: string, args: string[], msg: IncomingMessage): Promise<void> {
    const agent = args.join(' ');
    if (!agent) {
      await this.adapter.sendMessage(msg.channelId, { text: '❌ Usage: !agent <agent-name>' });
      return;
    }
    await this.projectManager.updateProjectConfig(projectName, { agent });
    await this.adapter.sendMessage(msg.channelId, { text: `✅ Agent set to \`${agent}\`` });
  }

  private async cmdSetMode(projectName: string, args: string[], msg: IncomingMessage): Promise<void> {
    const validModes: CopilotMode[] = ['normal', 'plan', 'autopilot'];
    const requested = args[0]?.toLowerCase();

    if (!requested) {
      // Show current mode
      const project = await this.projectManager.getProject(projectName);
      const current = project.mode ?? 'normal';
      const lines = validModes.map((m) => {
        const indicator = m === current ? '▸' : '  ';
        return `${indicator} \`${m}\` — ${MODE_DESCRIPTIONS[m]}`;
      });
      await this.adapter.sendMessage(msg.channelId, {
        text: `*Current mode:* \`${current}\`\n\n${lines.join('\n')}`,
      });
      return;
    }

    if (!validModes.includes(requested as CopilotMode)) {
      await this.adapter.sendMessage(msg.channelId, {
        text: `❌ Unknown mode: \`${requested}\`\nValid modes: ${validModes.map((m) => `\`${m}\``).join(', ')}`,
      });
      return;
    }

    await this.projectManager.updateProjectConfig(projectName, { mode: requested as CopilotMode });

    // Update the in-memory project in any active session
    const session = this.orchestrator.getSession(projectName);
    if (session) {
      (session as any).project.mode = requested;
    }

    await this.adapter.sendMessage(msg.channelId, {
      text: `✅ Mode set to \`${requested}\` — ${MODE_DESCRIPTIONS[requested as CopilotMode]}`,
    });
  }

  private async cmdHistory(_projectName: string, msg: IncomingMessage): Promise<void> {
    // History retrieval is a placeholder — session history is not persisted yet
    await this.adapter.sendMessage(msg.channelId, { text: '_Session history not yet available._' });
  }

  // --- Status helpers ---

  private async postMachineStatus(channelId: string): Promise<void> {
    const activeSessions = this.orchestrator.getActiveSessionCount();
    const projects = this.orchestrator.getActiveProjectNames();
    await this.adapter.reportStatus({
      machineName: this.config.wingman.machineName,
      online: true,
      activeSessions,
      projects,
      lastSeen: new Date(),
    });
  }

  private async postMachinePresence(channelId: string): Promise<void> {
    await this.adapter.reportPresence();
  }

  private async postAvailableModels(channelId: string): Promise<void> {
    const models = this.modelRegistry.getAvailable();
    const text = `*Available models:*\n${models.map((m) => `• \`${m}\``).join('\n')}`;
    await this.adapter.sendMessage(channelId, { text });
  }

  // --- Accessors for web server / external consumers ---

  getProjectManager(): ProjectManager { return this.projectManager; }
  getOrchestrator(): SessionOrchestrator { return this.orchestrator; }
  getModelRegistry(): ModelRegistry { return this.modelRegistry; }
  getPermissionManager(): PermissionManager { return this.permissionManager; }
  getAdapter(): MessagingAdapter { return this.adapter; }

  // --- Session management ---

  private async getOrCreateSession(projectName: string): Promise<AgentSession> {
    const existing = this.orchestrator.getSession(projectName);
    if (existing) return existing;

    const project = await this.projectManager.getProject(projectName);
    const client = await this.orchestrator.ensureClient();
    const session = new AgentSession(client, this.adapter, project, this.permissionManager);
    await session.initialize();
    this.orchestrator.registerSession(projectName, session);

    // Persist "Always Allow" permission changes from Slack
    session.events.on('permissions_updated', async (data: { projectName: string; category: string; mode: string }) => {
      try {
        const current = await this.projectManager.getProject(data.projectName);
        const perms = { ...current.permissions, [data.category]: data.mode };
        await this.projectManager.updateProjectConfig(data.projectName, { permissions: perms });
        getLogger().info(`Permission "${data.category}" set to "${data.mode}" for project "${data.projectName}" (always allow)`);
      } catch (err) {
        getLogger().error('Failed to persist always-allow permission update', { error: err });
      }
    });

    if (this.sessionBridge) {
      this.sessionBridge.bridge(projectName, session);
    }

    return session;
  }

  // --- Error reporting ---

  private async postError(channelId: string, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await this.adapter.sendMessage(channelId, { text: `❌ Error: ${message}` });
    } catch {
      getLogger().error('Failed to post error to channel', { channelId, error: message });
    }
  }
}
