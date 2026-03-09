import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import path from 'node:path';
import type { ProjectManager } from '../projects/project-manager.js';
import type { SessionOrchestrator } from '../copilot/session-orchestrator.js';
import type { ModelRegistry } from '../copilot/model-registry.js';
import type { PermissionManager } from '../copilot/permission-manager.js';
import type { MessagingAdapter } from '../messaging/types.js';
import { getLogger } from '../utils/logger.js';
import { registerApiRoutes } from './api-routes.js';
import { registerSocketHandlers } from './socket-handlers.js';

export interface WebServerDeps {
  projectManager: ProjectManager;
  orchestrator: SessionOrchestrator;
  modelRegistry: ModelRegistry;
  permissionManager: PermissionManager;
  machineName: string;
  adapter: MessagingAdapter;
  config: { webPort: number };
}

export class WebServer {
  private app: express.Application;
  private httpServer: ReturnType<typeof createServer>;
  private io: SocketIOServer;

  constructor(private deps: WebServerDeps) {
    this.app = express();
    this.httpServer = createServer(this.app);
    this.io = new SocketIOServer(this.httpServer, {
      cors: { origin: '*' },
    });

    this.app.use(cors());
    this.app.use(express.json());

    // Serve static frontend (web/dist) if it exists
    const staticPath = path.join(process.cwd(), 'web', 'dist');
    this.app.use(express.static(staticPath));

    this.setupRoutes();
    this.setupSocketHandlers();

    // SPA fallback — serve index.html for unmatched routes (but not /api/*)
    this.app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(staticPath, 'index.html'), (err) => {
        if (err)
          res
            .status(404)
            .json({ error: 'Frontend not built. Run: npm run console:build' });
      });
    });
  }

  getIO(): SocketIOServer {
    return this.io;
  }

  async start(): Promise<void> {
    const port = this.deps.config.webPort;
    return new Promise((resolve) => {
      this.httpServer.listen(port, () => {
        getLogger().info(
          `Air Traffic Console running at http://localhost:${port}`,
        );
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.io.close();
    return new Promise((resolve, reject) => {
      this.httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private setupRoutes(): void {
    registerApiRoutes(this.app, this.deps);
  }

  private setupSocketHandlers(): void {
    registerSocketHandlers(this.io, this.deps);
  }
}
