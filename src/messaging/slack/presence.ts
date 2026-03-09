import type { MessagingAdapter, MachineStatus } from '../types.js';
import { formatMachineStatus } from './formatters.js';

export class PresenceManager {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private adapter: MessagingAdapter,
    private intervalMs: number = 60_000,
  ) {}

  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      void this.sendHeartbeat();
    }, this.intervalMs);
    // Send an initial heartbeat immediately
    void this.sendHeartbeat();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async sendHeartbeat(): Promise<void> {
    await this.adapter.reportPresence();
  }

  buildStatus(activeSessions: number, projects: string[]): MachineStatus {
    return {
      machineName: this.adapter.machineName,
      online: true,
      activeSessions,
      projects,
      lastSeen: new Date(),
    };
  }
}
