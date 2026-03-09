import type { CopilotClient } from '@github/copilot-sdk';
import { getLogger } from '../utils/logger.js';

export class ModelRegistry {
  private models: string[] = [];
  private loaded = false;

  /** Load available models from the Copilot SDK. */
  async loadModels(client: CopilotClient): Promise<void> {
    try {
      const modelInfos = await client.listModels();
      this.models = modelInfos.map((m) => m.id);
      this.loaded = true;
      getLogger().info(`Loaded ${this.models.length} models from Copilot SDK`);
    } catch (err) {
      getLogger().warn('Failed to load models from Copilot SDK', { error: err });
    }
  }

  isValid(model: string): boolean {
    if (!this.loaded) return model.length > 0;
    return this.models.includes(model) || model.length > 0;
  }

  getAvailable(): string[] {
    return [...this.models];
  }

  getDefault(configDefault: string): string {
    return configDefault;
  }
}
