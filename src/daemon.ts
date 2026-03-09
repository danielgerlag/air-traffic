import { simpleGit } from 'simple-git';
import path from 'node:path';
import type { AirTrafficConfig } from './config.js';
import type { MessagingAdapter, IncomingMessage, IncomingCommand } from './messaging/types.js';
import { ProjectManager } from './projects/project-manager.js';
import { SessionOrchestrator } from './copilot/session-orchestrator.js';
import { AgentSession } from './copilot/agent-session.js';
import { PermissionManager } from './copilot/permission-manager.js';
import { ModelRegistry } from './copilot/model-registry.js';
import { PresenceManager } from './messaging/slack/presence.js';
import { extractProjectName } from './messaging/slack/commands.js';
import { parseProjectChannelMessage } from './messaging/slack/commands.js';
import { formatControlHelp, formatMachineStatus } from './messaging/slack/formatters.js';
import { MODE_DESCRIPTIONS } from './projects/types.js';
import type { CopilotMode } from './projects/types.js';
import { WebServer } from './web/server.js';
import { SessionBridge } from './web/session-bridge.js';
import { getLogger } from './utils/logger.js';

export class AirTrafficDaemon {
  private readonly projectManager: ProjectManager;
  private readonly orchestrator: SessionOrchestrator;
  private readonly permissionManager: PermissionManager;
  private readonly modelRegistry: ModelRegistry;
  private readonly presence: PresenceManager;
  private webServer: WebServer | null = null;
  private sessionBridge: SessionBridge | null = null;

  constructor(
    private readonly config: AirTrafficConfig,
    private readonly adapter: MessagingAdapter,
  ) {
    this.projectManager = new ProjectManager(
      config.airTraffic.projectsDir,
      config.airTraffic.dataDir,
      config.airTraffic.defaultModel,
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
      permissionManager: this.permissionManager,
      machineName: this.config.airTraffic.machineName,
      adapter: this.adapter,
      config: { webPort: this.config.airTraffic.webPort },
    });
    this.sessionBridge = new SessionBridge(this.webServer.getIO());
    await this.webServer.start();

