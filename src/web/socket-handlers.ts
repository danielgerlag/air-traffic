import type { Server as SocketIOServer } from 'socket.io';
import type { WebServerDeps } from './server.js';
import { getLogger } from '../utils/logger.js';

export function registerSocketHandlers(io: SocketIOServer, deps: WebServerDeps): void {
  io.on('connection', (socket) => {
    const log = getLogger();
    log.info(`Console client connected: ${socket.id}`);

    // Join a project room for live events
    socket.on('join:project', (projectName: string) => {
      socket.join(`project:${projectName}`);
      log.debug(`Client ${socket.id} joined project:${projectName}`);
    });

    // Leave a project room
    socket.on('leave:project', (projectName: string) => {
      socket.leave(`project:${projectName}`);
    });

    // Send a prompt to a project's Copilot session
    socket.on('prompt', async (data: { projectName: string; text: string }) => {
      try {
        let session = deps.orchestrator.getSession(data.projectName);
        if (!session) {
          const project = await deps.projectManager.getProject(data.projectName);
          const client = await deps.orchestrator.ensureClient();
          const { AgentSession } = await import('../copilot/agent-session.js');
          const { PermissionManager } = await import('../copilot/permission-manager.js');
          session = new AgentSession(client, deps.adapter, project, new PermissionManager());
          await session.initialize(project.model);
          deps.orchestrator.registerSession(data.projectName, session);
        }

        const threadId = `console-${Date.now()}`;
        await session.handlePrompt(data.text, threadId);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        socket.emit('error', { message });
      }
    });

    // Abort a project's session
    socket.on('abort', async (projectName: string) => {
      const session = deps.orchestrator.getSession(projectName);
      if (session) {
        await session.abort();
        io.to(`project:${projectName}`).emit('session:idle', { projectName });
      }
    });

    socket.on('disconnect', () => {
      log.debug(`Console client disconnected: ${socket.id}`);
    });
  });
}
