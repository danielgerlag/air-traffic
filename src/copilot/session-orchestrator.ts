import { CopilotClient } from '@github/copilot-sdk';
import type { AgentSession } from './agent-session.js';
import { getLogger } from '../utils/logger.js';
import { SessionError } from '../utils/errors.js';

export class SessionOrchestrator {
  private client: CopilotClient | null = null;
  private sessions: Map<string, AgentSession> = new Map();

  async start(): Promise<void> {
    const logger = getLogger();
    logger.info('Starting Copilot client...');
    this.client = new CopilotClient({ autoStart: true });
    await this.client.start();
    logger.info('Copilot client started');
  }

  async stop(): Promise<void> {
    const logger = getLogger();
    logger.info('Stopping all sessions...');
    for (const [name, session] of this.sessions) {
      await session.disconnect();
      logger.info(`Disconnected session for project: ${name}`);
    }
    this.sessions.clear();
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
    logger.info('Copilot client stopped');
  }

  getClient(): CopilotClient {
    if (!this.client) throw new SessionError('Copilot client not started');
    return this.client;
  }

  async ensureClient(): Promise<CopilotClient> {
    if (!this.client) {
      const logger = getLogger();
      logger.warn('Copilot client not running — restarting...');
      await this.start();
    }
    return this.client!;
  }

  registerSession(projectName: string, session: AgentSession): void {
    this.sessions.set(projectName, session);
  }

  getSession(projectName: string): AgentSession | undefined {
    return this.sessions.get(projectName);
  }

  removeSession(projectName: string): void {
    this.sessions.delete(projectName);
  }

  getActiveSessions(): Map<string, AgentSession> {
    return this.sessions;
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  getActiveProjectNames(): string[] {
    return [...this.sessions.keys()];
  }
}
