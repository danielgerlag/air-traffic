import type { MessagingAdapter, MachineStatus } from '../types.js';

export type StatusBuilder = () => MachineStatus;

export class PresenceManager {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private adapter: MessagingAdapter,
    private buildStatus: StatusBuilder,
    private intervalMs: number = 60_000,
  ) {}

  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      void this.sendHeartbeat();
    }, this.intervalMs);
    void this.sendHeartbeat();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async sendHeartbeat(): Promise<void> {
    const status = this.buildStatus();
    await this.adapter.registerMachine(status);
    await this.adapter.reportPresence();
  }
}
