import { describe, it, expect, beforeEach } from 'vitest';
import { ModelRegistry } from '../../../src/copilot/model-registry.js';

describe('ModelRegistry', () => {
  let registry: ModelRegistry;

  beforeEach(() => {
    registry = new ModelRegistry();
  });

  describe('getAvailable()', () => {
    it('returns all known models', () => {
      const models = registry.getAvailable();
      expect(models).toContain('claude-sonnet-4.5');
      expect(models).toContain('gpt-5');
      expect(models).toContain('gpt-4.1');
      expect(models).toContain('gemini-3-pro-preview');
      expect(models.length).toBeGreaterThanOrEqual(7);
    });
  });

  describe('isValid()', () => {
    it('returns true for known models', () => {
      expect(registry.isValid('claude-sonnet-4.5')).toBe(true);
      expect(registry.isValid('gpt-5')).toBe(true);
    });

    it('returns true for unknown but non-empty strings (lenient)', () => {
      expect(registry.isValid('some-custom-model')).toBe(true);
    });

    it('returns false for empty string', () => {
      expect(registry.isValid('')).toBe(false);
    });
  });

  describe('addModel()', () => {
    it('makes added model appear in getAvailable()', () => {
      registry.addModel('my-custom-model');
      expect(registry.getAvailable()).toContain('my-custom-model');
    });
  });

  describe('getDefault()', () => {
    it('returns the passed default', () => {
      expect(registry.getDefault('gpt-5')).toBe('gpt-5');
      expect(registry.getDefault('claude-sonnet-4.5')).toBe('claude-sonnet-4.5');
    });
  });
});
