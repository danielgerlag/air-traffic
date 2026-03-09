import { getLogger } from '../utils/logger.js';

const KNOWN_MODELS = [
  'claude-sonnet-4.5',
  'claude-sonnet-4',
  'claude-opus-4.6',
  'gpt-5',
  'gpt-5-mini',
  'gpt-4.1',
  'gemini-3-pro-preview',
] as const;

export type ModelId = (typeof KNOWN_MODELS)[number] | string;

export class ModelRegistry {
  private models: Set<string> = new Set(KNOWN_MODELS);

  /** Accept any non-empty string (new models get added dynamically). */
  isValid(model: string): boolean {
    return this.models.has(model) || model.length > 0;
  }

  getAvailable(): string[] {
    return [...this.models];
  }

  addModel(model: string): void {
    this.models.add(model);
    getLogger().debug(`Model added to registry: ${model}`);
  }

  getDefault(configDefault: string): string {
    return configDefault;
  }
}