    log.info(`Air Traffic daemon started on machine "${this.config.airTraffic.machineName}"`);
  }

  async stop(): Promise<void> {
    const log = getLogger();

    if (this.sessionBridge) this.sessionBridge.unbridgeAll();
    if (this.webServer) await this.webServer.stop();
    this.presence.stop();
    await this.orchestrator.stop();
    await this.adapter.disconnect();

    log.info('Air Traffic daemon stopped');
  }

  // --- Command routing ---

  private async handleCommand(cmd: IncomingCommand): Promise<void> {
    const log = getLogger();

    // Check if this command came from a project channel (e.g. via /atc slash command)
    const projectName = extractProjectName(cmd.channelName, this.config.airTraffic.machineName);
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
        case 'sessions':
          await this.cmdListSessions(cmd.channelId);
          break;
        case 'join':
          await this.cmdJoinFromControl(cmd);
          break;
        case 'status':
          await this.postMachineStatus(cmd.channelId);
          break;
        case 'models':
          await this.postAvailableModels(cmd.channelId);
          break;
        case 'help':
          await this.adapter.sendMessage(cmd.channelId, formatControlHelp(this.config.airTraffic.machineName));
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
    const projectName = extractProjectName(msg.channelName, this.config.airTraffic.machineName);
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
      const safeName = path.basename(file.name);
      if (safeName !== file.name || safeName.startsWith('.')) {
        log.warn(`Rejected file upload with unsafe name: "${file.name}"`);
        await this.adapter.sendMessage(msg.channelId, { text: `❌ Rejected file \`${file.name}\` — invalid filename.` });
        continue;
      }
      const destPath = path.join(project.path, safeName);
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
        case 'sessions':
          await this.cmdListSessions(msg.channelId);
          break;
        case 'join':
          await this.cmdJoinSession(projectName, args, msg);
          break;
        case 'leave':
          await this.cmdLeaveSession(projectName, msg);
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

    const project = await this.projectManager.createProject(name, this.config.airTraffic.machineName, { repoUrl });
    await this.adapter.sendMessage(cmd.channelId, {
      text: `✅ Project "${project.name}" created → <#${project.channelId}>`,
    });
  }

  private async cmdDeleteProject(cmd: IncomingCommand): Promise<void> {
    let name = cmd.args[0];
    if (!name) {
      // Show project picker
      const projects = await this.projectManager.listProjects();
      if (projects.length === 0) {
        await this.adapter.sendMessage(cmd.channelId, { text: 'No projects to delete.' });
        return;
      }
      const response = await this.adapter.askQuestion(cmd.channelId, cmd.channelId, {
        question: '🗑️ Which project do you want to delete?',
        choices: projects.map(p => p.name),
        allowFreeform: false,
      });
      name = response.answer.trim();
      if (!name) return;
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
    let [projectName, field, ...valueParts] = cmd.args;

    // If no project name, show project picker
    if (!projectName) {
      const projects = await this.projectManager.listProjects();
      if (projects.length === 0) {
        await this.adapter.sendMessage(cmd.channelId, { text: 'No projects configured.' });
        return;
      }
      const resp = await this.adapter.askQuestion(cmd.channelId, cmd.channelId, {
        question: '⚙️ Which project do you want to configure?',
        choices: projects.map(p => p.name),
        allowFreeform: false,
      });
      projectName = resp.answer.trim();
      if (!projectName) return;
    }

    // If no field, show field picker
    if (!field) {
      const resp = await this.adapter.askQuestion(cmd.channelId, cmd.channelId, {
        question: `⚙️ What do you want to configure for *${projectName}*?`,
        choices: ['model', 'agent', 'permissions'],
        allowFreeform: false,
      });
      field = resp.answer.trim();
      if (!field) return;
    }

    // If no value, show contextual picker
    if (valueParts.length === 0) {
      if (field === 'model') {
        const models = this.modelRegistry.getAvailable();
        const resp = await this.adapter.askQuestion(cmd.channelId, cmd.channelId, {
          question: `🤖 Which model for *${projectName}*?`,
          choices: models,
          allowFreeform: true,
        });
        valueParts = [resp.answer.trim()];
      } else if (field === 'permissions') {
        const resp = await this.adapter.askQuestion(cmd.channelId, cmd.channelId, {
          question: `🔒 Which permission category?`,
          choices: ['all', 'fileEdit', 'fileCreate', 'shell', 'git', 'network', 'default'],
          allowFreeform: false,
        });
        const category = resp.answer.trim();
        const modeResp = await this.adapter.askQuestion(cmd.channelId, cmd.channelId, {
          question: `🔒 Set \`${category}\` permission to?`,
          choices: ['auto', 'ask'],
          allowFreeform: false,
        });
        valueParts = [category, modeResp.answer.trim()];
      } else {
        await this.adapter.sendMessage(cmd.channelId, {
          text: `❌ Please provide a value for \`${field}\``,
        });
        return;
      }
    }

    if (!valueParts[0]) return;
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
    // Sync in-memory session with updated config
    const session = this.orchestrator.getSession(projectName);
    if (session) {
      session.updateProject(updated);
    }
    await this.adapter.sendMessage(cmd.channelId, {
      text: `✅ Project "${updated.name}" config updated: ${field} = \`${value}\``,
    });
  }

  // --- Project-channel !command implementations ---

  private async cmdSetProjectModel(projectName: string, args: string[], msg: IncomingMessage): Promise<void> {
    let model = args[0];
    if (!model) {
      const models = this.modelRegistry.getAvailable();
      const project = await this.projectManager.getProject(projectName);
      const current = project.model;
      const choices = models.map(m => m === current ? `${m} (current)` : m);
      const resp = await this.adapter.askQuestion(msg.channelId, msg.threadId ?? msg.channelId, {
        question: '🤖 Which model?',
        choices,
        allowFreeform: true,
      });
      model = resp.answer.replace(/\s*\(current\)$/, '').trim();
      if (!model) return;
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
    let agent = args.join(' ');
    if (!agent) {
      const resp = await this.adapter.askQuestion(msg.channelId, msg.threadId ?? msg.channelId, {
        question: `🧩 Enter the agent name for *${projectName}*:`,
        allowFreeform: true,
      });
      agent = resp.answer.trim();
      if (!agent) return;
    }
    await this.projectManager.updateProjectConfig(projectName, { agent });
    await this.adapter.sendMessage(msg.channelId, { text: `✅ Agent set to \`${agent}\`` });
  }

  private async cmdSetMode(projectName: string, args: string[], msg: IncomingMessage): Promise<void> {
    const validModes: CopilotMode[] = ['normal', 'plan', 'autopilot'];
    let requested = args[0]?.toLowerCase();

    if (!requested) {
      // Show interactive mode picker
      const project = await this.projectManager.getProject(projectName);
      const current = project.mode ?? 'normal';
      const choices = validModes.map(m =>
        m === current ? `${m} — ${MODE_DESCRIPTIONS[m]} (current)` : `${m} — ${MODE_DESCRIPTIONS[m]}`
      );
      const resp = await this.adapter.askQuestion(msg.channelId, msg.threadId ?? msg.channelId, {
        question: `⚡ Select mode for *${projectName}*:`,
        choices,
        allowFreeform: false,
      });
      requested = resp.answer.split(/\s*—/)[0].trim().toLowerCase();
      if (!requested || requested === current) {
        await this.adapter.sendMessage(msg.channelId, { text: `Mode unchanged: \`${current}\`` });
        return;
      }
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

  private async cmdListSessions(channelId: string): Promise<void> {
    // Build project path map for CWD matching
    const projects = await this.projectManager.listProjects();
    const projectPaths = new Map(projects.map((p) => [p.name, p.path]));
    const sessions = await this.orchestrator.listAllSessions(projectPaths);

    if (sessions.length === 0) {
      await this.adapter.sendMessage(channelId, { text: '📋 No Copilot sessions found on this machine.' });
      return;
    }

    // Sort: matching projects first, then by modifiedTime desc
    sessions.sort((a, b) => {
      if (a.matchingProject && !b.matchingProject) return -1;
      if (!a.matchingProject && b.matchingProject) return 1;
      return b.modifiedTime.getTime() - a.modifiedTime.getTime();
    });

    const lines = sessions.map((s) => {
      const age = this.formatAge(s.modifiedTime);
      const flags: string[] = [];
      if (s.managed) flags.push('🟢 managed');
      if (s.matchingProject) flags.push(`⭐ ${s.matchingProject}`);
      if (s.isRemote) flags.push('☁️ remote');
      const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
      const name = s.summary ? ` — ${s.summary.slice(0, 80)}` : '';
      const cwd = s.context?.cwd ? ` 📁 \`${s.context.cwd}\`` : '';
      const branch = s.context?.branch ? ` 🔀 ${s.context.branch}` : '';
      return `• \`${s.sessionId.slice(0, 8)}\`${name}${cwd}${branch} (${age})${flagStr}`;
    });

    await this.adapter.sendMessage(channelId, {
      text: `📋 *Copilot Sessions* (${sessions.length}):\n${lines.join('\n')}\n\n_Use \`/atc join <session-id>\` to join one._`,
    });
  }

  /** Fetch available (unmanaged) sessions and return them with labels. */
  private async getAvailableSessions() {
    const projects = await this.projectManager.listProjects();
    const projectPaths = new Map(projects.map((p) => [p.name, p.path]));
    const allSessions = await this.orchestrator.listAllSessions(projectPaths);
    return { allSessions, projects, projectPaths };
  }

  /** Present a dropdown session picker when no session ID is provided. */
  private async showSessionPicker(channelId: string, threadId: string | undefined): Promise<void> {
    const { allSessions } = await this.getAvailableSessions();
    const unmanaged = allSessions.filter((s) => !s.managed);

    if (unmanaged.length === 0) {
      await this.adapter.sendMessage(channelId, { text: '📋 No unmanaged sessions available to join.' });
      return;
    }

    // Sort by modifiedTime desc
    unmanaged.sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime());

    const choices = unmanaged.slice(0, 20).map((s) => {
      const age = this.formatAge(s.modifiedTime);
      const name = s.summary ? ` ${s.summary.slice(0, 50)}` : '';
      const branch = s.context?.branch ? ` 🔀${s.context.branch}` : '';
      return `${s.sessionId.slice(0, 8)} —${name}${branch} (${age})`;
    });

    await this.adapter.askQuestion(channelId, threadId ?? channelId, {
      question: '🔗 Which session would you like to join?',
      choices,
      allowFreeform: true,
    }).then(async (response) => {
      // Extract session ID prefix from the chosen option
      const chosen = response.answer.trim().replace(/`/g, '');
      const prefix = chosen.split(/[\s—-]/)[0]?.trim();
      if (prefix) {
        // Re-invoke join with the selected prefix
        const fakeMsg: IncomingMessage = {
          channelId,
          channelName: '',
          userId: '',
          text: prefix,
          messageId: '',
          timestamp: new Date(),
        };
        await this.resolveAndJoinSession(prefix, undefined, fakeMsg);
      }
    }).catch(() => {});
  }

  /** Core logic: resolve a session ID prefix, find/create the project, and join. */
  private async resolveAndJoinSession(
    sessionIdPrefix: string,
    projectName: string | undefined,
    msg: IncomingMessage,
  ): Promise<void> {
    const { allSessions } = await this.getAvailableSessions();
    const matches = allSessions.filter((s) => s.sessionId.startsWith(sessionIdPrefix));

    if (matches.length === 0) {
      await this.adapter.sendMessage(msg.channelId, {
        text: `❌ No session found matching \`${sessionIdPrefix}\`. Use \`/atc sessions\` to list.`,
      });
      return;
    }
    if (matches.length > 1) {
      await this.adapter.sendMessage(msg.channelId, {
        text: `❌ Ambiguous — \`${sessionIdPrefix}\` matches ${matches.length} sessions. Provide more characters.`,
      });
      return;
    }

    const targetSession = matches[0];
    if (targetSession.managed) {
      await this.adapter.sendMessage(msg.channelId, {
        text: `⚠️ Session \`${targetSession.sessionId.slice(0, 8)}\` is already managed by Air Traffic.`,
      });
      return;
    }

    // Determine or create the project
    let resolvedProjectName = projectName;
    if (!resolvedProjectName) {
      // Try to match by CWD
      if (targetSession.matchingProject) {
        resolvedProjectName = targetSession.matchingProject;
      } else {
        // Derive a project name from the session's cwd or summary
        const cwd = targetSession.context?.cwd;
        const dirName = cwd ? path.basename(cwd).toLowerCase().replace(/[^a-z0-9-]/g, '-') : null;
        resolvedProjectName = dirName && dirName.length > 0 ? dirName : `session-${targetSession.sessionId.slice(0, 8)}`;

        // Ensure name starts with a letter (project name validation)
        if (resolvedProjectName && !/^[a-z]/.test(resolvedProjectName)) {
          resolvedProjectName = `p-${resolvedProjectName}`;
        }

        // Create the project if it doesn't exist
        try {
          await this.projectManager.getProject(resolvedProjectName);
        } catch {
          const projectPath = targetSession.context?.cwd ?? path.join(this.config.airTraffic.projectsDir, resolvedProjectName);
          await this.projectManager.createProject(resolvedProjectName, this.config.airTraffic.machineName, undefined, projectPath);
          await this.adapter.sendMessage(msg.channelId, {
            text: `📁 Created project *${resolvedProjectName}* at \`${projectPath}\``,
          });
        }
      }
    }

    // Disconnect any existing session for this project
    const existingSession = this.orchestrator.getSession(resolvedProjectName);
    if (existingSession) {
      await existingSession.disconnect();
      this.orchestrator.removeSession(resolvedProjectName);
    }

    const project = await this.projectManager.getProject(resolvedProjectName);
    const projectChannelId = project.channelId;
    const client = await this.orchestrator.ensureClient();
    const agentSession = new AgentSession(client, this.adapter, project, this.permissionManager);

    const sessionLabel = targetSession.summary
      ? `\`${targetSession.sessionId.slice(0, 8)}\` (${targetSession.summary.slice(0, 60)})`
      : `\`${targetSession.sessionId.slice(0, 8)}\``;

    // Use the project channel for session output, not the control channel
    const summary = await agentSession.resumeExisting(
      targetSession.sessionId,
      projectChannelId,
      msg.userId,
    );

    this.orchestrator.registerSession(resolvedProjectName, agentSession);
    if (this.sessionBridge) {
      this.sessionBridge.bridge(resolvedProjectName, agentSession);
    }

    // Post confirmation to the project channel
    await this.adapter.sendMessage(projectChannelId, {
      text: `✅ Joined session ${sessionLabel}\n\n${summary}`,
    });

    // If invoked from a different channel (e.g. control), post a link there
    if (msg.channelId !== projectChannelId) {
      await this.adapter.sendMessage(msg.channelId, {
        text: `✅ Joined session ${sessionLabel} → project *${resolvedProjectName}* — head to <#${projectChannelId}> to interact.`,
      });
    }
  }

  private async cmdJoinSession(projectName: string, args: string[], msg: IncomingMessage): Promise<void> {
    // Strip backtick formatting from session ID
    const rawId = args[0]?.replace(/`/g, '').trim();

    if (!rawId) {
      // No ID provided — show dropdown picker
      await this.showSessionPicker(msg.channelId, msg.threadId);
      return;
    }

    await this.resolveAndJoinSession(rawId, projectName, msg);
  }

  private async cmdJoinFromControl(cmd: IncomingCommand): Promise<void> {
    // Strip backtick formatting from session ID
    const rawId = cmd.args[0]?.replace(/`/g, '').trim();
    const msg: IncomingMessage = {
      channelId: cmd.channelId,
      channelName: cmd.channelName,
      userId: cmd.userId,
      text: cmd.rawText,
      messageId: cmd.messageId,
      timestamp: new Date(),
    };

    if (!rawId) {
      await this.showSessionPicker(cmd.channelId, undefined);
      return;
    }

    // From control channel — project name will be auto-derived
    await this.resolveAndJoinSession(rawId, undefined, msg);
  }

  private async cmdLeaveSession(projectName: string, msg: IncomingMessage): Promise<void> {
    const session = this.orchestrator.getSession(projectName);
    if (!session) {
      await this.adapter.sendMessage(msg.channelId, { text: '⚠️ No active session for this project.' });
      return;
    }

    // Disconnect from the session (preserves session state on disk for later resume)
    await session.disconnect();
    this.orchestrator.removeSession(projectName);
    if (this.sessionBridge) {
      this.sessionBridge.unbridge(projectName);
    }

    await this.adapter.sendMessage(msg.channelId, {
      text: `👋 Left session for *${projectName}*. The Copilot session is still alive and can be rejoined later.`,
    });
  }

  private formatAge(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // --- Status helpers ---

  private async postMachineStatus(channelId: string): Promise<void> {
    const activeSessions = this.orchestrator.getActiveSessionCount();
    const projects = this.orchestrator.getActiveProjectNames();
    const status = {
      machineName: this.config.airTraffic.machineName,
      online: true,
      activeSessions,
      projects,
      lastSeen: new Date(),
    };
    const content = formatMachineStatus(this.config.airTraffic.machineName, status);
    await this.adapter.sendMessage(channelId, content);
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
