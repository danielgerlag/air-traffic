import { describe, it, expect, beforeEach } from 'vitest';
import { ModelRegistry } from '../../../src/copilot/model-registry.js';

describe('ModelRegistry', () => {
  let registry: ModelRegistry;

  beforeEach(() => {
    registry = new ModelRegistry();
  });

  describe('getAvailable()', () => {
    it('returns empty list before loading', () => {
      const models = registry.getAvailable();
      expect(models).toEqual([]);
    });

    it('returns models after loadModels', async () => {
      const mockClient = {
        listModels: async () => [
          { id: 'model-a', name: 'Model A', capabilities: {} },
          { id: 'model-b', name: 'Model B', capabilities: {} },
        ],
      } as any;
      await registry.loadModels(mockClient);
      const models = registry.getAvailable();
      expect(models).toContain('model-a');
      expect(models).toContain('model-b');
      expect(models.length).toBe(2);
    });
  });

  describe('isValid()', () => {
    it('returns true for any non-empty string before loading', () => {
      expect(registry.isValid('some-custom-model')).toBe(true);
    });

    it('returns false for empty string', () => {
      expect(registry.isValid('')).toBe(false);
    });
  });

  describe('getDefault()', () => {
    it('returns the passed default', () => {
      expect(registry.getDefault('gpt-5')).toBe('gpt-5');
      expect(registry.getDefault('claude-sonnet-4.5')).toBe('claude-sonnet-4.5');
    });
  });
});
